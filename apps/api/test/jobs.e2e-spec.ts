import { DISCOVERY_QUEUE } from '@shortlist/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Jobs & discovery (e2e)', () => {
  let t: TestApp;
  let me: TestUser;
  let other: TestUser;
  let redis: Redis;
  let queue: Queue;

  beforeAll(async () => {
    t = await createTestApp();
    me = await t.register();
    other = await t.register();
    redis = new Redis('redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue(DISCOVERY_QUEUE, { connection: redis });
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
    await t.close();
  });

  const source = (who: TestUser, over: Record<string, unknown> = {}) =>
    t.prisma.jobSource.create({
      data: {
        userId: who.user.id,
        key: `greenhouse:${crypto.randomUUID()}`,
        name: 'Test Board',
        type: 'ATS_BOARD',
        config: { provider: 'greenhouse', board: 'test' },
        ...over,
      },
    });

  const job = (who: TestUser, over: Record<string, unknown> = {}) =>
    t.prisma.job.create({
      data: {
        userId: who.user.id,
        title: 'Frontend Engineer',
        company: 'Acme',
        rawJD: 'Build things in React.',
        dedupeHash: crypto.randomUUID(),
        source: 'remoteok',
        sourceUrl: 'https://remoteok.com/remote-jobs/1',
        ...over,
      },
    });

  describe('jobs', () => {
    it('requires authentication', async () => {
      await t.http().get('/api/v1/jobs').expect(401);
    });

    it("lists only the caller's jobs, newest first, without the description", async () => {
      await job(me, { title: 'Older', discoveredAt: new Date('2026-09-01') });
      await job(me, { title: 'Newer', discoveredAt: new Date('2026-09-30') });
      await job(other, { title: 'Not mine' });
      const res = await t.http().get('/api/v1/jobs').set(me.auth).expect(200);
      const titles = res.body.map((j: { title: string }) => j.title);
      expect(titles.indexOf('Newer')).toBeLessThan(titles.indexOf('Older'));
      expect(titles).not.toContain('Not mine');
      expect(res.body[0]).not.toHaveProperty('rawJD');
      expect(res.body[0]).toMatchObject({ source: 'remoteok', sourceUrl: expect.stringMatching(/^https:/) });
    });

    it('filters by status and validates it', async () => {
      await job(me, { title: 'Skipped one', status: 'SKIPPED' });
      const res = await t.http().get('/api/v1/jobs?status=SKIPPED').set(me.auth).expect(200);
      expect(res.body.every((j: { status: string }) => j.status === 'SKIPPED')).toBe(true);
      await t.http().get('/api/v1/jobs?status=NOPE').set(me.auth).expect(400);
    });

    it('returns the full description on GET /jobs/:id, 404 for others', async () => {
      const j = await job(me);
      const res = await t.http().get(`/api/v1/jobs/${j.id}`).set(me.auth).expect(200);
      expect(res.body.rawJD).toBe('Build things in React.');
      await t.http().get(`/api/v1/jobs/${j.id}`).set(other.auth).expect(404);
    });

    it('moves a job through statuses and records when the user applied', async () => {
      const j = await job(me);
      const applied = await t.http().patch(`/api/v1/jobs/${j.id}`).set(me.auth).send({ status: 'APPLIED' }).expect(200);
      expect(applied.body).toMatchObject({ status: 'APPLIED', appliedAt: expect.any(String) });
      await t.http().patch(`/api/v1/jobs/${j.id}`).set(other.auth).send({ status: 'SKIPPED' }).expect(404);
      await t.http().patch(`/api/v1/jobs/${j.id}`).set(me.auth).send({ status: 'SUBMITTED_BY_BOT' }).expect(400);
    });
  });

  describe('discovery sources', () => {
    it('lists sources with last-run health and whether the worker supports them', async () => {
      const s = await source(me, { lastRunStatus: 'FAILED', lastRunAt: new Date() });
      await t.prisma.discoveryRun.create({
        data: { jobSourceId: s.id, status: 'FAILED', errorMessage: 'HTTP 503', finishedAt: new Date() },
      });
      await source(me, {
        key: 'zohorecruit:x',
        name: 'Planned Co',
        isEnabled: false,
        config: { provider: 'zohorecruit', url: 'https://x.zohorecruit.com/jobs/Careers' },
      });
      const res = await t.http().get('/api/v1/discovery/sources').set(me.auth).expect(200);
      const board = res.body.find((x: { id: string }) => x.id === s.id);
      expect(board).toMatchObject({ provider: 'greenhouse', supported: true, lastRun: { status: 'FAILED', errorMessage: 'HTTP 503' } });
      expect(board).not.toHaveProperty('config');
      expect(res.body.find((x: { name: string }) => x.name === 'Planned Co')).toMatchObject({ supported: false });
    });

    it('can disable a source, but not enable one whose platform has no adapter', async () => {
      const s = await source(me);
      await t.http().patch(`/api/v1/discovery/sources/${s.id}`).set(me.auth).send({ isEnabled: false }).expect(200);
      const planned = await source(me, {
        isEnabled: false,
        config: { provider: 'jazzhr', url: 'https://x.applytojob.com/apply' },
      });
      const res = await t.http()
        .patch(`/api/v1/discovery/sources/${planned.id}`)
        .set(me.auth)
        .send({ isEnabled: true })
        .expect(400);
      expect(res.body.message).toMatch(/isn't supported yet/);
      await t.http().patch(`/api/v1/discovery/sources/${s.id}`).set(other.auth).send({ isEnabled: true }).expect(404);
    });

    it('"run now" queues due sources for the worker and skips recently-run ones', async () => {
      const user = await t.register();
      const due = await source(user, { name: 'Due' });
      await source(user, { name: 'Ran an hour ago', lastRunAt: new Date(Date.now() - 3600 * 1000) });
      await source(user, { name: 'Disabled', isEnabled: false });

      const res = await t.http().post('/api/v1/discovery/run').set(user.auth).expect(202);
      expect(res.body).toMatchObject({ queued: ['Due'], skipped: ['Ran an hour ago'], cooldownHours: 6 });

      const queued = (await queue.getJobs(['waiting', 'delayed', 'active'])).filter((j) => j.data.sourceId === due.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]!.name).toBe('discover-source');
      await Promise.all(queued.map((j) => j.remove()));
    });
  });
});
