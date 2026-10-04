import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ResumeContentSchema,
  aiSettingsFromRow,
  resumeOverlap,
  type Importance,
  type PrepareResumeInput,
} from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';

interface VariantRow {
  id: string;
  status: 'DRAFT' | 'APPROVED';
  content: unknown;
  evidenceIds: string[];
  requirementProfile: string[];
  model: string;
  generatedAt: Date;
  approvedAt: Date | null;
}

const MAX_REUSE_OFFERS = 3;

// Resumes for jobs (Agents.md §13). The API never writes a resume — the worker does; this
// queues tailoring, records reuse and approval, and decides staleness.
@Injectable()
export class ResumesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: JobQueues,
  ) {}

  async forJob(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: {
        analysisStatus: true,
        isPartial: true,
        requirements: { select: { skillName: true, importance: true } },
        resume: { include: { variant: true } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');

    const record = job.resume;
    const variant = record?.variant ?? null;
    const [stale, sources, reuse] = await Promise.all([
      variant ? this.staleReasons(userId, [variant]).then((m) => m.get(variant.id) ?? []) : Promise.resolve([]),
      variant ? this.sources(userId, variant.evidenceIds) : Promise.resolve({}),
      this.reuseOffers(userId, job.requirements, variant?.id ?? null),
    ]);

    return {
      status: record?.status ?? 'NONE',
      error: record?.error ?? null,
      // While waiting: since when, and whether a worker is running to pick it up — so the
      // UI can say "the background worker isn't running" instead of spinning forever.
      queuedAt: record?.status === 'PENDING' ? record.updatedAt : null,
      workerOnline: record?.status === 'PENDING' ? await this.queues.workerOnline() : null,
      reused: record?.reused ?? false,
      overlap: record?.overlap ?? null,
      // Tailoring works from the analysis's requirement list, so the job must be scored.
      // and an alert-only job needs its full description first: a resume tailored to a
      // two-line summary would be tailored to a guess (Agents.md §10.5).
      canTailor: job.analysisStatus === 'DONE' && !job.isPartial,
      needsDescription: job.isPartial,
      variant: variant && {
        id: variant.id,
        status: variant.status,
        model: variant.model,
        generatedAt: variant.generatedAt,
        approvedAt: variant.approvedAt,
        stale,
        content: ResumeContentSchema.parse(variant.content),
      },
      sources,
      reuse,
    };
  }

  // Every resume being tailored for this user, for the "Tailoring…" indicator shown on
  // every page — the work runs in the worker, so leaving the job's page never stops it.
  async active(userId: string) {
    const rows = await this.prisma.jobResume.findMany({
      where: { status: 'PENDING', job: { userId } },
      select: { jobId: true, updatedAt: true, job: { select: { title: true, company: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    return rows.map((r) => ({ jobId: r.jobId, title: r.job.title, company: r.job.company, queuedAt: r.updatedAt }));
  }

  async prepare(userId: string, jobId: string, input: PrepareResumeInput) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { analysisStatus: true, isPartial: true, requirements: { select: { skillName: true, importance: true } }, resume: true },
    });
    if (!job) throw new NotFoundException('Job not found');

    if (input.mode === 'reuse') {
      const variant = await this.prisma.resumeVariant.findFirst({ where: { id: input.variantId, userId } });
      if (!variant) throw new NotFoundException('Resume not found');
      // Reuse skips review, so only a resume the user approved — and that is still true — qualifies.
      if (variant.status !== 'APPROVED') throw new ConflictException('Only an approved resume can be reused');
      if ((await this.staleReasons(userId, [variant])).get(variant.id)?.length) {
        throw new ConflictException('That resume is out of date — evidence it uses has changed');
      }
      const { overlap } = resumeOverlap(job.requirements, variant.requirementProfile);
      const data = { status: 'READY' as const, error: null, variantId: variant.id, reused: true, overlap };
      await this.prisma.jobResume.upsert({ where: { jobId }, create: { jobId, ...data }, update: data });
      return this.forJob(userId, jobId);
    }

    if (job.isPartial) throw new ConflictException('Paste the full job description first — the alert only had a summary');
    if (job.analysisStatus !== 'DONE') throw new ConflictException('Score this job first — tailoring uses its requirements');
    if (job.resume?.status === 'PENDING') return this.forJob(userId, jobId); // already on its way
    await this.prisma.jobResume.upsert({
      where: { jobId },
      create: { jobId, status: 'PENDING' },
      update: { status: 'PENDING', error: null },
    });
    try {
      await this.queues.enqueueTailoring(jobId);
    } catch (err) {
      // Not queued, so don't leave the job looking like it's being tailored.
      await this.prisma.jobResume.update({ where: { jobId }, data: { status: 'FAILED', error: 'Job queue unavailable — try again' } });
      throw err;
    }
    return this.forJob(userId, jobId);
  }

  // "I've read every bullet and it's true." Its own endpoint, like verifying evidence.
  async approve(userId: string, variantId: string) {
    const variant = await this.prisma.resumeVariant.findFirst({ where: { id: variantId, userId } });
    if (!variant) throw new NotFoundException('Resume not found');
    if ((await this.staleReasons(userId, [variant])).get(variant.id)?.length) {
      throw new ConflictException('This resume is out of date — tailor it again before approving');
    }
    if (variant.status === 'APPROVED') return { id: variant.id, status: variant.status, approvedAt: variant.approvedAt };
    return this.prisma.resumeVariant.update({
      where: { id: variantId },
      data: { status: 'APPROVED', approvedAt: new Date() },
      select: { id: true, status: true, approvedAt: true },
    });
  }

  // Staleness is derived, never stored (Agents.md §13.3): a variant is out of date if any
  // evidence it relies on was deleted, un-verified, or changed after it was generated.
  // Every claim change (rewording, renaming a skill, editing a role) touches the evidence
  // row, so no write path has to remember to flag resumes.
  private async staleReasons(userId: string, variants: Pick<VariantRow, 'id' | 'evidenceIds' | 'generatedAt'>[]) {
    const ids = [...new Set(variants.flatMap((v) => v.evidenceIds))];
    const rows = ids.length
      ? await this.prisma.skillEvidence.findMany({
          where: { id: { in: ids }, skill: { userId } },
          select: { id: true, isVerified: true, updatedAt: true, skill: { select: { name: true } } },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return new Map(
      variants.map((v) => {
        const reasons = new Set<string>();
        for (const id of v.evidenceIds) {
          const e = byId.get(id);
          if (!e) reasons.add('An item it uses was deleted');
          else if (!e.isVerified) reasons.add(`${e.skill.name}: no longer verified`);
          else if (e.updatedAt > v.generatedAt) reasons.add(`${e.skill.name}: changed since`);
        }
        return [v.id, [...reasons]];
      }),
    );
  }

  // What each bullet was built from, for "show sources" in the review.
  private async sources(userId: string, ids: string[]) {
    const rows = await this.prisma.skillEvidence.findMany({
      where: { id: { in: ids }, skill: { userId } },
      select: { id: true, whatIDid: true, isVerified: true, skill: { select: { name: true } } },
    });
    return Object.fromEntries(rows.map((r) => [r.id, { skillName: r.skill.name, whatIDid: r.whatIDid, isVerified: r.isVerified }]));
  }

  // Approved, up-to-date resumes built for nearly the same requirements (Agents.md §13.2).
  private async reuseOffers(userId: string, requirements: { skillName: string; importance: Importance }[], currentId: string | null) {
    if (requirements.length === 0) return [];
    const [settingsRow, approved] = await Promise.all([
      this.prisma.aiSettings.findUnique({ where: { userId } }),
      this.prisma.resumeVariant.findMany({
        where: { userId, status: 'APPROVED', ...(currentId ? { id: { not: currentId } } : {}) },
        include: { jobs: { select: { job: { select: { title: true, company: true } } } } },
        orderBy: { approvedAt: 'desc' },
      }),
    ]);
    const min = aiSettingsFromRow(settingsRow).resumeReuseMinOverlap;
    const fits = approved
      .map((v) => ({ v, ...resumeOverlap(requirements, v.requirementProfile) }))
      .filter((x) => x.overlap >= min && x.missingRequired.length === 0);
    const stale = await this.staleReasons(userId, fits.map((x) => x.v));
    return fits
      .filter((x) => !stale.get(x.v.id)?.length)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, MAX_REUSE_OFFERS)
      .map((x) => ({
        variantId: x.v.id,
        overlap: x.overlap,
        approvedAt: x.v.approvedAt,
        usedFor: x.v.jobs.map((j) => `${j.job.title} at ${j.job.company}`),
      }));
  }
}
