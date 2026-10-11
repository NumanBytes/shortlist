import { Queue } from 'bullmq';
import { queueJobOptions, safeJobId } from '@shortlist/shared';
import { createRedis } from '../redis.js';
import { enqueueAnalyses } from './analysis.processor.js';

// Against the real local Redis, on a throwaway queue.
describe('analysis enqueueing', () => {
  const connection = createRedis('redis://localhost:6379');
  const queue = new Queue(`analysis-test-${Date.now()}`, { connection });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  });

  it('queues one analysis per job even when discovery, the sweep and "Retry" all add it', async () => {
    await enqueueAnalyses(queue, ['job-1'], 'new-abc');
    await enqueueAnalyses(queue, ['job-1'], 'sweep-def');
    await enqueueAnalyses(queue, ['job-1', 'job-2'], 'manual-123');
    const waiting = await queue.getJobs(['waiting', 'delayed']);
    expect(waiting.map((j) => j.data.jobId as string).sort((a, b) => a.localeCompare(b))).toEqual(['job-1', 'job-2']);
  });

  it('accepts scheduler-fired batch ids, which contain colons', async () => {
    await expect(
      enqueueAnalyses(queue, ['job-3'], 'sweep-repeat:nightly-analysis-sweep:1790812800000'),
    ).resolves.toBeUndefined();
    expect(safeJobId('repeat:a:b:c')).toBe('repeat-a-b-c');
    expect(queueJobOptions.discoverSource('src', 'repeat:nightly-discovery:1790812800000').jobId).not.toContain(':');
  });
});
