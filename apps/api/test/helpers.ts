import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AUTH_RATE_RULES, DEFAULT_AUTH_RATE_RULES } from '../src/rate-limit/rate-limiter.js';

const LOTS = { limit: 1_000_000, windowSeconds: 60 };

export const TEST_EMAIL_DOMAIN = '@e2e.shortlist.test';
export const TEST_PASSWORD = 'correct horse battery';
export const uniqueEmail = () => `user-${crypto.randomUUID()}${TEST_EMAIL_DOMAIN}`;

export interface TestUser {
  user: { id: string; email: string };
  accessToken: string;
  auth: { Authorization: string };
  // "shortlist_refresh=<token>", ready to send back as a Cookie header.
  refreshCookie: string;
}

// Pulls the refresh cookie out of a response's Set-Cookie headers.
export function refreshCookieFrom(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const found = cookies.find((c) => c.startsWith('shortlist_refresh='));
  if (!found) throw new Error('Response did not set the refresh cookie');
  return found.split(';')[0]!;
}

// One Nest app per test file, against the real database in apps/api/.env.
// Test files run in parallel, so each file tracks the users IT created and deletes
// only those — a blanket "delete every test-domain user" would wipe users another
// file is still using. Deleting a user cascades to everything they own.
// `configure` lets a test swap providers for fakes (e.g. Google) before the app compiles.
export async function createTestApp(configure: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b) {
  process.env.BCRYPT_ROUNDS = '4'; // hashing speed isn't under test
  // Every e2e file registers users from 127.0.0.1, so by default the auth rate limits are
  // out of the way, in a namespace of this app's own. rate-limit.e2e-spec.ts sets real ones.
  const base = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUTH_RATE_RULES)
    .useValue({ ...DEFAULT_AUTH_RATE_RULES, loginPerIp: LOTS, loginFailuresPerAccount: LOTS, registerPerIp: LOTS, prefix: `test-rl:${crypto.randomUUID()}` });
  const moduleRef = await configure(base).compile();
  const app: INestApplication = configureApp(moduleRef.createNestApplication());
  await app.init();
  const prisma = app.get(PrismaService);
  const createdUserIds: string[] = [];

  const http = () => request(app.getHttpServer());

  async function register(overrides: Record<string, unknown> = {}): Promise<TestUser> {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, name: 'Test User', ...overrides })
      .expect(201);
    createdUserIds.push(res.body.user.id);
    return {
      ...res.body,
      auth: { Authorization: `Bearer ${res.body.accessToken}` },
      refreshCookie: refreshCookieFrom(res),
    };
  }

  async function close() {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  }

  return { app, prisma, http, register, close };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
