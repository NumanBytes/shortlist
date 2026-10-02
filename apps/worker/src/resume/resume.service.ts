import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ResumeOutputSchema,
  assembleResume,
  costUsd,
  requirementProfile,
  type ResumeEvidence,
  type ResumeOutput,
} from '@shortlist/shared';
import { BudgetGuard } from '../analysis/budget-guard.js';
import { OutOfCreditError, PermanentAnalyzerError } from '../analysis/job-analyzer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildResumePrompt } from './prompt.js';
import { RESUME_WRITER, type ResumeWriter } from './resume-writer.js';

export type TailorOutcome =
  | { status: 'READY'; variantId: string; bullets: number; dropped: number; costUsd: number }
  | { status: 'DEFERRED' | 'FAILED' | 'SKIPPED'; reason: string };

export class PermanentTailorError extends Error {}

@Injectable()
export class ResumeService {
  private readonly logger = new Logger(ResumeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: BudgetGuard,
    @Inject(RESUME_WRITER) private readonly writer: ResumeWriter,
  ) {}

  async tailor(jobId: string): Promise<TailorOutcome> {
    const record = await this.prisma.jobResume.findUnique({ where: { jobId } });
    if (!record || record.status !== 'PENDING') return { status: 'SKIPPED', reason: 'not waiting to be tailored' };
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { requirements: { orderBy: [{ isCore: 'desc' }, { importance: 'asc' }] } },
    });
    if (!job) return { status: 'SKIPPED', reason: 'job no longer exists' };

    if (!this.writer.configured) return this.defer(jobId, 'ANTHROPIC_API_KEY is not set in the worker');
    const guard = await this.budget.checkMonthly(job.userId);
    if (!guard.allowed) return this.defer(jobId, guard.reason);

    const material = await this.material(job.userId);
    if (material.evidence.length === 0) return this.fail(jobId, 'No verified evidence yet — verify your skills first');

    const prompt = buildResumePrompt({ job, requirements: job.requirements, ...material });
    let result;
    try {
      result = await this.writer.write(prompt);
    } catch (err) {
      if (err instanceof OutOfCreditError) return this.defer(jobId, err.message);
      if (err instanceof PermanentAnalyzerError) {
        await this.fail(jobId, err.message);
        throw new PermanentTailorError(err.message);
      }
      throw err; // transient: the queue retries
    }

    // Log the spend before anything else: the call was billed whatever happens next.
    const cost = costUsd(result.model, result.usage);
    const parsed = this.parse(result.text, result.stopReason);
    await this.prisma.aiUsage.create({
      data: { userId: job.userId, jobId, purpose: 'TAILOR_RESUME', model: result.model, ...result.usage, costUsd: cost, succeeded: parsed.ok },
    });
    if (!parsed.ok) {
      await this.fail(jobId, parsed.reason);
      throw new PermanentTailorError(parsed.reason); // same input would fail again and cost again
    }

    const { content, evidenceIds } = assembleResume({
      output: parsed.value,
      refs: prompt.refs,
      ...material,
      policedNames: [...material.allSkillNames, ...job.requirements.map((r) => r.skillName)],
      requirementAliases: job.requirements.map((r) => ({ name: r.skillName, skillIds: r.matchedSkillIds })),
    });
    const bullets = [...content.experience, ...content.projects].reduce((n, s) => n + s.bullets.length, 0);
    if (bullets === 0) return this.fail(jobId, 'None of the generated bullets passed the truthfulness checks — try again');

    const variant = await this.prisma.$transaction(async (tx) => {
      const v = await tx.resumeVariant.create({
        data: {
          userId: job.userId,
          content,
          evidenceIds,
          requirementProfile: requirementProfile(job.requirements),
          model: result.model,
        },
      });
      await tx.jobResume.update({ where: { jobId }, data: { status: 'READY', error: null, variantId: v.id, reused: false, overlap: null } });
      return v;
    });

    this.logger.log(
      `Resume for ${job.title} @ ${job.company}: ${bullets} bullets, ${content.dropped.length} dropped ($${cost.toFixed(4)})`,
    );
    return { status: 'READY', variantId: variant.id, bullets, dropped: content.dropped.length, costUsd: cost };
  }

  // Everything the resume may draw on. Truthfulness boundary: VERIFIED evidence only.
  private async material(userId: string) {
    const [rows, roles, projects, skills] = await Promise.all([
      this.prisma.skillEvidence.findMany({
        where: { isVerified: true, skill: { userId } },
        include: { skill: { select: { name: true } }, project: { select: { workExperienceId: true } } },
        orderBy: { lastUsed: 'desc' },
      }),
      this.prisma.workExperience.findMany({ where: { userId } }),
      this.prisma.project.findMany({ where: { userId }, select: { id: true, name: true, workExperienceId: true } }),
      this.prisma.skill.findMany({ where: { userId }, select: { name: true } }),
    ]);
    const evidence: ResumeEvidence[] = rows.map((e) => ({
      id: e.id,
      skillId: e.skillId,
      skillName: e.skill.name,
      context: e.context,
      depth: e.depth,
      lastUsed: e.lastUsed,
      whatIDid: e.whatIDid,
      workExperienceId: e.workExperienceId,
      projectId: e.projectId,
      projectRoleId: e.project?.workExperienceId ?? null,
    }));
    return { evidence, roles, projects, allSkillNames: skills.map((s) => s.name) };
  }

  private parse(text: string, stopReason: string | null): { ok: true; value: ResumeOutput } | { ok: false; reason: string } {
    if (stopReason === 'max_tokens') return { ok: false, reason: 'Model output was cut off (max_tokens)' };
    if (stopReason === 'refusal') return { ok: false, reason: 'Model declined to write this resume' };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'Model output was not valid JSON' };
    }
    const r = ResumeOutputSchema.safeParse(json);
    return r.success ? { ok: true, value: r.data } : { ok: false, reason: `Model output failed validation: ${r.error.issues[0]?.message ?? 'unknown'}` };
  }

  private async defer(jobId: string, reason: string): Promise<TailorOutcome> {
    await this.prisma.jobResume.update({ where: { jobId }, data: { status: 'DEFERRED', error: reason } });
    return { status: 'DEFERRED', reason };
  }

  async fail(jobId: string, reason: string): Promise<TailorOutcome> {
    await this.prisma.jobResume.updateMany({ where: { jobId }, data: { status: 'FAILED', error: reason.slice(0, 1000) } });
    return { status: 'FAILED', reason };
  }
}
