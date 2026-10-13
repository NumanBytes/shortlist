import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATIONS_QUEUE,
  NotifyJob,
  hourIn,
  inQuietHours,
  queueJobOptions,
  type NotificationSettingsInput,
  type NotifySendData,
} from '@shortlist/shared';
import type { NotificationKind } from '@shortlist/db';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NewNotification {
  key: string; // unique per user: the same event is recorded — and pushed — once
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
}

type Flag = 'digest' | 'strongMatch' | 'resumeReady' | 'problems';
const FLAG: Record<NotificationKind, Flag | null> = {
  DIGEST: 'digest',
  STRONG_MATCH: 'strongMatch',
  RESUME_READY: 'resumeReady',
  PROBLEM: 'problems',
  TEST: null,
};
// Pushed even in quiet hours: the digest is scheduled for the morning, and a resume was asked for.
const IGNORES_QUIET_HOURS = new Set<NotificationKind>(['DIGEST', 'RESUME_READY', 'TEST']);

// Everything in the worker that has news for the user calls this (docs/notifications.md §19.4). It
// records the notification — once per key — and queues the push unless the user turned that
// kind off or it's quiet hours. It never throws: a notification must not fail the job that
// produced it (a resume, a discovery run).
@Injectable()
export class Notifier {
  private readonly logger = new Logger(Notifier.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async settings(userId: string): Promise<NotificationSettingsInput> {
    const row = await this.prisma.notificationSettings.findUnique({ where: { userId } });
    if (!row) return DEFAULT_NOTIFICATION_SETTINGS;
    const { id: _id, userId: _u, updatedAt: _t, ...s } = row;
    return s;
  }

  async notify(
    userId: string,
    n: NewNotification,
    now = new Date(),
  ): Promise<'queued' | 'recorded' | 'duplicate' | 'failed'> {
    try {
      const existing = await this.prisma.notification.findUnique({
        where: { userId_key: { userId, key: n.key } },
        select: { id: true },
      });
      if (existing) return 'duplicate';
      const row = await this.prisma.notification.create({ data: { userId, ...n } }).catch((err: unknown) => {
        // Two producers racing on the same key: the other one won.
        if ((err as { code?: string }).code === 'P2002') return null;
        throw err;
      });
      if (!row) return 'duplicate';

      const s = await this.settings(userId);
      const flag = FLAG[n.kind];
      if (flag && !s[flag]) return 'recorded';
      if (
        !IGNORES_QUIET_HOURS.has(n.kind) &&
        inQuietHours(hourIn(now, this.env.DISCOVERY_TZ), s.quietStart, s.quietEnd)
      )
        return 'recorded';

      await this.queue.add(
        NotifyJob.Send,
        { notificationId: row.id } satisfies NotifySendData,
        queueJobOptions.notifySend(row.id),
      );
      return 'queued';
    } catch (err) {
      this.logger.warn(`Couldn't notify (${n.key}): ${(err as Error).message}`);
      return 'failed';
    }
  }

  // ── The events (each called from where it happens) ─────────────────────────────

  // A job from an alert email scored at or above the user's threshold: worth knowing now, since
  // alerts arrive during the day. Board jobs arrive at night and go in the morning digest.
  async strongMatch(jobId: string) {
    const job = await this.prisma.job
      .findUnique({
        where: { id: jobId },
        select: { userId: true, title: true, company: true, jobSource: { select: { type: true } }, match: true },
      })
      .catch(() => null);
    if (!job?.match || job.jobSource?.type !== 'EMAIL_INBOX') return;
    const s = await this.settings(job.userId);
    if (job.match.overallScore < s.strongMatchMin) return;
    await this.notify(job.userId, {
      key: `job:${jobId}:strong-match`,
      kind: 'STRONG_MATCH',
      title: `Strong match: ${job.title}`,
      body: `${job.company} · ${job.match.overallScore}/100`,
      url: `/jobs/${jobId}`,
    });
  }

  async resumeReady(jobId: string, variantId: string) {
    const job = await this.prisma.job
      .findUnique({ where: { id: jobId }, select: { userId: true, title: true, company: true } })
      .catch(() => null);
    if (!job) return;
    await this.notify(job.userId, {
      key: `resume:${variantId}`,
      kind: 'RESUME_READY',
      title: `Resume ready: ${job.title}`,
      body: `${job.company} — review it, then apply on their site.`,
      url: `/jobs/${jobId}/resume`,
    });
  }

  // Something stopped working. Keyed per day (or month), so a problem that persists is
  // reported once a day, not on every run.
  async problem(userId: string, key: string, title: string, body: string, url: string) {
    await this.notify(userId, { key: `problem:${key}`, kind: 'PROBLEM', title, body, url });
  }
}
