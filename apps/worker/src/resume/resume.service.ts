import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ResumeOutputSchema,
  assembleResume,
  costUsd,
  requirementProfile,
  type ResumeEvidence,
  type ResumeContent,
} from '@shortlist/shared';
import { BudgetGuard } from '../analysis/budget-guard.js';
import { OutOfCreditError, PermanentAnalyzerError } from '../analysis/job-analyzer.js';
import { parseModelOutput } from '../analysis/model-output.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildResumePrompt } from './prompt.js';
import { RESUME_WRITER, type ResumeWriter } from './resume-writer.js';

export type TailorOutcome =
  | { status: 'READY'; variantId: string; bullets: number; dropped: number; costUsd: number }
  | { status: 'DEFERRED' | 'FAILED' | 'SKIPPED'; reason: string };

export class PermanentTailorError extends Error {
  // The model's raw answer when it failed validation — printed by preview:resume to
  // diagnose it; never stored (it's a whole resume's worth of text).
  constructor(
    message: string,
    readonly rawOutput?: string,
  ) {
    super(message);
  }
}

type Draft =
  | {
      status: 'READY';
      content: ResumeContent;
      evidenceIds: string[];
      model: string;
      readAt: Date;
      cost: number;
      bullets: number;
    }
  | { status: 'DEFERRED' | 'FAILED'; reason: string };

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
    const job = await this.loadJob(jobId);
    if (!job) return { status: 'SKIPPED', reason: 'job no longer exists' };

    let draft: Draft;
    try {
      draft = await this.draft(job);
    } catch (err) {
      if (err instanceof PermanentTailorError) await this.fail(jobId, err.message);
      throw err; // permanent: no retry (processor); transient: the queue retries
    }
    if (draft.status !== 'READY')
      return draft.status === 'DEFERRED' ? this.defer(jobId, draft.reason) : this.fail(jobId, draft.reason);

    const { content, evidenceIds, model, readAt, cost } = draft;
    const variant = await this.prisma.$transaction(async (tx) => {
      const v = await tx.resumeVariant.create({
        data: {
          userId: job.userId,
          content,
          evidenceIds,
          requirementProfile: requirementProfile(job.requirements),
          model,
          generatedAt: readAt,
        },
      });
      await tx.jobResume.update({
        where: { jobId },
        data: { status: 'READY', error: null, variantId: v.id, reused: false, overlap: null },
      });
      return v;
    });

    this.logger.log(
      `Resume for ${job.title} @ ${job.company}: ${draft.bullets} bullets, ${content.dropped.length} dropped ($${cost.toFixed(4)})`,
    );
    return {
      status: 'READY',
      variantId: variant.id,
      bullets: draft.bullets,
      dropped: content.dropped.length,
      costUsd: cost,
    };
  }

  // Writes a resume for the job WITHOUT storing it or touching the job's resume status —
  // for tuning the prompt against real output (`preview:resume`). The model call is real:
  // it's budget-checked and logged to AiUsage like any other.
  async preview(jobId: string): Promise<Draft> {
    const job = await this.loadJob(jobId);
    if (!job) return { status: 'FAILED', reason: 'job not found' };
    return this.draft(job);
  }

  private loadJob(jobId: string) {
    return this.prisma.job.findUnique({
      where: { id: jobId },
      include: { requirements: { orderBy: [{ isCore: 'desc' }, { importance: 'asc' }] } },
    });
  }

  // One model call, logged, then checked by code (docs/resume.md §13.1). Everything tailoring
  // does except storing the result. Throws PermanentTailorError for output that would fail
  // again; rethrows transient errors for the queue to retry.
  private async draft(job: NonNullable<Awaited<ReturnType<ResumeService['loadJob']>>>): Promise<Draft> {
    if (!this.writer.configured) return { status: 'DEFERRED', reason: 'ANTHROPIC_API_KEY is not set in the worker' };
    const guard = await this.budget.checkMonthly(job.userId);
    if (!guard.allowed) return { status: 'DEFERRED', reason: guard.reason };

    // The resume reflects the evidence as read NOW, so that's its generation time. Stamping
    // it when saved (after a ~30s model call) would hide an edit + re-verify made meanwhile:
    // that item's updatedAt would predate the resume, which would look current (code review).
    const readAt = new Date();
    const material = await this.material(job.userId);
    if (material.evidence.length === 0)
      return { status: 'FAILED', reason: 'No verified evidence yet — verify your skills first' };

    const prompt = buildResumePrompt({ job, requirements: job.requirements, ...material });
    let result;
    try {
      result = await this.writer.write(prompt);
    } catch (err) {
      if (err instanceof OutOfCreditError) return { status: 'DEFERRED', reason: err.message };
      if (err instanceof PermanentAnalyzerError) throw new PermanentTailorError(err.message);
      throw err; // transient: the queue retries
    }

    // Log the spend before anything else: the call was billed whatever happens next.
    const cost = costUsd(result.model, result.usage);
    const parsed = parseModelOutput(result.text, result.stopReason, ResumeOutputSchema, 'write this resume');
    await this.prisma.aiUsage.create({
      data: {
        userId: job.userId,
        jobId: job.id,
        purpose: 'TAILOR_RESUME',
        model: result.model,
        ...result.usage,
        costUsd: cost,
        succeeded: parsed.ok,
      },
    });
    if (!parsed.ok) throw new PermanentTailorError(parsed.reason, result.text); // same input would fail again and cost again

    const { content, evidenceIds } = assembleResume({
      output: parsed.value,
      refs: prompt.refs,
      ...material,
      policedNames: [...material.allSkillNames, ...job.requirements.map((r) => r.skillName)],
      requirementAliases: job.requirements.map((r) => ({ name: r.skillName, skillIds: r.matchedSkillIds })),
    });
    const bullets = [...content.experience, ...content.projects].reduce((n, sec) => n + sec.bullets.length, 0);
    if (bullets === 0)
      return { status: 'FAILED', reason: 'None of the generated bullets passed the truthfulness checks — try again' };
    return { status: 'READY', content, evidenceIds, model: result.model, readAt, cost, bullets };
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
      this.prisma.project.findMany({
        where: { userId },
        select: { id: true, name: true, workExperienceId: true, isPinned: true },
      }),
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

  private async defer(jobId: string, reason: string): Promise<TailorOutcome> {
    await this.prisma.jobResume.update({ where: { jobId }, data: { status: 'DEFERRED', error: reason } });
    return { status: 'DEFERRED', reason };
  }

  async fail(jobId: string, reason: string): Promise<TailorOutcome> {
    await this.prisma.jobResume.updateMany({
      where: { jobId },
      data: { status: 'FAILED', error: reason.slice(0, 1000) },
    });
    return { status: 'FAILED', reason };
  }
}
