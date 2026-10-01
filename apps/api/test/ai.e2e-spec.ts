import { ANALYSIS_QUEUE } from '@shortlist/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('AI analysis API (e2e)', () => {
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
    queue = new Queue(ANALYSIS_QUEUE, { connection: redis });
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
    await t.close();
  });

  const job = (who: TestUser, over: Record<string, unknown> = {}) =>
    t.prisma.job.create({
      data: { userId: who.user.id, title: 'Engineer', company: 'Acme', rawJD: 'React.', dedupeHash: crypto.randomUUID(), ...over },
    });

  const scored = async (who: TestUser, score: number, title: string) => {
    const j = await job(who, { title, analysisStatus: 'DONE' });
    await t.prisma.jobMatch.create({
      data: {
        jobId: j.id,
        overallScore: score,
        commercialScore: score,
        verdict: score >= 70 ? 'APPLY' : 'STRETCH',
        strengths: ['React — React (commercial production, CloudCard Inc.)'],
        risks: ['Missing: GraphQL'],
        gaps: { create: [{ skillName: 'GraphQL', severity: 'MINOR' }] },
      },
    });
    await t.prisma.jobRequirement.create({
      data: { jobId: j.id, skillName: 'React', importance: 'REQUIRED', isCore: true, matchedSkillIds: ['x'], relatedSkillIds: [] },
    });
    return j;
  };

  it('lists best matches first and unscored jobs last; ?sort=recent keeps discovery order', async () => {
    const user = await t.register();
    await job(user, { title: 'Unscored', discoveredAt: new Date('2026-10-01') });
    await scored(user, 55, 'Medium');
    await scored(user, 88, 'Best');
    const res = await t.http().get('/api/v1/jobs').set(user.auth).expect(200);
    expect(res.body.map((j: { title: string }) => j.title)).toEqual(['Best', 'Medium', 'Unscored']);
    expect(res.body[0]).toMatchObject({ analysisStatus: 'DONE', match: { overallScore: 88, verdict: 'APPLY' } });
    expect(res.body[2]).toMatchObject({ analysisStatus: 'PENDING', match: null });

    const recent = await t.http().get('/api/v1/jobs?sort=recent').set(user.auth).expect(200);
    expect(recent.body.map((j: { title: string }) => j.title)[0]).not.toBe('Unscored');
    await t.http().get('/api/v1/jobs?sort=random').set(user.auth).expect(400);
  });

  it('job detail includes requirements, gaps, strengths and risks', async () => {
    const j = await scored(me, 72, 'Detailed');
    const res = await t.http().get(`/api/v1/jobs/${j.id}`).set(me.auth).expect(200);
    expect(res.body.requirements[0]).toMatchObject({ skillName: 'React', importance: 'REQUIRED', isCore: true });
    expect(res.body.match).toMatchObject({
      overallScore: 72,
      strengths: [expect.stringContaining('React')],
      risks: ['Missing: GraphQL'],
      gaps: [{ skillName: 'GraphQL', severity: 'MINOR', note: null }],
    });
  });

  describe('POST /jobs/:id/analyze', () => {
    it('re-queues a deferred job for the worker', async () => {
      const j = await job(me, { analysisStatus: 'DEFERRED', analysisError: 'Daily analysis cap reached' });
      await t.http().post(`/api/v1/jobs/${j.id}/analyze`).set(me.auth).expect(202);
      expect(await t.prisma.job.findUniqueOrThrow({ where: { id: j.id } })).toMatchObject({
        analysisStatus: 'PENDING',
        analysisError: null,
      });
      const queued = (await queue.getJobs(['waiting', 'delayed'])).filter((q) => q.data.jobId === j.id);
      expect(queued).toHaveLength(1);
      await Promise.all(queued.map((q) => q.remove()));
    });

    it('refuses to re-analyse (and re-bill) a job that is already done', async () => {
      const j = await scored(me, 60, 'Done already');
      await t.http().post(`/api/v1/jobs/${j.id}/analyze`).set(me.auth).expect(409);
    });

    it("404s for another user's job", async () => {
      const j = await job(other);
      await t.http().post(`/api/v1/jobs/${j.id}/analyze`).set(me.auth).expect(404);
    });
  });

  describe('AI usage and budget settings', () => {
    it('reports month-to-date spend, the last 24h, and job analysis states, with defaults', async () => {
      const user = await t.register();
      await t.prisma.aiUsage.createMany({
        data: [
          { userId: user.user.id, purpose: 'ANALYZE_JOB', model: 'claude-haiku-4-5', inputTokens: 1, outputTokens: 1, costUsd: 0.0031, succeeded: true },
          { userId: user.user.id, purpose: 'ANALYZE_JOB', model: 'claude-haiku-4-5', inputTokens: 1, outputTokens: 1, costUsd: 0.0029, succeeded: false },
        ],
      });
      await job(user, { analysisStatus: 'DEFERRED' });
      const res = await t.http().get('/api/v1/ai/usage').set(user.auth).expect(200);
      expect(res.body).toMatchObject({
        settings: { maxAnalysesPerDay: 40, monthlyBudgetUsd: 4.5 },
        callsThisMonth: 2,
        analysesLast24h: 2,
        jobs: { deferred: 1, pending: 0, done: 0, failed: 0 },
      });
      expect(res.body.monthToDateUsd).toBeCloseTo(0.006);
    });

    it('updates the budget settings, validating them', async () => {
      const user = await t.register();
      const res = await t.http().patch('/api/v1/ai/settings').set(user.auth).send({ monthlyBudgetUsd: 3 }).expect(200);
      expect(res.body).toEqual({ maxAnalysesPerDay: 40, monthlyBudgetUsd: 3 });
      const usage = await t.http().get('/api/v1/ai/usage').set(user.auth).expect(200);
      expect(usage.body.settings.monthlyBudgetUsd).toBe(3);
      await t.http().patch('/api/v1/ai/settings').set(user.auth).send({ monthlyBudgetUsd: -1 }).expect(400);
      await t.http().patch('/api/v1/ai/settings').set(user.auth).send({}).expect(400);
      await t.http().patch('/api/v1/ai/settings').set(user.auth).send({ model: 'claude-fable-5-1' }).expect(400);
    });

    it('requires authentication', async () => {
      await t.http().get('/api/v1/ai/usage').expect(401);
    });
  });
});
