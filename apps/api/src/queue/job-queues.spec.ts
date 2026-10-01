import { ServiceUnavailableException } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { JobQueues } from './job-queues.js';

describe('JobQueues', () => {
  it('fails fast with a 503 when Redis is unreachable, instead of hanging the request', async () => {
    // Nothing listens on this port.
    const queue = new JobQueues({ REDIS_URL: 'redis://127.0.0.1:6390' } as Env);
    const started = Date.now();
    await expect(queue.enqueueSources(['source-1'], 'batch')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Date.now() - started).toBeLessThan(5000);
    await queue.onModuleDestroy();
  }, 10_000);

  it('does nothing (and needs no Redis) when there is nothing to queue', async () => {
    const queue = new JobQueues({ REDIS_URL: 'redis://127.0.0.1:6390' } as Env);
    await expect(queue.enqueueSources([], 'batch')).resolves.toBeUndefined();
    await queue.onModuleDestroy();
  });
});

describe('JobQueues.enqueueAnalysis', () => {
  it('also fails fast with a 503 when Redis is unreachable', async () => {
    const queues = new JobQueues({ REDIS_URL: 'redis://127.0.0.1:6390' } as Env);
    await expect(queues.enqueueAnalysis('job-1', 'b')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await queues.onModuleDestroy();
  }, 10_000);
});
