import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

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
export async function createTestApp() {
  process.env.BCRYPT_ROUNDS = '4'; // hashing speed isn't under test
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
