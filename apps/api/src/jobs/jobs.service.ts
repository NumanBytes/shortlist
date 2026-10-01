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
    const jobs = await this.prisma.job.findMany({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      select: LIST_SELECT,
      orderBy: { discoveredAt: 'desc' },
      take: LIST_LIMIT,
    });
    if (query.sort === 'recent') return jobs;
    // Best match first, unscored last. Sorted here because Prisma can't order a relation
    // field with NULLS LAST, and Postgres puts NULLs first in a DESC sort.
    return jobs.sort((a, b) => (b.match?.overallScore ?? -1) - (a.match?.overallScore ?? -1));
  }

  // Queue (or re-queue) one job for analysis — e.g. after a failure or a deferral. The
  // worker's budget guard still decides whether it actually runs.
  async analyze(userId: string, id: string) {
    const job = await this.prisma.job.findFirst({ where: { id, userId }, select: { analysisStatus: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.analysisStatus === 'DONE') throw new ConflictException('This job is already analysed');
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
