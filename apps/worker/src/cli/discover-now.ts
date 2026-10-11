// Development helper: queue a discovery run for every enabled source right now,
// instead of waiting for the nightly schedule. The running worker picks it up.
//   pnpm --filter @shortlist/worker discover
import { DISCOVERY_QUEUE, DiscoveryJob } from '@shortlist/shared';
import { Queue } from 'bullmq';
import { loadEnv } from '../config/env.js';
import { createRedis } from '../redis.js';

const env = loadEnv();
const connection = createRedis(env.REDIS_URL);
const queue = new Queue(DISCOVERY_QUEUE, { connection });
const job = await queue.add(DiscoveryJob.All, {}, { jobId: `manual-${Date.now()}` });
console.log(`Queued ${DiscoveryJob.All} (job ${job.id}). Watch the worker's log for per-source results.`);
await queue.close();
await connection.quit();
