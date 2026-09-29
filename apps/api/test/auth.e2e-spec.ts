import { TEST_PASSWORD, createTestApp, refreshCookieFrom, uniqueEmail, type TestApp } from './helpers.js';

const email = uniqueEmail;
const PASSWORD = TEST_PASSWORD;

describe('Auth & health (e2e)', () => {
  let t: TestApp;
  const http = () => t.http();
  const register = (overrides?: Record<string, unknown>) => t.register(overrides);

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /health is public and reports ok', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  describe('register', () => {
    it('creates a user, returns tokens, and never returns the password hash', async () => {
      const body = await register();
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.user).not.toHaveProperty('passwordHash');
      // The refresh token travels only in the cookie — never readable by page scripts.
      expect(body).not.toHaveProperty('refreshToken');
    });

    it('normalises email case so the same address cannot register twice', async () => {
      const address = email();
      await register({ email: address });
      await http()
        .post('/api/v1/auth/register')
        .send({ email: address.toUpperCase(), password: PASSWORD, name: 'Dup' })
        .expect(409);
    });

    it('rejects unknown fields instead of silently dropping them', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ email: email(), password: PASSWORD, name: 'X', isAdmin: true })
        .expect(400);
    });
  });

  describe('login', () => {
    it('returns tokens for correct credentials', async () => {
      const { user } = await register();
      const res = await http().post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
      expect(res.body.user.id).toBe(user.id);
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const { user } = await register();
      const wrongPassword = await http()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong password!' })
        .expect(401);
      const unknownEmail = await http()
        .post('/api/v1/auth/login')
        .send({ email: email(), password: PASSWORD })
        .expect(401);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });
  });

  describe('protected routes', () => {
    it('GET /auth/me requires a bearer token', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      await http().get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('GET /auth/me returns the current user', async () => {
      const { user, accessToken } = await register();
      const res = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(res.body).toMatchObject({ id: user.id, email: user.email });
      expect(res.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('refresh cookie', () => {
    it('is httpOnly, SameSite=Strict, and scoped to the auth path', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: email(), password: PASSWORD, name: 'Cookie' })
        .expect(201);
      const header = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('shortlist_refresh='))!;
      expect(header).toMatch(/HttpOnly/);
      expect(header).toMatch(/SameSite=Strict/);
      expect(header).toMatch(/Path=\/api\/v1\/auth/);
      expect(header).toMatch(/Max-Age=2592000/); // 30 days
      await t.prisma.user.deleteMany({ where: { id: res.body.user.id } });
    });

    it('login sets a fresh cookie', async () => {
      const { user } = await register();
      const res = await http().post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
      expect(refreshCookieFrom(res)).toMatch(/^shortlist_refresh=/);
      expect(res.body).not.toHaveProperty('refreshToken');
    });
  });

  describe('refresh rotation', () => {
    const refresh = (cookie?: string) => {
      const req = http().post('/api/v1/auth/refresh');
      return cookie ? req.set('Cookie', cookie) : req;
    };

    it('issues a new access token and rotates the cookie', async () => {
      const first = await register();
      const res = await refresh(first.refreshCookie).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(refreshCookieFrom(res)).not.toBe(first.refreshCookie);
    });

    it('401s with no cookie', async () => {
      await refresh().expect(401);
    });

    it('401s with an unknown cookie, and clears it', async () => {
      const res = await refresh('shortlist_refresh=nope').expect(401);
      expect(refreshCookieFrom(res)).toBe('shortlist_refresh=');
    });

    it('treats reuse of a rotated token as theft and revokes every session', async () => {
      const first = await register();
      const second = await refresh(first.refreshCookie).expect(200);

      // An attacker replays the stolen, already-rotated token...
      await refresh(first.refreshCookie).expect(401);
      // ...so even the legitimate user's newer token is now dead.
      await refresh(refreshCookieFrom(second)).expect(401);
    });

    it('ignores a refresh token sent in the body — only the cookie counts', async () => {
      const { refreshCookie } = await register();
      const token = refreshCookie.split('=')[1];
      await http().post('/api/v1/auth/refresh').send({ refreshToken: token }).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token, clears the cookie, and is idempotent', async () => {
      const { refreshCookie } = await register();
      const res = await http().post('/api/v1/auth/logout').set('Cookie', refreshCookie).expect(204);
      expect(refreshCookieFrom(res)).toBe('shortlist_refresh=');
      await http().post('/api/v1/auth/logout').set('Cookie', refreshCookie).expect(204);
      await http().post('/api/v1/auth/logout').expect(204);
      await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(401);
    });
  });

  describe('CORS', () => {
    it('allows credentialed requests from an allowlisted origin', async () => {
      const res = await http().get('/health').set('Origin', 'http://localhost:5173').expect(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not grant access to any other origin', async () => {
      const res = await http().get('/health').set('Origin', 'https://evil.example').expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
