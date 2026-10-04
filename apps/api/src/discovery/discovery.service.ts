import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ImplementedSourceConfigSchema,
  JobSourceConfigSchema,
  MANUAL_RUN_COOLDOWN_HOURS,
  isBoardProvider,
  parseBoardAddress,
  type UpdateJobSourceInput,
  type UpdateSourceAddressInput,
} from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';

const boardNameOf = (config: unknown): string | null => {
  const c = (config ?? {}) as Record<string, unknown>;
  const name = c.board ?? c.site ?? c.company ?? c.account;
  return typeof c.provider === 'string' && isBoardProvider(c.provider) && typeof name === 'string' ? name : null;
};

const COOLDOWN_MS = MANUAL_RUN_COOLDOWN_HOURS * 3600 * 1000;
const RUNNING_WINDOW_MS = 30 * 60 * 1000;

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueues,
  ) {}

  // Each source with its most recent run — the health view. A FAILED or EMPTY source
  // is shown as such, never folded into "no jobs today".
  async listSources(userId: string) {
    // Email-alert sources are shown on the Gmail card instead (they aren't fetched).
    const sources = await this.prisma.jobSource.findMany({
      where: { userId, type: { not: 'EMAIL_INBOX' } },
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
        // The company board's name, for "Edit URL" (null for aggregators — fixed addresses).
        board: boardNameOf(config),
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

  // "Find new jobs": queue the user's enabled sources — except any that ran recently, so a
  // user tapping the button can't break an aggregator's request limits — and, if Gmail is
  // connected, a check of the alert label too, so one button covers every source.
  async runNow(userId: string) {
    const cutoff = new Date(Date.now() - COOLDOWN_MS);
    const [sources, gmail] = await Promise.all([
      this.prisma.jobSource.findMany({
        where: { userId, isEnabled: true, type: { not: 'EMAIL_INBOX' } },
        select: { id: true, name: true, lastRunAt: true },
      }),
      this.prisma.gmailConnection.findUnique({ where: { userId }, select: { status: true } }),
    ]);
    const due = sources.filter((s) => !s.lastRunAt || s.lastRunAt < cutoff);
    await this.queue.enqueueSources(
      due.map((s) => s.id),
      `manual-${Date.now()}`,
    );
    // Best effort: the inbox is also checked every two hours on its own schedule.
    const emailQueued = gmail?.status === 'ACTIVE' && (await this.queue.enqueueEmailCheck(userId).then(() => true, () => false));
    return {
      queued: due.map((s) => s.name),
      skipped: sources.filter((s) => !due.includes(s)).map((s) => s.name),
      cooldownHours: MANUAL_RUN_COOLDOWN_HOURS,
      emailQueued,
    };
  }

  // What the Jobs page needs to say how fresh the list is and whether "Find new jobs" can
  // do anything: when sources last finished, whether a run is in progress, when the button
  // will next queue something, when the nightly run fires, and whether a worker is running
  // at all (without one, queued work just waits — Agents.md §4).
  async status(userId: string) {
    const [sources, running, workerOnline, nextNightlyAt, jobsThisWeek] = await Promise.all([
      this.prisma.jobSource.findMany({
        where: { userId, isEnabled: true, type: { not: 'EMAIL_INBOX' } },
        select: { lastRunAt: true },
      }),
      this.prisma.discoveryRun.count({
        // A run row older than this is a crashed attempt, not one still going.
        where: { status: 'RUNNING', startedAt: { gte: new Date(Date.now() - RUNNING_WINDOW_MS) }, jobSource: { userId } },
      }),
      this.queue.workerOnline(),
      this.queue.nextNightlyDiscovery(),
      // Every job found in the last 7 days, from boards and alert emails alike.
      this.prisma.job.count({ where: { userId, discoveredAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
    ]);
    const finished = sources.flatMap((s) => (s.lastRunAt ? [s.lastRunAt.getTime()] : []));
    // A source that never ran is due now; otherwise each is due once its cooldown passes.
    const dueTimes = sources.map((s) => (s.lastRunAt ? s.lastRunAt.getTime() + COOLDOWN_MS : 0));
    const firstDue = dueTimes.length ? Math.min(...dueTimes) : null;
    return {
      enabledSources: sources.length,
      lastCheckedAt: finished.length ? new Date(Math.max(...finished)) : null,
      running,
      availableAt: firstDue !== null && firstDue > Date.now() ? new Date(firstDue) : null,
      nextNightlyAt,
      workerOnline,
      cooldownHours: MANUAL_RUN_COOLDOWN_HOURS,
      jobsThisWeek,
    };
  }

  // "Edit URL" on a company board that failed (the board may have moved). Only the board's
  // name is stored; a new address also clears the cooldown so it can be retried at once.
  async setAddress(userId: string, id: string, input: UpdateSourceAddressInput) {
    const source = await this.prisma.jobSource.findFirst({ where: { id, userId } });
    if (!source) throw new NotFoundException('Source not found');
    const provider = (source.config as { provider?: string } | null)?.provider ?? '';
    if (!isBoardProvider(provider)) throw new BadRequestException("This source's address can't be edited");
    const parsed = parseBoardAddress(provider, input.address);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    return this.prisma.jobSource.update({
      where: { id },
      data: { config: parsed.config, lastRunAt: null, lastRunStatus: null },
      select: { id: true, config: true },
    });
  }

  // "Retry" on one source that failed or came back empty. Same cooldown as "run now", so a
  // tap can't hammer a board; 409 says when it can run again.
  async runOne(userId: string, id: string) {
    const source = await this.prisma.jobSource.findFirst({ where: { id, userId, type: { not: 'EMAIL_INBOX' } } });
    if (!source) throw new NotFoundException('Source not found');
    if (!source.isEnabled) throw new ConflictException('Turn the source on first');
    if (source.lastRunAt && source.lastRunAt.getTime() > Date.now() - COOLDOWN_MS) {
      const at = new Date(source.lastRunAt.getTime() + COOLDOWN_MS);
      throw new ConflictException(`It ran recently — it can run again at ${at.toISOString().slice(11, 16)} UTC`);
    }
    await this.queue.enqueueSources([id], `retry-${Date.now()}`);
    return { queued: true };
  }
}
