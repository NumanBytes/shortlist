import { MAIL_QUEUE } from '@shortlist/shared';
import { newOneTimeToken } from '@shortlist/shared/node';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import {
  TEST_PASSWORD,
  TEST_REDIS_URL,
  createTestApp,
  refreshCookieFrom,
  type TestApp,
  type TestUser,
} from './helpers.js';

// Email verification and password reset (docs/security.md §8.7), with SMTP "configured" for
// this app only. The worker makes the tokens; here they're made directly in the database.
describe('Account emails (e2e)', () => {
  let t: TestApp;
  let redis: Redis;
  let mail: Queue;

  beforeAll(async () => {
    t = await createTestApp((b) =>
      b.overrideProvider(ENV).useFactory({ factory: () => ({ ...loadEnv(), SMTP_HOST: 'smtp.test' }) }),
    );
    redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    mail = new Queue(MAIL_QUEUE, { connection: redis });
  });

  afterAll(async () => {
    await mail.close();
    await redis.quit();
    await t.close();
  });

  const token = async (u: TestUser, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD', expiresInMs = 3600_000) => {
    const { token, tokenHash } = newOneTimeToken();
    await t.prisma.authToken.create({
      data: { userId: u.user.id, purpose, tokenHash, expiresAt: new Date(Date.now() + expiresInMs) },
    });
    return token;
  };
  const queuedFor = async (userId: string, purpose: string) =>
    (await mail.getJobs(['waiting', 'delayed', 'active'])).some(
      (j) => j.data.userId === userId && j.data.purpose === purpose,
    );

  it('says email is available', async () => {
    expect((await t.http().get('/api/v1/auth/options').expect(200)).body).toEqual({ emailEnabled: true });
  });

  it('a new account is unverified: it can see itself, nothing else, and an email is queued', async () => {
    const me = await t.register();
    expect(me.user).toMatchObject({ emailVerifiedAt: null });
    expect(await queuedFor(me.user.id, 'VERIFY_EMAIL')).toBe(true);
    await t.http().get('/api/v1/auth/me').set(me.auth).expect(200);
    const refused = await t.http().get('/api/v1/jobs').set(me.auth).expect(403);
    expect(refused.body).toMatchObject({ code: 'EMAIL_UNVERIFIED' });
    await t.http().post('/api/v1/auth/resend-verification').set(me.auth).expect(202);
  });

  it('verifies once from the link; a refreshed session can use the app', async () => {
    const me = await t.register();
    const link = await token(me, 'VERIFY_EMAIL');
    await t.http().post('/api/v1/auth/verify-email').send({ token: link }).expect(204);
    await t.http().post('/api/v1/auth/verify-email').send({ token: link }).expect(400); // single use
    const refreshed = await t.http().post('/api/v1/auth/refresh').set('Cookie', me.refreshCookie).expect(200);
    expect(refreshed.body.user.emailVerifiedAt).not.toBeNull();
    await t.http().get('/api/v1/jobs').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);
    await t
      .http()
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(409);
  });

  it('forgot password answers the same for unknown and known emails, and only emails the real one', async () => {
    const me = await t.register();
    const unknown = await t
      .http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody-${crypto.randomUUID()}@e2e.shortlist.test` })
      .expect(202);
    const known = await t.http().post('/api/v1/auth/forgot-password').send({ email: me.user.email }).expect(202);
    expect(unknown.body).toEqual(known.body);
    expect(await queuedFor(me.user.id, 'RESET_PASSWORD')).toBe(true);
  });

  it('resets the password once, ends every session, and verifies the address', async () => {
    const me = await t.register();
    const link = await token(me, 'RESET_PASSWORD');
    const password = 'a brand new passphrase';
    await t.http().post('/api/v1/auth/reset-password').send({ token: link, password }).expect(204);
    await t.http().post('/api/v1/auth/reset-password').send({ token: link, password }).expect(400);
    await t.http().post('/api/v1/auth/refresh').set('Cookie', me.refreshCookie).expect(401); // old session gone
    await t.http().post('/api/v1/auth/login').send({ email: me.user.email, password: TEST_PASSWORD }).expect(401);
    const login = await t.http().post('/api/v1/auth/login').send({ email: me.user.email, password }).expect(200);
    expect(login.body.user.emailVerifiedAt).not.toBeNull();
    refreshCookieFrom(login);
  });

  it('refuses an expired link, a link for the other purpose, and a weak password', async () => {
    const me = await t.register();
    const expired = await token(me, 'RESET_PASSWORD', -1000);
    await t.http().post('/api/v1/auth/reset-password').send({ token: expired, password: 'long enough pw' }).expect(400);
    const verifyLink = await token(me, 'VERIFY_EMAIL');
    await t
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token: verifyLink, password: 'long enough pw' })
      .expect(400);
    const reset = await token(me, 'RESET_PASSWORD');
    await t.http().post('/api/v1/auth/reset-password').send({ token: reset, password: 'short' }).expect(400);
  });
});

// Without a mail server nothing could reach the user, so accounts start verified.
describe('Account emails without SMTP (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('verifies new accounts at once and says password reset is unavailable', async () => {
    const me = await t.register();
    expect(me.user.emailVerifiedAt).not.toBeNull();
    await t.http().get('/api/v1/jobs').set(me.auth).expect(200);
    expect((await t.http().get('/api/v1/auth/options').expect(200)).body).toEqual({ emailEnabled: false });
    await t.http().post('/api/v1/auth/forgot-password').send({ email: me.user.email }).expect(503);
  });
});
