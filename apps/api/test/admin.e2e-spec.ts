import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Admin (e2e)', () => {
  let t: TestApp;
  let admin: TestUser;
  let user: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.register();
    user = await t.register();
    // The first admin is made on the server (db:set-role), never through the API.
    await t.prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
  });

  afterAll(async () => {
    await t.close();
  });

  it('is 404 for anyone who is not an admin, and 401 when signed out', async () => {
    await t.http().get('/api/v1/admin/users').expect(401);
    await t.http().get('/api/v1/admin/users').set(user.auth).expect(404);
    await t
      .http()
      .put(`/api/v1/admin/users/${user.user.id}/ai-budget`)
      .set(user.auth)
      .send({ monthlyBudgetUsd: 50 })
      .expect(404);
  });

  it('lists accounts with their budget and this month’s spend', async () => {
    await t.prisma.aiUsage.create({
      data: {
        userId: user.user.id,
        purpose: 'ANALYZE_JOB',
        model: 'claude-haiku-4-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.25,
        succeeded: true,
      },
    });
    const res = await t.http().get('/api/v1/admin/users').set(admin.auth).expect(200);
    const row = (res.body as { id: string }[]).find((u) => u.id === user.user.id);
    expect(row).toMatchObject({ email: user.user.email, role: 'USER', monthlyBudgetUsd: 1, monthToDateUsd: 0.25 });
    expect(row).not.toHaveProperty('passwordHash');
  });

  it('sets an account’s monthly budget, keeping its other settings', async () => {
    await t.http().patch('/api/v1/ai/settings').set(user.auth).send({ maxAnalysesPerDay: 12 }).expect(200);
    const res = await t
      .http()
      .put(`/api/v1/admin/users/${user.user.id}/ai-budget`)
      .set(admin.auth)
      .send({ monthlyBudgetUsd: 5 })
      .expect(200);
    expect(res.body).toEqual({ maxAnalysesPerDay: 12, monthlyBudgetUsd: 5, resumeReuseMinOverlap: 0.85 });
    const usage = await t.http().get('/api/v1/ai/usage').set(user.auth).expect(200);
    expect(usage.body.settings.monthlyBudgetUsd).toBe(5);

    await t
      .http()
      .put(`/api/v1/admin/users/${user.user.id}/ai-budget`)
      .set(admin.auth)
      .send({ monthlyBudgetUsd: -1 })
      .expect(400);
    await t
      .http()
      .put(`/api/v1/admin/users/${crypto.randomUUID()}/ai-budget`)
      .set(admin.auth)
      .send({ monthlyBudgetUsd: 5 })
      .expect(404);
  });

  it('takes effect at once when an admin is demoted', async () => {
    const other = await t.register();
    await t.prisma.user.update({ where: { id: other.user.id }, data: { role: 'ADMIN' } });
    await t.http().get('/api/v1/admin/users').set(other.auth).expect(200);
    await t.prisma.user.update({ where: { id: other.user.id }, data: { role: 'USER' } });
    await t.http().get('/api/v1/admin/users').set(other.auth).expect(404);
  });
});
