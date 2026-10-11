import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_MS } from '@shortlist/shared';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

// "Is anything consuming the queues?" (docs/architecture.md §4). The API can only add jobs; without
// this, a stopped worker looks exactly like a slow one — the UI said "Tailoring…" for
// over ten minutes while nothing was running. A key with a TTL is a dead-man's switch:
// the worker keeps renewing it, and if the process dies (even without a clean shutdown)
// the key expires on its own within WORKER_HEARTBEAT_TTL_MS.
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HeartbeatService.name);
  // Its own connection, failing fast: BullMQ's connections wait forever on a dead Redis,
  // and a heartbeat that hangs is worse than one that's skipped.
  private readonly redis: Redis;
  private timer: NodeJS.Timeout | undefined;

  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    this.redis.on('error', () => undefined); // logged per beat instead
  }

  async onApplicationBootstrap() {
    await this.beat();
    this.timer = setInterval(() => void this.beat(), WORKER_HEARTBEAT_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    // A clean stop says so immediately instead of waiting for the TTL.
    await this.redis.del(WORKER_HEARTBEAT_KEY).catch(() => undefined);
    this.redis.disconnect();
  }

  private async beat() {
    try {
      await this.redis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'PX', WORKER_HEARTBEAT_TTL_MS);
    } catch (err) {
      this.logger.warn(`Heartbeat failed: ${(err as Error).message}`);
    }
  }
}
