import type { JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

// BullMQ needs maxRetriesPerRequest: null so blocking commands wait for Redis to come
// back instead of throwing. ioredis takes the URL directly, including rediss:// (TLS).
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

// Per-source jobs: retry transient failures (timeouts, 5xx) with backoff — every
// attempt is its own DiscoveryRun row, so retries are visible, not silent.
export const SOURCE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

// BullMQ custom job ids can't contain ":".
export const sourceJobId = (sourceId: string, batchId: string) => `${sourceId}__${batchId}`;
