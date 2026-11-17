import type { PushPayload } from '@shortlist/shared';
import { BudgetGuard } from '../analysis/budget-guard.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsProcessor, digestDue } from './notifications.processor.js';
import { Notifier } from './notifier.js';
import type { PushClient } from './push-client.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];
const env = { DIGEST_HOUR: 11 } as Env; // 12:00 in Lahore is within its catch-up window
const NOON_PKT = new Date('2026-10-13T07:00:00Z'); // 12:00 in Lahore
const MIDNIGHT_PKT = new Date('2026-10-13T19:30:00Z'); // 00:30 in Lahore — quiet hours

class FakeQueue {
  added: { name: string; data: unknown }[] = [];
  async add(name: string, data: unknown) {
    this.added.push({ name, data });
  }
}

class FakePush implements PushClient {
  configured = true;
  sent: { endpoint: string; payload: PushPayload }[] = [];
  status: (endpoint: string) => number = () => 201;
  async send(target: { endpoint: string }, payload: PushPayload) {
    this.sent.push({ endpoint: target.endpoint, payload });
    return { status: this.status(target.endpoint) };
  }
}

async function setup(timeZone = 'Asia/Karachi') {
  const user = await prisma.user.create({
    data: {
      email: `notify-${crypto.randomUUID()}@e2e.shortlist.test`,
      name: 'Notify Test',
      passwordHash: 'x',
      timeZone,
    },
  });
  createdUsers.push(user.id);
  const queue = new FakeQueue();
  const notifier = new Notifier(prisma, queue as never);
  const push = new FakePush();
  const processor = new NotificationsProcessor(prisma, notifier, push, env);
  const device = (n: number) =>
    prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${user.id}-${n}`,
        p256dh: 'p',
        auth: 'a',
      },
    });
  return { user, queue, notifier, push, processor, device };
}

const note = (key: string, kind: 'STRONG_MATCH' | 'DIGEST' | 'PROBLEM' = 'PROBLEM') => ({
  key,
  kind,
  title: 'T',
  body: 'B',
  url: '/',
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe('Notifier', () => {
  it('records an event once, however often it is reported, and queues one push', async () => {
    const { user, queue, notifier } = await setup();
    expect(await notifier.notify(user.id, note('problem:x'), NOON_PKT)).toBe('queued');
    expect(await notifier.notify(user.id, note('problem:x'), NOON_PKT)).toBe('duplicate');
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(queue.added).toHaveLength(1);
  });

  it('records but does not push a kind the user turned off, or an instant one in quiet hours', async () => {
    const { user, queue, notifier } = await setup();
    await prisma.notificationSettings.create({ data: { userId: user.id, problems: false } });
    expect(await notifier.notify(user.id, note('problem:off'), NOON_PKT)).toBe('recorded');
    expect(await notifier.notify(user.id, note('job:1:strong-match', 'STRONG_MATCH'), MIDNIGHT_PKT)).toBe('recorded');
    expect(await notifier.notify(user.id, note('digest:x', 'DIGEST'), MIDNIGHT_PKT)).toBe('queued'); // the digest isn't held
    expect(queue.added).toHaveLength(1);
  });

  it('pushes a strong match only for an alert-email job at or above the threshold', async () => {
    const { user, notifier } = await setup();
    const email = await prisma.jobSource.create({
      data: { userId: user.id, key: 'email_alerts:linkedin', name: 'LinkedIn', type: 'EMAIL_INBOX', config: {} },
    });
    const board = await prisma.jobSource.create({
      data: { userId: user.id, key: 'remoteok', name: 'Remote OK', type: 'AGGREGATOR_API', config: {} },
    });
    const job = async (sourceId: string, score: number) =>
      prisma.job.create({
        data: {
          userId: user.id,
          jobSourceId: sourceId,
          title: `Dev ${score}`,
          company: 'Acme',
          rawJD: 'x',
          dedupeHash: crypto.randomUUID(),
          match: { create: { overallScore: score, commercialScore: score, verdict: 'APPLY' } },
        },
      });
    const strong = await job(email.id, 86);
    await notifier.strongMatch(strong.id);
    await notifier.strongMatch((await job(email.id, 60)).id); // below 80
    await notifier.strongMatch((await job(board.id, 95)).id); // board jobs wait for the digest
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.key)).toEqual([`job:${strong.id}:strong-match`]);
    expect(rows[0]).toMatchObject({ kind: 'STRONG_MATCH', url: `/jobs/${strong.id}` });
  });

  it('reports a reached AI budget once a month', async () => {
    const { user, notifier } = await setup();
    await prisma.aiUsage.create({
      data: {
        userId: user.id,
        purpose: 'TAILOR_RESUME',
        model: 'x',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 1000,
        succeeded: true,
      },
    });
    const guard = new BudgetGuard(prisma, notifier);
    expect((await guard.checkMonthly(user.id)).allowed).toBe(false);
    expect((await guard.checkMonthly(user.id)).allowed).toBe(false);
    expect(await prisma.notification.count({ where: { userId: user.id, kind: 'PROBLEM' } })).toBe(1);
  });

  // One Anthropic key pays for every account (Agents.md §2.1).
  it('stops every user once the server-wide cap is reached, without naming the spend', async () => {
    const { user, notifier } = await setup();
    const capped = new BudgetGuard(prisma, notifier, { AI_SERVER_MONTHLY_BUDGET_USD: 0 });
    const decision = await capped.checkMonthly(user.id);
    expect(decision).toEqual({ allowed: false, reason: "Shortlist's AI allowance for this month is used up" });
    const problem = await prisma.notification.findFirstOrThrow({ where: { userId: user.id, kind: 'PROBLEM' } });
    expect(problem.key).toMatch(/^problem:server-budget:/);
    expect(problem.body).not.toMatch(/\$/);

    const roomy = new BudgetGuard(prisma, notifier, { AI_SERVER_MONTHLY_BUDGET_USD: 1_000_000 });
    expect(await roomy.checkMonthly(user.id)).toEqual({ allowed: true });
  });
});

describe('NotificationsProcessor.send', () => {
  it('pushes to every device, deletes one the push service says is gone, and marks it sent', async () => {
    const { user, notifier, push, processor, device } = await setup();
    const live = await device(1);
    const gone = await device(2);
    push.status = (endpoint) => (endpoint === gone.endpoint ? 410 : 201);
    await notifier.notify(user.id, note('problem:send'), NOON_PKT);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });

    expect(await processor.send(n.id)).toEqual({ delivered: 1 });
    expect(push.sent[0]!.payload).toMatchObject({ title: 'T', body: 'B', url: '/', unread: 1 });
    expect(await prisma.pushSubscription.findMany({ where: { userId: user.id } })).toEqual([
      expect.objectContaining({ id: live.id, lastSentAt: expect.any(Date) }),
    ]);
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ deliveredTo: 1 });
    // Sent once: a repeated job doesn't push it again.
    expect(await processor.send(n.id)).toEqual({ skipped: 'already sent' });
  });

  it('asks the queue to retry when no device took it and the push service was down', async () => {
    const { user, notifier, push, processor, device } = await setup();
    await device(1);
    push.status = () => 503;
    await notifier.notify(user.id, note('problem:down'), NOON_PKT);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    await expect(processor.send(n.id)).rejects.toThrow(/503/);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).sentAt).toBeNull();
  });
});

describe('NotificationsProcessor.digest', () => {
  it('summarizes the new jobs once a day for each user with a device', async () => {
    const { user, queue, processor, device } = await setup();
    await device(1);
    for (const [title, score, verdict] of [
      ['React Developer', 84, 'APPLY'],
      ['QA Engineer', 30, 'SKIP'],
    ] as const)
      await prisma.job.create({
        data: {
          userId: user.id,
          title,
          company: 'Acme',
          rawJD: 'x',
          dedupeHash: crypto.randomUUID(),
          discoveredAt: new Date(NOON_PKT.getTime() - 3600_000),
          match: { create: { overallScore: score, commercialScore: score, verdict } },
        },
      });
    await processor.digest(NOON_PKT);
    await processor.digest(NOON_PKT); // a second firing the same day
    const digests = await prisma.notification.findMany({ where: { userId: user.id, kind: 'DIGEST' } });
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({
      key: 'digest:2026-10-13',
      title: '2 new jobs · 1 strong match',
      body: 'React Developer @ Acme (84)',
    });
    expect(queue.added.filter((a) => a.name === 'notify-send')).toHaveLength(1);
  });

  // Each user's own morning (Agents.md §2.1): noon in Lahore is 03:00 in New York.
  it("waits for the user's own digest hour", async () => {
    const { user, processor, device } = await setup('America/New_York');
    await device(1);
    await prisma.job.create({
      data: { userId: user.id, title: 'React Developer', company: 'Acme', rawJD: 'x', dedupeHash: crypto.randomUUID() },
    });
    await processor.digest(NOON_PKT);
    expect(await prisma.notification.count({ where: { userId: user.id, kind: 'DIGEST' } })).toBe(0);
    await processor.digest(new Date('2026-10-13T15:30:00Z')); // 11:30 in New York
    expect(await prisma.notification.findFirst({ where: { userId: user.id, kind: 'DIGEST' } })).toMatchObject({
      key: 'digest:2026-10-13',
    });
  });

  it('keeps quiet hours on the user’s clock', async () => {
    const lahore = await setup('Asia/Karachi');
    const ny = await setup('America/New_York');
    // 00:30 in Lahore (quiet), 15:30 the day before in New York (not).
    expect(await lahore.notifier.notify(lahore.user.id, note('problem:q1'), MIDNIGHT_PKT)).toBe('recorded');
    expect(await ny.notifier.notify(ny.user.id, note('problem:q2'), MIDNIGHT_PKT)).toBe('queued');
  });
});

describe('digestDue', () => {
  it('is due from the digest hour through the catch-up window, never in the evening', () => {
    expect([7, 8, 9, 10, 11, 20].map((h) => digestDue(h, 8))).toEqual([false, true, true, true, false, false]);
  });
});
