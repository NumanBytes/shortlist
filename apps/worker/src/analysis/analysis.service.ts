import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  JobAnalysisOutputSchema,
  commercialYears,
  costUsd,
  promoteExactNameMatches,
  scoreJob,
  type JobAnalysisOutput,
  type ScoringRequirement,
  type ScoringSkill,
} from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { BudgetGuard } from './budget-guard.js';
import { JOB_ANALYZER, OutOfCreditError, PermanentAnalyzerError, type JobAnalyzer } from './job-analyzer.js';
import { parseModelOutput } from './model-output.js';
import { buildAnalysisPrompt } from './prompt.js';

export type AnalysisOutcome =
  | { status: 'DONE'; overallScore: number; verdict: string; costUsd: number }
  | { status: 'DEFERRED'; reason: string }
  | { status: 'FAILED'; reason: string }
  | { status: 'SKIPPED'; reason: string };

// A failure that retrying can't fix; the processor maps it to UnrecoverableError.
export class PermanentAnalysisError extends Error {}

// The job's description changed while the model was reading the old one (docs/email-alerts.md §10.5,
// "Paste full description"). Thrown inside the save transaction to roll it back.
class DescriptionChanged extends Error {}

// What scoring needs besides the job: the user's verified evidence and roles. The same for
// every job of a user, so a re-score loads it once (not once per job).
type ScoringContext = { skills: ScoringSkill[]; commercialYears: number };

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: BudgetGuard,
    @Inject(JOB_ANALYZER) private readonly analyzer: JobAnalyzer,
  ) {}

  async analyzeJob(jobId: string): Promise<AnalysisOutcome> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return { status: 'SKIPPED', reason: 'job no longer exists' };
    if (job.analysisStatus === 'DONE') return { status: 'SKIPPED', reason: 'already analysed' };

    if (!this.analyzer.configured) return this.defer(jobId, 'ANTHROPIC_API_KEY is not set in the worker');

    const guard = await this.budget.checkAnalysis(job.userId);
    if (!guard.allowed) return this.defer(jobId, guard.reason);

    // Truthfulness boundary: only VERIFIED evidence ever reaches the model (§6.2).
    const skills = await this.verifiedSkills(job.userId);
    if (skills.length === 0) return this.defer(jobId, 'No verified evidence yet — verify your skills first');

    const prompt = buildAnalysisPrompt(job, skills);
    let result;
    try {
      result = await this.analyzer.analyze(prompt);
    } catch (err) {
      if (err instanceof OutOfCreditError) return this.defer(jobId, err.message);
      if (err instanceof PermanentAnalyzerError) {
        await this.fail(jobId, err.message);
        throw new PermanentAnalysisError(err.message);
      }
      throw err; // transient: the queue retries; the job stays PENDING meanwhile
    }

    // Log the spend first, whatever happens to the output: the call was billed.
    const cost = costUsd(result.model, result.usage);
    const parsed = parseModelOutput(result.text, result.stopReason, JobAnalysisOutputSchema, 'analyse this posting');
    await this.prisma.aiUsage.create({
      data: {
        userId: job.userId,
        jobId,
        purpose: 'ANALYZE_JOB',
        model: result.model,
        ...result.usage,
        costUsd: cost,
        succeeded: parsed.ok,
      },
    });
    if (!parsed.ok) {
      await this.fail(jobId, parsed.reason);
      // Retrying the same input is likely to fail the same way and cost again — don't.
      throw new PermanentAnalysisError(parsed.reason);
    }

    const requirements = promoteExactNameMatches(this.resolveRefs(parsed.value, prompt.refs), skills);
    const score = this.score(await this.scoringContext(job.userId), requirements, parsed.value);

    try {
      await this.saveAnalysis(jobId, job.rawJD, requirements, score, parsed.value, skills);
    } catch (err) {
      if (!(err instanceof DescriptionChanged)) throw err;
      // A pasted description arrived mid-run; its own enqueue was folded into this run by the
      // queue's deduplication, so nothing else would score it. Read the new text now.
      this.logger.log(`${job.title} @ ${job.company}: description changed during analysis — analysing again`);
      return this.analyzeJob(jobId);
    }

    this.logger.log(
      `${job.title} @ ${job.company}: ${score.overallScore} ${score.verdict} ($${cost.toFixed(4)}${prompt.truncated ? ', description truncated' : ''})`,
    );
    return { status: 'DONE', overallScore: score.overallScore, verdict: score.verdict, costUsd: cost };
  }

  private async saveAnalysis(
    jobId: string,
    analysedJD: string,
    requirements: ScoringRequirement[],
    score: ReturnType<typeof scoreJob>,
    output: JobAnalysisOutput,
    skills: { id: string }[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Compare-and-set on the text the model read: if it changed meanwhile, this result
      // describes a posting that no longer exists — keep nothing.
      const { count } = await tx.job.updateMany({
        where: { id: jobId, rawJD: analysedJD },
        data: {
          analysisStatus: 'DONE',
          analysisError: null,
          analyzedAt: new Date(),
          seniority: output.seniority,
          yearsRequired: output.yearsRequired,
          analyzedSkillIds: skills.map((sk) => sk.id),
          redFlags: output.redFlags,
        },
      });
      if (count === 0) throw new DescriptionChanged();
      await tx.jobRequirement.deleteMany({ where: { jobId } });
      await tx.jobMatch.deleteMany({ where: { jobId } });
      await tx.jobRequirement.createMany({ data: requirements.map((r) => ({ jobId, ...r })) });
      await tx.jobMatch.create({
        data: {
          jobId,
          overallScore: score.overallScore,
          commercialScore: score.commercialScore,
          verdict: score.verdict,
          strengths: score.strengths,
          risks: score.risks,
          gaps: { create: score.gaps },
        },
      });
    });
  }

  // After evidence changes, for every analysed job:
  // - if the user has since verified a skill the model never saw, the stored mapping
  //   can't know about it → mark the job PENDING for ONE fresh analysis (budget-guarded);
  //   its current score stays visible meanwhile;
  // - otherwise re-score from the stored mapping — no model call (un-verifying, editing).
  async rescoreUser(userId: string): Promise<{ rescored: number; needsReanalysis: string[] }> {
    const verifiedSkills = await this.verifiedSkills(userId);
    const verified = new Set(verifiedSkills.map((s) => s.id));
    const jobs = await this.prisma.job.findMany({
      where: { userId, analysisStatus: 'DONE' },
      include: { requirements: true },
    });
    const context = await this.scoringContext(userId);
    let rescored = 0;
    const needsReanalysis: string[] = [];
    for (const job of jobs) {
      const seen = new Set(job.analyzedSkillIds);
      if ([...verified].some((id) => !seen.has(id))) {
        needsReanalysis.push(job.id);
        continue;
      }
      const reqs: ScoringRequirement[] = promoteExactNameMatches(
        job.requirements.map((r) => ({
          skillName: r.skillName,
          importance: r.importance,
          isCore: r.isCore,
          yearsRequired: r.yearsRequired,
          matchedSkillIds: r.matchedSkillIds,
          relatedSkillIds: r.relatedSkillIds,
        })),
        verifiedSkills,
      );
      // Persist the promotion so the job detail shows the same mapping it was scored on.
      for (const [i, r] of job.requirements.entries()) {
        if (reqs[i]!.matchedSkillIds.length !== r.matchedSkillIds.length) {
          await this.prisma.jobRequirement.update({
            where: { id: r.id },
            data: { matchedSkillIds: reqs[i]!.matchedSkillIds, relatedSkillIds: reqs[i]!.relatedSkillIds },
          });
        }
      }
      const score = this.score(context, reqs, { yearsRequired: job.yearsRequired, redFlags: job.redFlags });
      await this.prisma.$transaction(async (tx) => {
        const match = await tx.jobMatch.findUnique({ where: { jobId: job.id } });
        if (match) await tx.skillGap.deleteMany({ where: { jobMatchId: match.id } });
        await tx.jobMatch.upsert({
          where: { jobId: job.id },
          create: { jobId: job.id, ...score, gaps: { create: score.gaps } },
          update: { ...score, computedAt: new Date(), gaps: { create: score.gaps } },
        });
      });
      rescored++;
    }
    if (needsReanalysis.length) {
      await this.prisma.job.updateMany({
        where: { id: { in: needsReanalysis } },
        data: { analysisStatus: 'PENDING', analysisError: 'New verified skills since the last analysis' },
      });
    }
    return { rescored, needsReanalysis };
  }

  private async verifiedSkills(userId: string) {
    const skills = await this.prisma.skill.findMany({
      where: { userId, evidence: { some: { isVerified: true } } },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });
    return skills;
  }

  private async scoringContext(userId: string): Promise<ScoringContext> {
    const [skills, roles] = await Promise.all([
      this.prisma.skill.findMany({
        where: { userId },
        include: {
          evidence: {
            where: { isVerified: true }, // verified only — unverified evidence scores nothing
            include: { workExperience: { select: { company: true } }, project: { select: { name: true } } },
          },
        },
      }),
      this.prisma.workExperience.findMany({ where: { userId }, select: { startDate: true, endDate: true } }),
    ]);
    return {
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        evidence: s.evidence.map((e) => ({
          context: e.context,
          depth: e.depth,
          lastUsed: e.lastUsed,
          source: e.workExperience?.company ?? e.project?.name ?? null,
        })),
      })),
      commercialYears: commercialYears(roles),
    };
  }

  private score(
    context: ScoringContext,
    requirements: ScoringRequirement[],
    meta: Pick<JobAnalysisOutput, 'yearsRequired' | 'redFlags'>,
  ) {
    return scoreJob({
      requirements,
      skills: context.skills,
      userCommercialYears: context.commercialYears,
      jobYearsRequired: meta.yearsRequired,
      redFlags: meta.redFlags,
    });
  }

  // Map "S3" refs back to skill IDs. Unknown refs are dropped (and counted): the model
  // can only ever point at skills we listed — it cannot introduce one.
  private resolveRefs(output: JobAnalysisOutput, refs: Map<string, string>): ScoringRequirement[] {
    let dropped = 0;
    const resolve = (list: string[]) =>
      [...new Set(list)].flatMap((ref) => {
        const id = refs.get(ref.trim());
        if (!id) dropped++;
        return id ? [id] : [];
      });
    const out = output.requirements.map((r) => {
      const matched = resolve(r.sameAs);
      return {
        skillName: r.skill,
        importance: r.importance,
        isCore: r.isCore,
        yearsRequired: r.yearsRequired,
        matchedSkillIds: matched,
        relatedSkillIds: resolve(r.relatedTo).filter((id) => !matched.includes(id)),
      };
    });
    if (dropped) this.logger.warn(`Dropped ${dropped} unknown skill reference(s) from the model's output`);
    return out;
  }

  private async defer(jobId: string, reason: string): Promise<AnalysisOutcome> {
    await this.prisma.job.update({ where: { id: jobId }, data: { analysisStatus: 'DEFERRED', analysisError: reason } });
    return { status: 'DEFERRED', reason };
  }

  private async fail(jobId: string, reason: string) {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { analysisStatus: 'FAILED', analysisError: reason.slice(0, 1000) },
    });
  }
}
