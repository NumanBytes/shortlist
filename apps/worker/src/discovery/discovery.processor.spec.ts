import type { Job } from 'bullmq';
import { DiscoveryProcessor } from './discovery.processor.js';
import type { DiscoveryService, RunSummary } from './discovery.service.js';

describe('DiscoveryProcessor', () => {
  it("doesn't fail a stored discovery run when queuing its new jobs for analysis fails", async () => {
    const summary = { status: 'SUCCESS', newJobIds: ['j1', 'j2'] } as unknown as RunSummary;
    const runSource = vi.fn(async () => summary);
    const discovery = { runSource } as unknown as DiscoveryService;
    const analysisQueue = { addBulk: vi.fn(async () => Promise.reject(new Error('Connection is closed'))) };
    const processor = new DiscoveryProcessor(
      discovery,
      {} as never,
      {} as never,
      analysisQueue as never,
      { WORKER_CONCURRENCY: 1 } as never,
    );
    const job = { name: 'discover-source', id: '1', data: { sourceId: 's1' } } as unknown as Job;
    await expect(processor.process(job)).resolves.toBe(summary);
    expect(analysisQueue.addBulk).toHaveBeenCalled();
    expect(runSource).toHaveBeenCalledTimes(1); // not retried
  });
});
