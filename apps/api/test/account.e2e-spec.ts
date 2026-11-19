import { BILLING_PROVIDER, PaddleBillingProvider } from '../src/billing/billing-provider.js';
import { createTestApp, TEST_PASSWORD, type TestApp, type TestUser } from './helpers.js';

// The user's data rights (docs/security.md §8.8): export everything, delete everything.
// Paddle's API is a recorder here, as in billing.e2e-spec.ts — no network, no money.
const PADDLE = {
  PADDLE_API_KEY: 'pdl_sdbx_apikey_test',
  PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_test_secret',
  PADDLE_CLIENT_TOKEN: 'test_clienttoken',
  PADDLE_PRICE_STARTER: 'pri_starter',
  PADDLE_PRICE_PRO: 'pri_pro',
};

describe('Account export and deletion (e2e)', () => {
  let t: TestApp;
  const calls: { method: string; url: string; body: unknown }[] = [];
  let paddleDown = false;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method!, url, body: JSON.parse(init.body as string) });
    return paddleDown
      ? new Response('{"error":{"code":"internal_error"}}', { status: 500 })
      : new Response('{"data":{}}', { status: 200 });
  }) as typeof fetch;
  const usageIds: string[] = [];

  beforeAll(async () => {
    t = await createTestApp((b) =>
      b.overrideProvider(BILLING_PROVIDER).useValue(new PaddleBillingProvider(PADDLE, fakeFetch)),
    );
  });

  afterAll(async () => {
    await t.prisma.aiUsage.deleteMany({ where: { id: { in: usageIds } } });
    await t.close();
  });

  const subscribe = (u: TestUser, status: 'ACTIVE' | 'CANCELED' = 'ACTIVE') =>
    t.prisma.billingSubscription.create({
      data: {
        userId: u.user.id,
        provider: 'paddle',
        providerSubscriptionId: `sub_${u.user.id}`,
        providerCustomerId: `ctm_${u.user.id}`,
        plan: 'PRO',
        status,
        lastEventAt: new Date(),
      },
    });
  const exists = async (u: TestUser) => (await t.prisma.user.count({ where: { id: u.user.id } })) === 1;

  describe('export', () => {
    it('returns the account and what it holds, as a download', async () => {
      const u = await t.register({ name: 'Export Me' });
      await t.prisma.workExperience.create({
        data: { userId: u.user.id, company: 'Acme', title: 'Developer', startDate: new Date('2024-01-01') },
      });
      const res = await t.http().get('/api/v1/account/export').set(u.auth).expect(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.format).toBe('shortlist-export-v1');
      expect(res.body.account).toMatchObject({ id: u.user.id, email: u.user.email, name: 'Export Me' });
      expect(res.body.account.workExperiences).toEqual([expect.objectContaining({ company: 'Acme' })]);
    });

    it('leaves out every credential: password hash, session hashes, Gmail token, push keys', async () => {
      const u = await t.register();
      await t.prisma.gmailConnection.create({
        data: { userId: u.user.id, emailAddress: 'me@example.com', refreshTokenEnc: 'v1.SEALED-GMAIL-TOKEN' },
      });
      await t.prisma.pushSubscription.create({
        data: {
          userId: u.user.id,
          endpoint: `https://push.example.com/${u.user.id}`,
          p256dh: 'PUSH-P256DH-KEY',
          auth: 'PUSH-AUTH-SECRET',
        },
      });
      const stored = await t.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        include: { refreshTokens: true },
      });
      const res = await t.http().get('/api/v1/account/export').set(u.auth).expect(200);
      const text = JSON.stringify(res.body);
      for (const secret of [
        stored.passwordHash,
        ...stored.refreshTokens.map((r) => r.tokenHash),
        'SEALED-GMAIL-TOKEN',
        'PUSH-P256DH-KEY',
        'PUSH-AUTH-SECRET',
        `https://push.example.com/${u.user.id}`,
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(res.body.account).not.toHaveProperty('passwordHash');
      expect(res.body.account).not.toHaveProperty('refreshTokens');
      expect(res.body.account.gmail).toMatchObject({ emailAddress: 'me@example.com' });
      expect(res.body.account.pushSubscriptions).toHaveLength(1);
    });

    it('needs a session', async () => {
      await t.http().get('/api/v1/account/export').expect(401);
    });
  });

  describe('delete', () => {
    it('refuses a wrong or missing password and deletes nothing', async () => {
      const u = await t.register();
      const res = await t.http().delete('/api/v1/account').set(u.auth).send({ password: 'not it' }).expect(400);
      expect(res.body.errors).toEqual([{ path: 'password', message: 'That password is not right' }]);
      await t.http().delete('/api/v1/account').set(u.auth).send({}).expect(400);
      await t.http().delete('/api/v1/account').set(u.auth).send({ password: TEST_PASSWORD, now: true }).expect(400);
      expect(await exists(u)).toBe(true);
    });

    it('removes the account and everything in it, ends the session, and keeps the AI spend unlinked', async () => {
      const u = await t.register();
      const skill = await t.prisma.skill.create({
        data: { userId: u.user.id, name: 'TypeScript', category: 'LANGUAGE' },
      });
      const usage = await t.prisma.aiUsage.create({
        data: {
          userId: u.user.id,
          purpose: 'ANALYZE_JOB',
          model: 'claude-haiku-5-5',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.01,
          succeeded: true,
        },
      });
      usageIds.push(usage.id);

      const res = await t.http().delete('/api/v1/account').set(u.auth).send({ password: TEST_PASSWORD }).expect(204);
      expect(String(res.headers['set-cookie'])).toMatch(/shortlist_refresh=;/);

      expect(await exists(u)).toBe(false);
      expect(await t.prisma.skill.count({ where: { id: skill.id } })).toBe(0);
      expect(await t.prisma.refreshToken.count({ where: { userId: u.user.id } })).toBe(0);
      expect(await t.prisma.aiUsage.findUniqueOrThrow({ where: { id: usage.id } })).toMatchObject({ userId: null });
      await t.http().post('/api/v1/auth/refresh').set('Cookie', u.refreshCookie).expect(401);
      await t.http().post('/api/v1/auth/login').send({ email: u.user.email, password: TEST_PASSWORD }).expect(401);
    });

    it('cancels a live subscription at Paddle first', async () => {
      const u = await t.register();
      await subscribe(u);
      await t.http().delete('/api/v1/account').set(u.auth).send({ password: TEST_PASSWORD }).expect(204);
      expect(calls.at(-1)).toEqual({
        method: 'POST',
        url: `https://sandbox-api.paddle.com/subscriptions/sub_${u.user.id}/cancel`,
        body: { effective_from: 'immediately' },
      });
      expect(await exists(u)).toBe(false);
    });

    it('deletes nothing when Paddle cannot cancel the subscription', async () => {
      const u = await t.register();
      await subscribe(u);
      paddleDown = true;
      try {
        const res = await t.http().delete('/api/v1/account').set(u.auth).send({ password: TEST_PASSWORD }).expect(502);
        expect(res.body.message).toMatch(/nothing was deleted/);
      } finally {
        paddleDown = false;
      }
      expect(await exists(u)).toBe(true);
    });

    it('does not call Paddle for a subscription that already ended', async () => {
      const u = await t.register();
      await subscribe(u, 'CANCELED');
      const before = calls.length;
      await t.http().delete('/api/v1/account').set(u.auth).send({ password: TEST_PASSWORD }).expect(204);
      expect(calls).toHaveLength(before);
    });
  });
});

describe('Legal details (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('are public, with the refund window', async () => {
    const res = await t.http().get('/api/v1/legal').expect(200);
    expect(res.body).toMatchObject({ refundWindowDays: 14 });
    expect(res.body).toHaveProperty('operator');
  });
});
