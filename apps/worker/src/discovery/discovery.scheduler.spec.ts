import { DiscoveryJob } from '@shortlist/shared';
import { DiscoveryScheduler, needsCatchUp } from './discovery.scheduler.js';

const NOW = new Date('2026-10-13T08:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe('needsCatchUp', () => {
  it('runs when no board has ever run, or the last run is over a day old', () => {
    expect(needsCatchUp(null, NOW)).toBe(true);
    expect(needsCatchUp(hoursAgo(30), NOW)).toBe(true);
  });

  it("waits for tonight when last night's run happened", () => {
    expect(needsCatchUp(hoursAgo(6), NOW)).toBe(false);
    expect(needsCatchUp(hoursAgo(24.5), NOW)).toBe(false);
  });
});

describe('DiscoveryScheduler', () => {
  const make = (lastStartedAt: Date | null, enabled = 3) => {
    const queue = {
      upsertJobScheduler: vi.fn(async () => undefined),
      getJobScheduler: vi.fn(async () => null),
      add: vi.fn(async () => undefined),
    };
    const prisma = {
      discoveryRun: { findFirst: vi.fn(async () => (lastStartedAt ? { startedAt: lastStartedAt } : null)) },
      jobSource: { count: vi.fn(async () => enabled) },
    };
    const env = { DISCOVERY_CRON: '0 2 * * *', DISCOVERY_TZ: 'Asia/Karachi' };
    return { queue, scheduler: new DiscoveryScheduler(queue as never, env as never, prisma as never) };
  };

  it('queues a catch-up run on start when a night was missed', async () => {
    const { queue, scheduler } = make(new Date(Date.now() - 3 * 86_400_000));
    await scheduler.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledWith(DiscoveryJob.All, {}, { jobId: expect.stringMatching(/^catch-up__/) });
  });

  it("doesn't when the boards ran recently, or none is enabled", async () => {
    const recent = make(new Date(Date.now() - 3600_000));
    await recent.scheduler.onApplicationBootstrap();
    expect(recent.queue.add).not.toHaveBeenCalled();
    const none = make(null, 0);
    await none.scheduler.onApplicationBootstrap();
    expect(none.queue.add).not.toHaveBeenCalled();
  });
});
