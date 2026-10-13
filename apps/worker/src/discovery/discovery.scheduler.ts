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

  // A worker that isn't running at 02:00 (a laptop asleep, a deploy at that minute) misses
  // the night, and the scheduler only ever looks forward. So on start, if no board has been
  // run for over a day, run them all now (docs/discovery.md §9.8). Decided from Postgres, not
  // Redis, so it's right whatever the queue lost. Failing here must not stop the worker.
  private async catchUp() {
    try {
      const last = await this.prisma.discoveryRun.findFirst({
        where: { jobSource: { isEnabled: true, type: { not: 'EMAIL_INBOX' } } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });
      const anyEnabled = await this.prisma.jobSource.count({
        where: { isEnabled: true, type: { not: 'EMAIL_INBOX' } },
      });
      const now = new Date();
      if (!anyEnabled || !needsCatchUp(last?.startedAt ?? null, now)) return;
      // One id per hour: two workers starting together queue one catch-up, not two.
      await this.queue.add(DiscoveryJob.All, {}, { jobId: `catch-up__${now.toISOString().slice(0, 13)}` });
      this.logger.log(`No discovery run since ${last?.startedAt.toISOString() ?? 'ever'} — running one now`);
    } catch (err) {
      this.logger.warn(`Couldn't check for a missed discovery run: ${(err as Error).message}`);
    }
  }
}
