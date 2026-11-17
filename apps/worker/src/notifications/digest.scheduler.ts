import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DIGEST_SCHEDULER_ID, NOTIFICATIONS_QUEUE, NotifyJob } from '@shortlist/shared';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

// The morning digest, scheduled in Redis like discovery (docs/discovery.md §9.8): idempotent across
// restarts and worker copies. It fires every hour; each firing sends to the users whose own
// clock has reached DIGEST_HOUR (docs/notifications.md §19.4). Its key per user-local day
// ("digest:2026-10-13") makes a second firing that day a no-op.
const HOURLY = '0 * * * *';

@Injectable()
export class DigestScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DigestScheduler.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      DIGEST_SCHEDULER_ID,
      { pattern: HOURLY, tz: 'UTC' },
      { name: NotifyJob.Digest, data: {}, opts: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } } },
    );
    this.logger.log(`Morning digest at ${this.env.DIGEST_HOUR}:00 on each user's clock (checked hourly)`);
  }
}
