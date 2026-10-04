import type { Env } from '../config/env.js';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('fails open, quickly, when Redis is unreachable — an outage must not lock everyone out', async () => {
    const limiter = new RateLimiter({ REDIS_URL: 'redis://127.0.0.1:6390' } as Env); // nothing listens here
    const started = Date.now();
    await expect(limiter.hit('k', { limit: 1, windowSeconds: 60 })).resolves.toMatchObject({ allowed: true });
    await expect(limiter.peek('k', { limit: 1, windowSeconds: 60 })).resolves.toMatchObject({ allowed: true });
    expect(Date.now() - started).toBeLessThan(5000);
    limiter.onModuleDestroy();
  }, 10_000);
});
