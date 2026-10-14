import { Redis } from 'ioredis';
import { AUTH_RATE_RULES, DEFAULT_AUTH_RATE_RULES, type AuthRateRules } from '../src/rate-limit/rate-limiter.js';
import { TEST_PASSWORD, createTestApp, uniqueEmail, type TestApp, TEST_REDIS_URL } from './helpers.js';

// The auth rate limits (docs/security.md §8.1) against the real local Redis, with low limits in a
// namespace of this file's own so runs never interfere.
describe('Auth rate limits (e2e)', () => {
  const rules: AuthRateRules = {
    loginPerIp: { limit: 8, windowSeconds: 60 },
    loginFailuresPerAccount: { limit: 3, windowSeconds: 60 },
    registerPerIp: { limit: 2, windowSeconds: 60 },
    resetRequestsPerIp: { limit: 50, windowSeconds: 60 },
    resetRequestsPerAccount: { limit: 50, windowSeconds: 60 },
    resetAttemptsPerIp: { limit: 50, windowSeconds: 60 },
    verificationEmailsPerUser: { limit: 50, windowSeconds: 60 },
    prefix: `test-rl:${crypto.randomUUID()}`,
  };
  let t: TestApp;
  const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 1 });

  beforeAll(async () => {
    // As behind one proxy in production: the client IP comes from X-Forwarded-For.
    process.env.TRUST_PROXY_HOPS = '1';
    t = await createTestApp((b) => b.overrideProvider(AUTH_RATE_RULES).useValue(rules));
  });
  afterAll(async () => {
    const keys = await redis.keys(`${rules.prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await t.close();
  });
  // Each test starts with fresh counters.
  beforeEach(async () => {
    const keys = await redis.keys(`${rules.prefix}:*`);
    if (keys.length) await redis.del(...keys);
  });

  const login = (email: string, password: string, ip = '203.0.113.1') =>
    t.http().post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });

  it('locks an account after repeated failed logins — even with the right password — and says when to retry', async () => {
    const me = await t.register();
    for (let i = 0; i < 3; i++) await login(me.user.email, 'wrong password!!').expect(401);
    const res = await login(me.user.email, TEST_PASSWORD).expect(429);
    expect(res.body.message).toMatch(/Too many failed sign-in attempts for this account — try again in a minute/);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('treats an unknown email exactly like a real one, so the limit reveals nothing', async () => {
    const ghost = uniqueEmail();
    for (let i = 0; i < 3; i++) await login(ghost, 'wrong password!!').expect(401);
    await login(ghost, 'wrong password!!').expect(429);
  });

  it("resets an account's failures after a successful login, so earlier typos don't count", async () => {
    const me = await t.register();
    for (let i = 0; i < 2; i++) await login(me.user.email, 'wrong password!!').expect(401);
    await login(me.user.email, TEST_PASSWORD).expect(200);
    for (let i = 0; i < 2; i++) await login(me.user.email, 'wrong password!!').expect(401);
    await login(me.user.email, TEST_PASSWORD).expect(200);
  });

  it('limits all login attempts from one IP across many accounts', async () => {
    for (let i = 0; i < 8; i++) await login(uniqueEmail(), 'wrong password!!', '198.51.100.7').expect(401);
    await login(uniqueEmail(), 'wrong password!!', '198.51.100.7').expect(429);
    await login(uniqueEmail(), 'wrong password!!', '198.51.100.8').expect(401); // another IP is unaffected
  });

  it('limits sign-ups per IP', async () => {
    const register = (ip: string) =>
      t
        .http()
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', ip)
        .send({ email: uniqueEmail(), password: TEST_PASSWORD, name: 'Rate Test' });
    const ok = [await register('192.0.2.9').expect(201), await register('192.0.2.9').expect(201)];
    const created = ok.map((r) => r.body.user.id as string);
    const refused = await register('192.0.2.9').expect(429);
    expect(refused.body.message).toMatch(/Too many sign-ups/);
    await t.prisma.user.deleteMany({ where: { id: { in: created } } });
  });

  it('uses defaults that are strict but livable', () => {
    expect(DEFAULT_AUTH_RATE_RULES.loginFailuresPerAccount).toEqual({ limit: 10, windowSeconds: 900 });
    expect(DEFAULT_AUTH_RATE_RULES.registerPerIp.limit).toBeLessThanOrEqual(5);
  });
});
