import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ANALYSIS_QUEUE, AnalysisJob } from '@shortlist/shared';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const ANALYSIS_SCHEDULER_ID = 'nightly-analysis-sweep';

// Same pattern as discovery (§9.8): stored in Redis, upserted idempotently. Runs an hour
// after discovery so the night's new jobs are already stored.
@Injectable()
export class AnalysisScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AnalysisScheduler.name);

  constructor(
    @InjectQueue(ANALYSIS_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      ANALYSIS_SCHEDULER_ID,
      { pattern: this.env.ANALYSIS_CRON, tz: this.env.DISCOVERY_TZ },
      { name: AnalysisJob.Sweep, data: {}, opts: { attempts: 2 } },
    );
    if (!this.env.ANTHROPIC_API_KEY) {
      this.logger.warn('ANTHROPIC_API_KEY is not set — jobs will be discovered but analysis deferred');
    }
    this.logger.log(`Nightly analysis sweep "${this.env.ANALYSIS_CRON}" (${this.env.DISCOVERY_TZ})`);
  }
}
