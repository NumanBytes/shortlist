import { GMAIL_READONLY_SCOPE, SecretBox, type GmailApi, type GoogleOAuth } from '@shortlist/shared/node';
import { createHash, randomBytes } from 'node:crypto';
import { GMAIL_API, GOOGLE_OAUTH } from '../src/gmail/gmail.service.js';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// Google is faked; everything on our side (state, cookie, PKCE, encryption) is real.
const KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5173/api/v1/gmail/callback';
process.env.TOKEN_ENCRYPTION_KEY = KEY;
process.env.WEB_APP_URL = 'http://localhost:5173';

class FakeOAuth implements GoogleOAuth {
  exchanges: { code: string; verifier: string }[] = [];
  revoked: string[] = [];
  scope = GMAIL_READONLY_SCOPE;
  refreshToken: string | null = '1//real-refresh-token';
  async exchangeCode(code: string, verifier: string) {
    this.exchanges.push({ code, verifier });
    return { accessToken: 'ya29.access', refreshToken: this.refreshToken, scope: this.scope };
  }
  async refreshAccessToken() {
    return 'ya29.access';
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
}
const gmailApi: GmailApi = {
  profile: async () => ({ emailAddress: 'numan@gmail.com' }),
  labels: async () => [],
  listMessages: async () => ({ messages: [] }),
  getMessage: async () => {
    throw new Error('not used');
  },
};

describe('Gmail connection (e2e)', () => {
  let t: TestApp;
  const oauth = new FakeOAuth();

  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(GOOGLE_OAUTH).useValue(oauth).overrideProvider(GMAIL_API).useValue(gmailApi));
  });
  afterAll(async () => {
    await t.close();
  });

  // Start a connect attempt; return what Google would redirect back with.
  async function start(user: TestUser) {
    const res = await t.http().post('/api/v1/gmail/connect').set(user.auth).expect(200);
    const url = new URL(res.body.url);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('shortlist_oauth='))!;
    return { url, state: url.searchParams.get('state')!, cookie: cookie.split(';')[0]!, setCookie: cookie };
  }
  const callback = (query: Record<string, string>, cookie?: string) => {
    const req = t.http().get(`/api/v1/gmail/callback?${new URLSearchParams(query)}`);
    return (cookie ? req.set('Cookie', cookie) : req).expect(303);
  };
  const outcome = (res: { headers: Record<string, string> }) => new URL(res.headers.location!).searchParams.get('gmail');

  it('starts with a read-only, PKCE consent URL and a browser-binding cookie', async () => {
    const me = await t.register();
    const { url, setCookie } = await start(me);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(GMAIL_READONLY_SCOPE);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(process.env.GOOGLE_REDIRECT_URI);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/gmail\/callback/);
  });

  it('connects: verifies PKCE, stores the refresh token encrypted, never returns it', async () => {
    const me = await t.register();
    const { url, state, cookie } = await start(me);
    const res = await callback({ code: 'auth-code', state }, cookie);
    expect(res.headers.location).toBe('http://localhost:5173/sources?gmail=connected');

    // PKCE: what we sent Google as the verifier hashes to the challenge in the consent URL.
    const { verifier } = oauth.exchanges.at(-1)!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));

    const row = await t.prisma.gmailConnection.findUniqueOrThrow({ where: { userId: me.user.id } });
    expect(row.emailAddress).toBe('numan@gmail.com');
    expect(row.refreshTokenEnc).not.toContain('real-refresh-token');
    expect(new SecretBox(KEY).open(row.refreshTokenEnc, me.user.id)).toBe('1//real-refresh-token');

    const status = await t.http().get('/api/v1/gmail').set(me.auth).expect(200);
    expect(status.body).toMatchObject({ configured: true, connection: { emailAddress: 'numan@gmail.com', status: 'ACTIVE', labelName: 'Shortlist' } });
    expect(JSON.stringify(status.body)).not.toMatch(/refresh/i);
  });

  it('state is single-use', async () => {
    const me = await t.register();
    const { state, cookie } = await start(me);
    expect(outcome(await callback({ code: 'c', state }, cookie))).toBe('connected');
    expect(outcome(await callback({ code: 'c', state }, cookie))).toBe('mismatch');
  });

  it("refuses a consent link finished in someone else's browser (login CSRF)", async () => {
    const attacker = await t.register();
    const victim = await t.register();
    const attackerFlow = await start(attacker);
    const victimFlow = await start(victim); // the victim's browser has its own cookie
    // The victim is tricked into completing the ATTACKER's consent link.
    expect(outcome(await callback({ code: 'victim-code', state: attackerFlow.state }, victimFlow.cookie))).toBe('mismatch');
    expect(outcome(await callback({ code: 'victim-code', state: attackerFlow.state }))).toBe('mismatch');
    expect(await t.prisma.gmailConnection.findUnique({ where: { userId: attacker.user.id } })).toBeNull();
  });

  it('reports expired attempts, a cancelled consent, and a missing read scope', async () => {
    const me = await t.register();
    const a = await start(me);
    await t.prisma.oAuthState.updateMany({ where: { userId: me.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(outcome(await callback({ code: 'c', state: a.state }, a.cookie))).toBe('expired');

    const b = await start(me);
    expect(outcome(await callback({ error: 'access_denied', state: b.state }, b.cookie))).toBe('denied');

    const c = await start(me);
    oauth.scope = 'openid';
    expect(outcome(await callback({ code: 'c', state: c.state }, c.cookie))).toBe('scope');
    oauth.scope = GMAIL_READONLY_SCOPE;
    expect(await t.prisma.gmailConnection.findUnique({ where: { userId: me.user.id } })).toBeNull();
  });

  it('check now: 404 when not connected, 409 when it needs reconnecting', async () => {
    const me = await t.register();
    await t.http().post('/api/v1/gmail/check').set(me.auth).expect(404);
    const { state, cookie } = await start(me);
    await callback({ code: 'c', state }, cookie);
    await t.prisma.gmailConnection.update({ where: { userId: me.user.id }, data: { status: 'NEEDS_RECONNECT' } });
    await t.http().post('/api/v1/gmail/check').set(me.auth).expect(409);
  });

  it('disconnect revokes the grant at Google and forgets the token', async () => {
    const me = await t.register();
    const { state, cookie } = await start(me);
    await callback({ code: 'c', state }, cookie);
    await t.http().delete('/api/v1/gmail').set(me.auth).expect(204);
    expect(oauth.revoked.at(-1)).toBe('1//real-refresh-token');
    expect(await t.prisma.gmailConnection.findUnique({ where: { userId: me.user.id } })).toBeNull();
  });

  it('needs a signed-in user for everything but the callback', async () => {
    await t.http().get('/api/v1/gmail').expect(401);
    await t.http().post('/api/v1/gmail/connect').expect(401);
    await t.http().delete('/api/v1/gmail').expect(401);
  });
});
