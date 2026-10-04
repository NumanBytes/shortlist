import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_MS } from '@shortlist/shared';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { HeartbeatService } from './heartbeat.service.js';

// Against the real local Redis: the API decides "is a worker running?" from this key alone.
describe('HeartbeatService', () => {
  const redis = new Redis('redis://localhost:6379', { maxRetriesPerRequest: 1 });
  afterAll(() => redis.quit());

  it('keeps a short-lived key while running, and removes it on a clean stop', async () => {
    const heartbeat = new HeartbeatService({ REDIS_URL: 'redis://localhost:6379' } as Env);
    await heartbeat.onApplicationBootstrap();
    expect(await redis.get(WORKER_HEARTBEAT_KEY)).not.toBeNull();
    const ttl = await redis.pttl(WORKER_HEARTBEAT_KEY);
    // It expires on its own if the process dies without a clean stop.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WORKER_HEARTBEAT_TTL_MS);

    await heartbeat.onApplicationShutdown();
    expect(await redis.get(WORKER_HEARTBEAT_KEY)).toBeNull();
  });
});
