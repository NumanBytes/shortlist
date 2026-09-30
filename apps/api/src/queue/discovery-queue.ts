import { Inject, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { DISCOVERY_QUEUE, DiscoveryJob, type DiscoverSourceData } from '@shortlist/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

// How long an HTTP request may wait on Redis. Depending on connection state, a dead
// Redis either errors immediately ("Connection is closed") or makes BullMQ wait for a
// ready connection indefinitely — both were observed. Either way the caller gets a 503.
const ENQUEUE_TIMEOUT_MS = 3000;
const UNAVAILABLE = 'Job queue unavailable — try again shortly';

// The API's side of the queue: it only ever adds jobs; apps/worker processes them.
@Injectable()
export class DiscoveryQueue implements OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryQueue.name);
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(@Inject(ENV) env: Env) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    this.connection.on('error', () => undefined); // surfaced per request as a 503 instead
    this.queue = new Queue(DISCOVERY_QUEUE, { connection: this.connection });
    this.queue.on('error', () => undefined);
  }

  async enqueueSources(sourceIds: string[], batchId: string): Promise<void> {
    if (sourceIds.length === 0) return;
    const add = this.queue.addBulk(
      sourceIds.map((sourceId) => ({
        name: DiscoveryJob.Source,
        data: { sourceId } satisfies DiscoverSourceData,
        // Same retry policy as the nightly fan-out; ids can't contain ":".
        opts: {
          jobId: `${sourceId}__${batchId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
          removeOnFail: { age: 30 * 24 * 3600 },
        },
      })),
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no response from Redis in ${ENQUEUE_TIMEOUT_MS}ms`)), ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([add, timeout]);
    } catch (err) {
      this.logger.error(`Enqueue failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    } finally {
      clearTimeout(timer);
      add.catch(() => undefined); // if the timeout won, don't leave an unhandled rejection
    }
  }

  async onModuleDestroy() {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }
}
