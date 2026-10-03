import { GoogleApiError, SecretBox, type GmailApi, type GmailMessage, type GoogleOAuth } from '@shortlist/shared/node';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BudgetGuard } from '../analysis/budget-guard.js';
import type { AnalyzerResult } from '../analysis/job-analyzer.js';
import { storeJobs } from '../discovery/job-store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService, PermanentEmailError } from './email.service.js';
import type { EmailExtractor } from './extract.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];
const box = new SecretBox(randomBytes(32).toString('base64'));
const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/email/${name}`, import.meta.url));

// An email as Gmail's format=raw returns it.
const mail = (id: string, raw: Buffer | string): GmailMessage => ({
  id,
  internalDate: String(Date.parse('2026-10-02T09:00:00Z')),
  raw: Buffer.from(raw).toString('base64url'),
});
const synthetic = (from: string, subject: string, html: string) =>
  [`From: ${from}`, `Subject: ${subject}`, 'Content-Type: text/html; charset=utf-8', '', html].join('\r\n');

// A fake mailbox: labels and messages, recording every request.
class FakeGmail implements GmailApi {
  calls: { method: string; args: unknown }[] = [];
  labelList = [{ id: 'Label_7', name: 'Shortlist' }, { id: 'INBOX', name: 'INBOX' }];
  inLabel: GmailMessage[] = [];
  async profile() {
    return { emailAddress: 'numan@gmail.com' };
  }
  async labels() {
    this.calls.push({ method: 'labels', args: null });
    return this.labelList;
  }
  async listMessages(_t: string, p: { labelId: string; query: string }) {
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
  async exchangeCode(): Promise<never> {
    throw new Error('not used');
  }
  async refreshAccessToken() {
    return this.next();
  }
  async revoke() {}
}
// A fake Claude for the model fallback — never spends money.
class FakeExtractor implements EmailExtractor {
  configured = true;
  prompts: string[] = [];
  next: (user: string) => object = () => ({ isJobEmail: false, jobs: [] });
  async extract(p: { system: string; user: string }): Promise<AnalyzerResult> {
    this.prompts.push(p.user);
    return {
      model: 'claude-haiku-4-5-20251001',
      text: JSON.stringify(this.next(p.user)),
      stopReason: 'end_turn',
      usage: { inputTokens: 1500, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}
const linkRef = (user: string, urlPart: string) => new RegExp(`(L\\d+): [^\\n]*${urlPart}`).exec(user)?.[1] ?? null;

async function setup() {
  const user = await prisma.user.create({ data: { email: `gmail-${crypto.randomUUID()}@e2e.shortlist.test`, name: 'Gmail Test', passwordHash: 'x' } });
  createdUsers.push(user.id);
  await prisma.gmailConnection.create({ data: { userId: user.id, emailAddress: 'numan@gmail.com', refreshTokenEnc: box.seal('1//refresh', user.id) } });
  const gmail = new FakeGmail();
  const oauth = new FakeOAuth();
  const extractor = new FakeExtractor();
  const queue = { addBulk: vi.fn(async () => []) };
  const svc = new EmailService(prisma, new BudgetGuard(prisma), oauth, gmail, box, extractor, queue as unknown as Queue);
  return { user, gmail, oauth, extractor, queue, svc };
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe('EmailService.check — reading', () => {
  it('reads only the Shortlist label, and never reads a message twice', async () => {
    const { user, gmail, svc } = await setup();
    gmail.inLabel = [mail('m1', fixture('indeed-alert-active-empty.eml'))];
    expect(await svc.check(user.id)).toMatchObject({ status: 'SUCCESS', read: 1 });
    const lists = gmail.calls.filter((c) => c.method === 'list').map((c) => c.args as { labelId: string; query: string });
    expect(lists.every((l) => l.labelId === 'Label_7')).toBe(true);
    expect(lists[0]!.query).toBe('newer_than:30d');

    gmail.calls = [];
    expect(await svc.check(user.id)).toMatchObject({ status: 'EMPTY', read: 0 });
    expect((gmail.calls.find((c) => c.method === 'list')!.args as { query: string }).query).toMatch(/^after:\d+$/);
    expect(gmail.calls.some((c) => c.method === 'get')).toBe(false);
  });

  it('turns an Indeed alert into partial jobs with the code parser — no model call', async () => {
    const { user, gmail, extractor, queue, svc } = await setup();
    gmail.inLabel = [mail('m1', fixture('indeed-alert.eml'))];

    const out = await svc.check(user.id);
    expect(extractor.prompts).toHaveLength(0);
    expect(out).toMatchObject({ status: 'SUCCESS', read: 1 });

    const msg = await prisma.emailMessage.findFirstOrThrow({ where: { userId: user.id } });
    expect(msg).toMatchObject({ status: 'PARSED', parser: 'indeed', portal: 'indeed', jobsFound: 6, note: null });

    const job = await prisma.job.findFirstOrThrow({ where: { userId: user.id, title: 'Full Stack Developer', company: 'WSL Consultants' } });
    expect(job).toMatchObject({
      isPartial: true,
      source: 'indeed',
      sourceUrl: 'https://pk.indeed.com/viewjob?jk=70863ace132f8e01',
      salary: 'From Rs 70,000 a month',
    });
    expect(job.rawJD).toMatch(/^From the Indeed alert: WSL Consultants/);

    const source = await prisma.jobSource.findFirstOrThrow({ where: { userId: user.id, key: 'email_alerts:indeed' }, include: { discoveryRuns: true } });
    expect(source).toMatchObject({ type: 'EMAIL_INBOX', isEnabled: false, lastRunStatus: 'SUCCESS' });
    expect(source.discoveryRuns[0]).toMatchObject({ status: 'SUCCESS', jobsFound: 6 });
    expect(queue.addBulk).toHaveBeenCalled(); // new jobs queued for scoring
  });

  it('skips a confirmation with no jobs, and application receipts, without a model call', async () => {
    const { user, gmail, extractor, svc } = await setup();
    gmail.inLabel = [
      mail('m1', fixture('indeed-alert-active-empty.eml')),
      mail('m2', synthetic('LinkedIn <jobs-noreply@linkedin.com>', 'Numan, your application was sent to Quik Hire Staffing', '<p>Sent</p>')),
    ];
    await svc.check(user.id);
    expect(extractor.prompts).toHaveLength(0);
    const rows = await prisma.emailMessage.findMany({ where: { userId: user.id }, orderBy: { gmailMessageId: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['NOT_ALERT', 'NOT_ALERT']);
    expect(await prisma.job.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('EmailService.check — the model fallback', () => {
  const portalEmail = synthetic(
    'Arc <jobs@arc.dev>',
    '3 remote React roles for you',
    `<p>Hi! Remote roles matched to your profile:</p>
     <a href="https://arc.dev/remote-jobs/j/acme-senior-react-1">Senior React Engineer</a> at Acme Corp — Remote, $4,000/month
     <a href="https://arc.dev/remote-jobs/j/globex-frontend-2">Frontend Developer</a> at Globex — Remote
     <a href="https://arc.dev/settings">Email settings</a>`,
  );

  it('reads unknown senders with the model and keeps only jobs traceable to the email', async () => {
    const { user, gmail, extractor, svc } = await setup();
    gmail.inLabel = [mail('m1', portalEmail)];
    extractor.next = (u) => ({
      isJobEmail: true,
      jobs: [
        { title: 'Senior React Engineer', company: 'Acme Corp', location: 'Remote', workMode: 'REMOTE', salary: '$4,000/month', link: linkRef(u, 'acme-senior-react') },
        { title: 'Frontend Developer', company: 'Globex', location: 'Remote', workMode: 'UNKNOWN', salary: null, link: 'L99' }, // no such link
        { title: 'Staff Engineer', company: 'Initech', location: null, workMode: 'UNKNOWN', salary: null, link: linkRef(u, 'settings') }, // invented
      ],
    });

    await svc.check(user.id);
    expect(extractor.prompts[0]).toMatch(/<email>[\s\S]*Acme Corp[\s\S]*<\/email>/);
    // Links are listed as refs; the model answers with a ref, never a URL of its own.
    expect(extractor.prompts[0]).toMatch(/L\d+: "Senior React Engineer" → https:\/\/arc\.dev\/remote-jobs\/j\/acme-senior-react-1/);
    const jobs = await prisma.job.findMany({ where: { userId: user.id } });
    expect(jobs.map((j) => [j.title, j.company, j.workMode, j.sourceUrl, j.source])).toEqual([
      ['Senior React Engineer', 'Acme Corp', 'REMOTE', 'https://arc.dev/remote-jobs/j/acme-senior-react-1', 'arc'],
    ]);
    expect(await prisma.emailMessage.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ status: 'PARSED', parser: 'ai', portal: 'arc' });
    expect(await prisma.aiUsage.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ purpose: 'EXTRACT_EMAIL', succeeded: true });
  });

  it('records "not a job alert" when the model says so', async () => {
    const { user, gmail, svc } = await setup();
    gmail.inLabel = [mail('m1', synthetic('Wellfound <team@wellfound.com>', 'Our new feature', '<p>Product news</p>'))];
    await svc.check(user.id);
    expect(await prisma.emailMessage.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ status: 'NOT_ALERT', parser: 'ai' });
  });

  it('defers (never drops) over budget, then reads the message once there is room', async () => {
    const { user, gmail, extractor, svc } = await setup();
    await prisma.aiSettings.create({ data: { userId: user.id, maxAnalysesPerDay: 40, monthlyBudgetUsd: 0 } });
    gmail.inLabel = [mail('m1', portalEmail)];
    await svc.check(user.id);
    expect(extractor.prompts).toHaveLength(0);
    expect(await prisma.emailMessage.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ status: 'DEFERRED' });

    await prisma.aiSettings.update({ where: { userId: user.id }, data: { monthlyBudgetUsd: 5 } });
    gmail.inLabel = []; // gone from this check's window — re-read by id anyway
    gmail.getMessage = async () => mail('m1', portalEmail);
    extractor.next = (u) => ({
      isJobEmail: true,
      jobs: [{ title: 'Senior React Engineer', company: 'Acme Corp', location: 'Remote', workMode: 'REMOTE', salary: null, link: linkRef(u, 'acme-senior-react') }],
    });
    await svc.check(user.id);
    expect(await prisma.emailMessage.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ status: 'PARSED' });
    expect(await prisma.job.count({ where: { userId: user.id } })).toBe(1);
  });

  it('falls back to the model, and says so, when a code parser finds nothing in an alert', async () => {
    const { user, gmail, extractor, svc } = await setup();
    // Indeed redesigned its email: the parser no longer recognises the layout.
    gmail.inLabel = [
      mail('m1', synthetic('Indeed <donotreply@jobalert.indeed.com>', '2 new jobs', '<table><tr><td><a href="https://pk.indeed.com/viewjob?jk=abc12345">React Developer</a></td><td>Arbisoft</td></tr></table>')),
    ];
    extractor.next = (u) => ({
      isJobEmail: true,
      jobs: [{ title: 'React Developer', company: 'Arbisoft', location: null, workMode: 'UNKNOWN', salary: null, link: linkRef(u, 'jk=abc12345') }],
    });
    await svc.check(user.id);
    expect(extractor.prompts).toHaveLength(1);
    expect(await prisma.emailMessage.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      status: 'PARSED',
      parser: 'ai',
      portal: 'indeed',
      note: expect.stringMatching(/Indeed parser found no jobs.*may be out of date/),
    });
  });
});

describe('partial jobs', () => {
  it('a board with the full description completes an alert-only job, which is then scored again', async () => {
    const { user, gmail, svc } = await setup();
    gmail.inLabel = [mail('m1', fixture('indeed-alert.eml'))];
    await svc.check(user.id);
    const partial = await prisma.job.findFirstOrThrow({ where: { userId: user.id, company: 'WSL Consultants' } });

    const source = await prisma.jobSource.create({ data: { userId: user.id, key: 'greenhouse:wsl', name: 'WSL', type: 'ATS_BOARD', config: { provider: 'greenhouse', board: 'wsl' } } });
    const run = await prisma.discoveryRun.create({ data: { jobSourceId: source.id, status: 'RUNNING' } });
    const r = await storeJobs(prisma, { userId: user.id, jobSourceId: source.id, discoveryRunId: run.id, provider: 'greenhouse' }, [
      {
        posting: { externalId: 'g1', title: 'Full Stack Developer', company: 'WSL Consultants', location: 'Lahore', workMode: null, url: 'https://x', postedAt: null, description: null },
        description: 'Full description: React, Node.js, PostgreSQL, five years of experience…',
      },
    ]);
    expect(r).toEqual({ newJobIds: [], completedJobIds: [partial.id] });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: partial.id } })).toMatchObject({
      isPartial: false,
      analysisStatus: 'PENDING',
      rawJD: expect.stringMatching(/^Full description/),
      sourceUrl: 'https://pk.indeed.com/viewjob?jk=70863ace132f8e01', // where it was first found
    });
  });
});

describe('EmailService.check — failures', () => {
  it('fails visibly, without retrying, when the label is missing', async () => {
    const { user, gmail, svc } = await setup();
    gmail.labelList = [{ id: 'INBOX', name: 'INBOX' }];
    await expect(svc.check(user.id)).rejects.toBeInstanceOf(PermanentEmailError);
    expect(await prisma.gmailConnection.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      status: 'ACTIVE',
      lastCheckStatus: 'FAILED',
      lastError: expect.stringMatching(/no "Shortlist" label/),
    });
  });

  it('asks the user to reconnect when Google revoked the grant', async () => {
    const { user, oauth, svc } = await setup();
    oauth.next = async () => {
      throw new GoogleApiError('Google 400 invalid_grant: Token has been expired or revoked.', 400, 'invalid_grant');
    };
    await expect(svc.check(user.id)).rejects.toBeInstanceOf(PermanentEmailError);
    expect(await prisma.gmailConnection.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ status: 'NEEDS_RECONNECT' });
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
});
