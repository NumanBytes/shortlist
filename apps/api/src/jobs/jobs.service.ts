import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@shortlist/db';
import type { ListJobsQuery, UpdateJobInput } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';

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
} satisfies Prisma.JobSelect;

const LIST_LIMIT = 200;

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, query: ListJobsQuery) {
    return this.prisma.job.findMany({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      select: LIST_SELECT,
      orderBy: { discoveredAt: 'desc' },
      take: LIST_LIMIT,
    });
  }

  async get(userId: string, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, userId },
      select: { ...LIST_SELECT, rawJD: true },
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
