import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ImplementedSourceConfigSchema,
  JobSourceConfigSchema,
  MANUAL_RUN_COOLDOWN_HOURS,
  type UpdateJobSourceInput,
} from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { DiscoveryQueue } from '../queue/discovery-queue.js';

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: DiscoveryQueue,
  ) {}

  // Each source with its most recent run — the health view. A FAILED or EMPTY source
  // is shown as such, never folded into "no jobs today".
  async listSources(userId: string) {
    const sources = await this.prisma.jobSource.findMany({
      where: { userId },
      orderBy: [{ isEnabled: 'desc' }, { name: 'asc' }],
      include: {
        discoveryRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
        _count: { select: { jobs: true } },
      },
    });
    return sources.map(({ discoveryRuns, _count, config, ...s }) => {
      const parsed = JobSourceConfigSchema.safeParse(config);
      return {
        ...s,
        provider: parsed.success ? parsed.data.provider : 'unknown',
        // Whether the worker can run it yet (vs. recorded for a later milestone).
        supported: ImplementedSourceConfigSchema.safeParse(config).success,
        jobCount: _count.jobs,
        lastRun: discoveryRuns[0] ?? null,
      };
    });
  }

  async setEnabled(userId: string, id: string, input: UpdateJobSourceInput) {
    const source = await this.prisma.jobSource.findFirst({ where: { id, userId } });
    if (!source) throw new NotFoundException('Source not found');
    if (input.isEnabled && !ImplementedSourceConfigSchema.safeParse(source.config).success) {
      throw new BadRequestException("This source's platform isn't supported yet, so it can't be enabled");
    }
    return this.prisma.jobSource.update({ where: { id }, data: { isEnabled: input.isEnabled } });
  }

  // "Run now": queue the user's enabled sources — except any that ran recently, so a
  // user tapping the button can't break an aggregator's request limits.
  async runNow(userId: string) {
    const cutoff = new Date(Date.now() - MANUAL_RUN_COOLDOWN_HOURS * 3600 * 1000);
    const sources = await this.prisma.jobSource.findMany({
      where: { userId, isEnabled: true },
      select: { id: true, name: true, lastRunAt: true },
    });
    const due = sources.filter((s) => !s.lastRunAt || s.lastRunAt < cutoff);
    await this.queue.enqueueSources(
      due.map((s) => s.id),
      `manual-${Date.now()}`,
    );
    return {
      queued: due.map((s) => s.name),
      skipped: sources.filter((s) => !due.includes(s)).map((s) => s.name),
      cooldownHours: MANUAL_RUN_COOLDOWN_HOURS,
    };
  }
}
