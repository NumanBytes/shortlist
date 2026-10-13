import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DISCOVERY_QUEUE, DiscoveryJob, NIGHTLY_DISCOVERY_SCHEDULER_ID } from '@shortlist/shared';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const NIGHTLY_SCHEDULER_ID = NIGHTLY_DISCOVERY_SCHEDULER_ID;

// A nightly run plus an hour's slack. Longer than this since any board run started means a
// night was missed.
export const CATCH_UP_AFTER_MS = 25 * 3600_000;

export const CATCH_UP_DELAY_MS = 5 * 60_000;

export interface DiscoverAllData {
  catchUp?: boolean; // queued by a worker that started after a missed night
}

// When the latest board (not email) run started, across enabled sources.
export async function lastBoardRunStart(prisma: PrismaService): Promise<Date | null> {
  const last = await prisma.discoveryRun.findFirst({
    where: { jobSource: { isEnabled: true, type: { not: 'EMAIL_INBOX' } } },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  return last?.startedAt ?? null;
}

// Whether a worker that just started should run discovery now rather than wait for tonight.
export function needsCatchUp(lastStartedAt: Date | null, now: Date): boolean {
  return !lastStartedAt || now.getTime() - lastStartedAt.getTime() > CATCH_UP_AFTER_MS;
}

// The schedule lives in Redis as a BullMQ job scheduler, not in this process's memory.
// Upserting is idempotent, so any number of worker instances can start (or restart)
// and there is still exactly one scheduled run per night — an in-process cron would
// fire once per instance. Changing DISCOVERY_CRON and restarting updates it in place.
@Injectable()
export class DiscoveryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiscoveryScheduler.name);

  constructor(
    @InjectQueue(DISCOVERY_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      NIGHTLY_SCHEDULER_ID,
      { pattern: this.env.DISCOVERY_CRON, tz: this.env.DISCOVERY_TZ },
      { name: DiscoveryJob.All, data: {}, opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } } },
    );
    const scheduler = await this.queue.getJobScheduler(NIGHTLY_SCHEDULER_ID);
    const next = scheduler?.next ? new Date(scheduler.next).toISOString() : 'unknown';
    this.logger.log(`Nightly discovery "${this.env.DISCOVERY_CRON}" (${this.env.DISCOVERY_TZ}); next run ${next}`);
    await this.catchUp();
  }

  // A worker that isn't running at 02:00 (a laptop asleep, a deploy at that minute) may miss
  // the night — whether BullMQ later runs the overdue job depends on what Redis kept. So on
  // start, if no board has been run for over a day, queue a catch-up (docs/discovery.md §9.8).
  // Decided from Postgres, not Redis, so it's right whatever the queue lost. Failing here must
  // not stop the worker.
  private async catchUp() {
    try {
      const anyEnabled = await this.prisma.jobSource.count({
        where: { isEnabled: true, type: { not: 'EMAIL_INBOX' } },
      });
      const last = await lastBoardRunStart(this.prisma);
      const now = new Date();
      if (!anyEnabled || !needsCatchUp(last, now)) return;
      // Queued with a delay, and re-checked when it runs (DiscoveryProcessor): if the missed
      // nightly job is still in Redis, BullMQ may run it now too, and by then its runs will
      // have started — so the catch-up steps aside instead of fetching everything twice
      // (code review 2026-10-13). One id per hour: two workers starting together queue one.
      const data: DiscoverAllData = { catchUp: true };
      await this.queue.add(DiscoveryJob.All, data, {
        jobId: `catch-up__${now.toISOString().slice(0, 13)}`,
        delay: CATCH_UP_DELAY_MS,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      });
      this.logger.log(`No discovery run since ${last?.toISOString() ?? 'ever'} — catching up shortly`);
    } catch (err) {
      this.logger.warn(`Couldn't check for a missed discovery run: ${(err as Error).message}`);
    }
  }
}
