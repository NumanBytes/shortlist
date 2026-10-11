import { Redis } from 'ioredis';

// BullMQ needs maxRetriesPerRequest: null so blocking commands wait for Redis to come
// back instead of throwing. ioredis takes the URL directly, including rediss:// (TLS).
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
