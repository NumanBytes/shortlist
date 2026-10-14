import { hashOneTimeToken } from '@shortlist/shared/node';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthEmailService } from './auth-email.service.js';
import type { MailMessage, Mailer } from './mailer.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];
const env = { WEB_APP_URL: 'https://shortlist.example' } as Env;

class FakeMailer implements Mailer {
  configured = true;
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

async function setup(verified = false) {
  const user = await prisma.user.create({
    data: {
      email: `mail-${crypto.randomUUID()}@e2e.shortlist.test`,
      name: 'Mail Test',
      passwordHash: 'x',
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
  createdUsers.push(user.id);
  const mailer = new FakeMailer();
  return { user, mailer, svc: new AuthEmailService(prisma, mailer, env) };
}

const tokenIn = (m: MailMessage) => /token=([A-Za-z0-9_-]{43})/.exec(m.text)![1]!;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

// docs/security.md §8.7: the link's token exists only in the email; the database has its hash.
describe('AuthEmailService', () => {
  it('emails a verification link whose token is stored only as a hash', async () => {
    const { user, mailer, svc } = await setup();
    expect(await svc.send({ userId: user.id, purpose: 'VERIFY_EMAIL' })).toEqual({ sent: true });
    expect(mailer.sent).toHaveLength(1);
    const m = mailer.sent[0]!;
    expect(m.to).toBe(user.email);
    expect(m.text).toContain('https://shortlist.example/verify-email?token=');
    const token = tokenIn(m);
    const rows = await prisma.authToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'VERIFY_EMAIL', tokenHash: hashOneTimeToken(token), usedAt: null });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('replaces an earlier unused link, so only the newest works', async () => {
    const { user, mailer, svc } = await setup(true);
    await svc.send({ userId: user.id, purpose: 'RESET_PASSWORD' });
    await svc.send({ userId: user.id, purpose: 'RESET_PASSWORD' });
    const rows = await prisma.authToken.findMany({ where: { userId: user.id, purpose: 'RESET_PASSWORD' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashOneTimeToken(tokenIn(mailer.sent[1]!)));
    expect(rows[0]!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600 * 1000);
  });

  it('sends nothing to an address that is already verified, or without SMTP', async () => {
    const { user, mailer, svc } = await setup(true);
    expect(await svc.send({ userId: user.id, purpose: 'VERIFY_EMAIL' })).toMatchObject({ sent: false });
    mailer.configured = false;
    expect(await svc.send({ userId: user.id, purpose: 'RESET_PASSWORD' })).toMatchObject({ sent: false });
    expect(mailer.sent).toHaveLength(0);
  });
});
