import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// Plans (docs/ai-scoring.md §12.5): units a user understands, enforced before work is queued.
describe('Plans (e2e)', () => {
  let t: TestApp;
  let admin: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.register();
    await t.prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
  });

  afterAll(async () => {
    await t.close();
  });

  const usage = (u: TestUser, purpose: 'ANALYZE_JOB' | 'TAILOR_RESUME', n: number, succeeded = true) =>
    t.prisma.aiUsage.createMany({
      data: Array.from({ length: n }, () => ({
        userId: u.user.id,
        purpose,
        model: 'claude-haiku-4-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        succeeded,
      })),
    });

  // A scored job, ready for tailoring.
  const scoredJob = (u: TestUser) =>
    t.prisma.job.create({
      data: {
        userId: u.user.id,
        title: 'React Developer',
        company: 'Acme',
        rawJD: 'x',
        dedupeHash: crypto.randomUUID(),
        analysisStatus: 'DONE',
      },
    });

  it('starts a new account on Free and reports what it has used of the trial', async () => {
    const u = await t.register();
    await usage(u, 'ANALYZE_JOB', 3);
    await usage(u, 'ANALYZE_JOB', 2, false); // failed calls don't use up the plan
    await usage(u, 'TAILOR_RESUME', 1);
    const res = await t.http().get('/api/v1/ai/usage').set(u.auth).expect(200);
    expect(res.body.plan).toEqual({
      name: 'FREE',
      label: 'Free',
      priceUsdPerMonth: 0,
      period: 'trial',
      resetsAt: null,
      runNow: false,
      discoveryEveryDays: 2,
      scoredJobs: { used: 3, limit: 50 },
      tailoredResumes: { used: 1, limit: 5 },
    });
  });

  it('refuses tailoring with 402 PLAN_LIMIT once the resumes are used up, before queuing', async () => {
    const u = await t.register();
    const job = await scoredJob(u);
    await usage(u, 'TAILOR_RESUME', 5);
    const res = await t.http().post(`/api/v1/jobs/${job.id}/resume`).set(u.auth).send({ mode: 'tailor' }).expect(402);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT',
      plan: 'FREE',
      message: "You've used the 5 tailored resumes in the free trial",
    });
    expect(await t.prisma.jobResume.findUnique({ where: { jobId: job.id } })).toBeNull();
  });

  it('keeps "Find new jobs" to Pro, and says so in the status', async () => {
    const u = await t.register();
    const status = await t.http().get('/api/v1/discovery/status').set(u.auth).expect(200);
    expect(status.body.canRunNow).toBe(false);
    const res = await t.http().post('/api/v1/discovery/run').set(u.auth).expect(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT', plan: 'FREE' });

    await t.http().put(`/api/v1/admin/users/${u.user.id}/plan`).set(admin.auth).send({ plan: 'PRO' }).expect(200);
    expect((await t.http().get('/api/v1/discovery/status').set(u.auth).expect(200)).body.canRunNow).toBe(true);
    await t.http().post('/api/v1/discovery/run').set(u.auth).expect(202);
  });

  it("lets an admin assign a plan, setting the account's budget to the plan's", async () => {
    const u = await t.register();
    const res = await t
      .http()
      .put(`/api/v1/admin/users/${u.user.id}/plan`)
      .set(admin.auth)
      .send({ plan: 'STARTER' })
      .expect(200);
    expect(res.body).toEqual({ plan: 'STARTER', monthlyBudgetUsd: 4 });
    const me = await t.http().get('/api/v1/ai/usage').set(u.auth).expect(200);
    expect(me.body.plan).toMatchObject({ name: 'STARTER', period: 'month', scoredJobs: { limit: 300 } });
    expect(me.body.settings.monthlyBudgetUsd).toBe(4);
    const list = await t.http().get('/api/v1/admin/users').set(admin.auth).expect(200);
    expect(list.body.find((x: { id: string }) => x.id === u.user.id)).toMatchObject({ plan: 'STARTER' });

    await t.http().put(`/api/v1/admin/users/${u.user.id}/plan`).set(admin.auth).send({ plan: 'GOLD' }).expect(400);
    await t.http().put(`/api/v1/admin/users/${u.user.id}/plan`).set(u.auth).send({ plan: 'PRO' }).expect(404);
  });
});
