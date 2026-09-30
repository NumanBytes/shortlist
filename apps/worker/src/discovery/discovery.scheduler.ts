import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DISCOVERY_QUEUE, DiscoveryJob } from '@shortlist/shared';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const NIGHTLY_SCHEDULER_ID = 'nightly-discovery';

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
  }
}
