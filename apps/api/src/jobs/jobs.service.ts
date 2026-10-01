import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@shortlist/db';
import type { ListJobsQuery, UpdateJobInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';

// The list omits the description (rawJD can be several KB per job); GET /jobs/:id has it.
const LIST_SELECT = {
  id: true,
  title: true,
  company: true,
  location: true,
  workMode: true,
  source: true,
  sourceUrl: true,
  status: true,
  postedAt: true,
  discoveredAt: true,
  lastSeenAt: true,
  appliedAt: true,
  jobSource: { select: { id: true, name: true } },
  analysisStatus: true,
  analysisError: true,
  redFlags: true, // a suspected scam is flagged on the card itself
  match: { select: { overallScore: true, commercialScore: true, verdict: true } },
} satisfies Prisma.JobSelect;

// Everything the job detail view shows about the analysis.
const DETAIL_SELECT = {
  ...LIST_SELECT,
  rawJD: true,
  seniority: true,
  yearsRequired: true,
  analyzedAt: true,
  requirements: {
    select: { skillName: true, importance: true, isCore: true, yearsRequired: true, matchedSkillIds: true, relatedSkillIds: true },
    orderBy: [{ isCore: 'desc' }, { importance: 'asc' }],
  },
  match: {
    select: {
      overallScore: true,
      commercialScore: true,
      verdict: true,
      strengths: true,
      risks: true,
      computedAt: true,
      gaps: { select: { skillName: true, severity: true, note: true }, orderBy: { severity: 'asc' } },
    },
  },
} satisfies Prisma.JobSelect;

const LIST_LIMIT = 200;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: JobQueues,
  ) {}

  async list(userId: string, query: ListJobsQuery) {
    const where = { userId, ...(query.status ? { status: query.status } : {}) };
    if (query.sort === 'recent') {
      return this.prisma.job.findMany({ where, select: LIST_SELECT, orderBy: { discoveredAt: 'desc' }, take: LIST_LIMIT });
    }
    // Best match first across ALL scored jobs, then unscored ones (newest first) to fill
    // the page. Two queries because Prisma can't order a relation field NULLS LAST, and
    // Postgres puts NULLs first in a DESC sort.
    const scored = await this.prisma.job.findMany({
      where: { ...where, match: { isNot: null } },
      select: LIST_SELECT,
      orderBy: [{ match: { overallScore: 'desc' } }, { discoveredAt: 'desc' }],
      take: LIST_LIMIT,
    });
    const room = LIST_LIMIT - scored.length;
    const unscored =
      room > 0
        ? await this.prisma.job.findMany({
            where: { ...where, match: { is: null } },
            select: LIST_SELECT,
            orderBy: { discoveredAt: 'desc' },
            take: room,
          })
        : [];
    return [...scored, ...unscored];
  }

  // Queue (or re-queue) one job for analysis — e.g. after a failure or a deferral. The
  // worker's budget guard still decides whether it actually runs.
  async analyze(userId: string, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, userId },
      select: { analysisStatus: true, analyzedSkillIds: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.analysisStatus === 'DONE') {
      // Re-analysis costs money, so it's only allowed when it can change the answer: the
      // user has verified a skill the last analysis never saw.
      const verified = await this.prisma.skill.findMany({
        where: { userId, evidence: { some: { isVerified: true } } },
        select: { id: true },
      });
      const seen = new Set(job.analyzedSkillIds);
      if (verified.every((s) => seen.has(s.id))) {
        throw new ConflictException('Already analysed against your current verified skills');
      }
    }
    await this.prisma.job.update({ where: { id }, data: { analysisStatus: 'PENDING', analysisError: null } });
    await this.queues.enqueueAnalysis(id, `manual-${Date.now()}`);
    return { queued: true };
  }

  async get(userId: string, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, userId },
      select: DETAIL_SELECT,
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async update(userId: string, id: string, input: UpdateJobInput) {
    const { count } = await this.prisma.job.updateMany({
      where: { id, userId },
      data: {
        status: input.status,
        // Record when the user says they applied; clear it if they undo that.
        appliedAt: input.status === 'APPLIED' ? new Date() : input.status === 'DISCOVERED' ? null : undefined,
      },
    });
    if (count === 0) throw new NotFoundException('Job not found');
    return this.prisma.job.findUniqueOrThrow({ where: { id }, select: LIST_SELECT });
  }
}
