import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import {
  NOTIFICATIONS_QUEUE,
  NotifyJob,
  digestMessage,
  type NotifySendData,
  type PushPayload,
} from '@shortlist/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Notifier } from './notifier.js';
import { PUSH_CLIENT, type PushClient } from './push-client.js';

// How long a push service keeps a message for a phone that's offline. A digest is stale by
// evening; a problem report is still worth seeing the next day.
const TTL_SECONDS: Record<string, number> = { DIGEST: 12 * 3600, PROBLEM: 24 * 3600 };
const DEFAULT_TTL = 6 * 3600;

// The day in DISCOVERY_TZ, "2026-10-13": the digest's idempotency key.
export const localDay = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

// Sends notifications (docs/notifications.md §19.3) and builds the morning digest. Sending is
// outbound I/O to push services, so it lives in the worker, never on the API's event loop.
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: Notifier,
    @Inject(PUSH_CLIENT) private readonly push: PushClient,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === NotifyJob.Send) return this.send((job.data as NotifySendData).notificationId);
    if (job.name === NotifyJob.Digest) return this.digest();
    throw new UnrecoverableError(`Unknown job "${job.name}"`);
  }

  // Encrypts and pushes one notification to each of the user's devices. A device the push
  // service says is gone (404/410) is deleted. Retried only when no device took it and one
  // failed transiently — a retry after a partial success would show the others a duplicate.
  async send(notificationId: string) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n || n.sentAt) return { skipped: n ? 'already sent' : 'gone' };
    if (!this.push.configured) return { skipped: 'VAPID keys not set' };
    const devices = await this.prisma.pushSubscription.findMany({ where: { userId: n.userId } });
    if (devices.length === 0) return { skipped: 'no devices' };

    const unread = await this.prisma.notification.count({ where: { userId: n.userId, readAt: null } });
    const payload: PushPayload = {
      title: n.title,
      body: n.body,
      url: n.url,
      tag: n.kind === 'DIGEST' ? 'digest' : n.key,
      unread,
    };
    let delivered = 0;
    let transient: string | null = null;
    for (const d of devices) {
      try {
        const { status } = await this.push.send({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, payload, {
          ttlSeconds: TTL_SECONDS[n.kind] ?? DEFAULT_TTL,
          urgency: n.kind === 'STRONG_MATCH' ? 'high' : 'normal',
        });
        if (status >= 200 && status < 300) {
          delivered++;
          await this.prisma.pushSubscription.update({ where: { id: d.id }, data: { lastSentAt: new Date() } });
        } else if (status === 404 || status === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: d.id } }).catch(() => undefined);
          this.logger.log(`Removed a device whose subscription expired (${status})`);
        } else {
          transient = `push service answered ${status}`;
        }
      } catch (err) {
        transient = (err as Error).message;
      }
    }
    if (delivered === 0 && transient) throw new Error(`Push failed: ${transient}`); // the queue retries
    await this.prisma.notification.update({
      where: { id: n.id },
      data: { sentAt: new Date(), deliveredTo: delivered },
    });
    return { delivered };
  }

  // The morning summary of what the night found (docs/notifications.md §19.4), for every user with
  // a device. Jobs found since the last digest (or the last day), still New.
  async digest(now = new Date()) {
    const users = await this.prisma.pushSubscription.findMany({ distinct: ['userId'], select: { userId: true } });
    const day = localDay(now, this.env.DISCOVERY_TZ);
    let sent = 0;
    for (const { userId } of users) {
      const last = await this.prisma.notification.findFirst({
        where: { userId, kind: 'DIGEST' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const since = last?.createdAt ?? new Date(now.getTime() - 24 * 3600_000);
      const jobs = await this.prisma.job.findMany({
        where: { userId, status: 'DISCOVERED', discoveredAt: { gt: since } },
        select: { title: true, company: true, match: { select: { overallScore: true, verdict: true } } },
      });
      const message = digestMessage(
        jobs.map((j) => ({
          title: j.title,
          company: j.company,
          score: j.match?.overallScore ?? null,
          verdict: j.match?.verdict ?? null,
        })),
      );
      if (!message) continue;
      const result = await this.notifier.notify(
        userId,
        { key: `digest:${day}`, kind: 'DIGEST', url: '/', ...message },
        now,
      );
      if (result === 'queued') sent++;
    }
    return { users: users.length, sent };
  }
}
