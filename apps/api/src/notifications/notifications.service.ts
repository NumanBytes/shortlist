import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettingsInput,
  type SubscribePushInput,
} from '@shortlist/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobQueues } from '../queue/job-queues.js';

// Web Push (docs/notifications.md §19). The API keeps the per-device subscriptions, settings and
// the notification log; the worker does all sending.
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: JobQueues,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // What the browser needs to subscribe: the VAPID public key (or that push isn't set up).
  config() {
    return { configured: !!this.env.VAPID_PUBLIC_KEY, publicKey: this.env.VAPID_PUBLIC_KEY ?? null };
  }

  // One row per device, keyed by its endpoint. The same browser signing in to another account
  // moves the subscription over: a device notifies whoever is signed in on it.
  async subscribe(userId: string, input: SubscribePushInput) {
    const data = {
      userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
    };
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
      select: { id: true },
    });
    return row;
  }

  // Only the caller's own device: another user's endpoint is left alone (and not revealed).
  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  devices(userId: string) {
    return this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, userAgent: true, createdAt: true, lastSentAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeDevice(userId: string, id: string) {
    const { count } = await this.prisma.pushSubscription.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Device not found');
  }

  async settings(userId: string): Promise<NotificationSettingsInput> {
    const row = await this.prisma.notificationSettings.findUnique({ where: { userId } });
    if (!row) return DEFAULT_NOTIFICATION_SETTINGS;
    const { id: _id, userId: _u, updatedAt: _t, ...settings } = row;
    return settings;
  }

  async saveSettings(userId: string, input: NotificationSettingsInput) {
    await this.prisma.notificationSettings.upsert({ where: { userId }, create: { userId, ...input }, update: input });
    return this.settings(userId);
  }

  // "Send a test" — the quickest way to see the whole chain work on a phone.
  async test(userId: string) {
    if (!this.env.VAPID_PUBLIC_KEY)
      throw new ServiceUnavailableException('Push notifications are not set up on this server');
    const n = await this.prisma.notification.create({
      data: {
        userId,
        key: `test:${Date.now()}`,
        kind: 'TEST',
        title: 'Shortlist notifications are on',
        body: 'This is how new matches, your morning digest and ready resumes will reach you.',
        url: '/',
      },
    });
    await this.queues.enqueueNotification(n.id);
    return { queued: true };
  }

  recent(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, kind: true, title: true, body: true, url: true, createdAt: true, readAt: true },
    });
  }

  // Opening the app reads them all (and the web app clears the icon badge).
  async readAll(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
