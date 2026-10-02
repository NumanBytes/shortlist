import { GoogleApiError, SecretBox, type GmailApi, type GmailMessage, type GoogleOAuth } from '@shortlist/shared/node';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService, PermanentEmailError } from './email.service.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];
const box = new SecretBox(randomBytes(32).toString('base64'));

// A fake Google: a mailbox with labels and messages, recording every request.
class FakeGmail implements GmailApi {
  calls: { method: string; args: unknown }[] = [];
  labelList = [{ id: 'Label_7', name: 'Shortlist' }, { id: 'INBOX', name: 'INBOX' }];
  inLabel: GmailMessage[] = [];
  async profile() {
    return { emailAddress: 'numan@gmail.com' };
  }
  async labels(token: string) {
    this.calls.push({ method: 'labels', args: token });
    return this.labelList;
  }
  async listMessages(token: string, p: { labelId: string; query: string }) {
    this.calls.push({ method: 'list', args: p });
    return { messages: p.labelId === 'Label_7' ? this.inLabel.map((m) => ({ id: m.id })) : [] };
  }
  async getMessage(_t: string, id: string, format: string) {
    this.calls.push({ method: 'get', args: { id, format } });
    return this.inLabel.find((m) => m.id === id)!;
  }
}
class FakeOAuth implements GoogleOAuth {
  next: () => Promise<string> = async () => 'access-token';
  refreshed: string[] = [];
  async exchangeCode(): Promise<never> {
    throw new Error('not used');
  }
  async refreshAccessToken(rt: string) {
    this.refreshed.push(rt);
    return this.next();
  }
  async revoke() {}
}

const msg = (id: string, from: string): GmailMessage => ({
  id,
  internalDate: String(Date.parse('2026-10-02T09:00:00Z')),
  payload: { mimeType: 'text/html', headers: [{ name: 'From', value: from }] },
});

async function setup() {
  const user = await prisma.user.create({ data: { email: `gmail-${crypto.randomUUID()}@e2e.shortlist.test`, name: 'Gmail Test', passwordHash: 'x' } });
  createdUsers.push(user.id);
  await prisma.gmailConnection.create({
    data: { userId: user.id, emailAddress: 'numan@gmail.com', refreshTokenEnc: box.seal('1//refresh', user.id) },
  });
  const gmail = new FakeGmail();
  const oauth = new FakeOAuth();
  return { user, gmail, oauth, svc: new EmailService(prisma, oauth, gmail, box) };
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe('EmailService.check', () => {
  it('reads only the Shortlist label, records metadata, and never reads a message twice', async () => {
    const { user, gmail, oauth, svc } = await setup();
    gmail.inLabel = [msg('m1', 'LinkedIn <jobalerts-noreply@linkedin.com>'), msg('m2', 'alert@indeed.com')];

    expect(await svc.check(user.id)).toEqual({ status: 'SUCCESS', read: 2 });
    expect(oauth.refreshed).toEqual(['1//refresh']); // decrypted with the user's id
    const lists = gmail.calls.filter((c) => c.method === 'list').map((c) => c.args as { labelId: string; query: string });
    expect(lists.every((l) => l.labelId === 'Label_7')).toBe(true);
    expect(lists[0]!.query).toBe('newer_than:30d'); // first check: last 30 days
    // Metadata only: bodies are never fetched in this step.
    expect(gmail.calls.filter((c) => c.method === 'get').every((c) => (c.args as { format: string }).format === 'metadata')).toBe(true);

    const rows = await prisma.emailMessage.findMany({ where: { userId: user.id }, orderBy: { gmailMessageId: 'asc' } });
    expect(rows.map((r) => [r.gmailMessageId, r.sender, r.status])).toEqual([
      ['m1', 'jobalerts-noreply@linkedin.com', 'UNPARSED'],
      ['m2', 'alert@indeed.com', 'UNPARSED'],
    ]);

    // Second check: overlaps by date, skips what it already read.
    gmail.calls = [];
    gmail.inLabel.push(msg('m3', 'alert@indeed.com'));
    expect(await svc.check(user.id)).toEqual({ status: 'SUCCESS', read: 1 });
    expect((gmail.calls.find((c) => c.method === 'list')!.args as { query: string }).query).toMatch(/^after:\d+$/);
    expect(gmail.calls.filter((c) => c.method === 'get').map((c) => (c.args as { id: string }).id)).toEqual(['m3']);

    expect(await svc.check(user.id)).toEqual({ status: 'EMPTY', read: 0 });
    expect(await prisma.gmailConnection.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      lastCheckStatus: 'EMPTY',
      lastCheckFound: 0,
      lastError: null,
    });
  });

  it('fails visibly, without retrying, when the label is missing', async () => {
    const { user, gmail, svc } = await setup();
    gmail.labelList = [{ id: 'INBOX', name: 'INBOX' }];
    await expect(svc.check(user.id)).rejects.toBeInstanceOf(PermanentEmailError);
    expect(await prisma.gmailConnection.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      status: 'ACTIVE',
      lastCheckStatus: 'FAILED',
      lastError: expect.stringMatching(/no "Shortlist" label/),
    });
    expect(gmail.calls.some((c) => c.method === 'list')).toBe(false);
  });

  it('asks the user to reconnect when Google revoked the grant', async () => {
    const { user, oauth, svc } = await setup();
    oauth.next = async () => {
      throw new GoogleApiError('Google 400 invalid_grant: Token has been expired or revoked.', 400, 'invalid_grant');
    };
    await expect(svc.check(user.id)).rejects.toBeInstanceOf(PermanentEmailError);
    expect(await prisma.gmailConnection.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ status: 'NEEDS_RECONNECT' });
    // …and later checks skip it until the user reconnects.
    expect(await svc.check(user.id)).toMatchObject({ status: 'SKIPPED' });
  });

  it('retries (throws as-is) on a transient Google error', async () => {
    const { user, oauth, svc } = await setup();
    oauth.next = async () => {
      throw new GoogleApiError('Google 503', 503);
    };
    const err = await svc.check(user.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).not.toBeInstanceOf(PermanentEmailError);
  });

  it('asks to reconnect when the stored token no longer decrypts (key changed)', async () => {
    const { user, gmail, oauth } = await setup();
    const otherKey = new SecretBox(randomBytes(32).toString('base64'));
    const svc = new EmailService(prisma, oauth, gmail, otherKey);
    await expect(svc.check(user.id)).rejects.toBeInstanceOf(PermanentEmailError);
    expect(await prisma.gmailConnection.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      status: 'NEEDS_RECONNECT',
      lastError: expect.stringMatching(/can't be decrypted/),
    });
  });
});
