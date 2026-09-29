import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Runs against the real database in apps/api/.env. Every user created here uses this
// domain so afterAll can remove exactly what the suite created (tokens cascade).
const TEST_DOMAIN = '@e2e.shortlist.test';
const email = () => `user-${crypto.randomUUID()}${TEST_DOMAIN}`;
const PASSWORD = 'correct horse battery';

describe('API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  async function register(overrides: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: email(), password: PASSWORD, name: 'Test User', ...overrides })
      .expect(201);
    return res.body as { user: { id: string; email: string }; accessToken: string; refreshToken: string };
  }

  beforeAll(async () => {
    process.env.BCRYPT_ROUNDS = '4'; // hashing speed isn't under test here
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
    await app.close();
  });

  it('GET /health is public and reports ok', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  describe('register', () => {
    it('creates a user, returns tokens, and never returns the password hash', async () => {
      const body = await register();
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.user).not.toHaveProperty('passwordHash');
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

  describe('refresh rotation', () => {
    it('issues a new pair and makes the old refresh token single-use', async () => {
      const first = await register();
      const res = await http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
    });

    it('treats reuse of a rotated token as theft and revokes every session', async () => {
      const first = await register();
      const second = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      // An attacker replays the stolen, already-rotated token...
      await http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
      // ...so even the legitimate user's newer token is now dead.
      await http().post('/api/v1/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
    });

    it('rejects an unknown refresh token', async () => {
      await http().post('/api/v1/auth/refresh').send({ refreshToken: 'nope' }).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token and is idempotent', async () => {
      const { refreshToken } = await register();
      await http().post('/api/v1/auth/logout').send({ refreshToken }).expect(204);
      await http().post('/api/v1/auth/logout').send({ refreshToken }).expect(204);
      await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    });
  });

  describe('skills (placeholder, now protected)', () => {
    it('401s without a token', async () => {
      await http().post('/api/v1/skills').send({ name: 'TypeScript', category: 'LANGUAGE' }).expect(401);
    });

    it('accepts a valid skill when authenticated', async () => {
      const { accessToken } = await register();
      const res = await http()
        .post('/api/v1/skills')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'TypeScript', category: 'LANGUAGE' })
        .expect(201);
      expect(res.body.received.name).toBe('TypeScript');
    });

    it('returns 400 with field-level errors', async () => {
      const { accessToken } = await register();
      const res = await http()
        .post('/api/v1/skills')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: '', category: 'nope' })
        .expect(400);
      expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(['name', 'category']);
    });
  });
});
