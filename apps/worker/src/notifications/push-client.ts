import { sendPush, type PushTarget } from '@shortlist/shared/node';
import type { PushPayload } from '@shortlist/shared';
import type { Env } from '../config/env.js';

// The one place the worker talks to push services (docs/notifications.md §19.3). An interface
// so tests use a fake and never reach Google or Apple.
export interface PushClient {
  readonly configured: boolean;
  send(
    target: PushTarget,
    payload: PushPayload,
    opts: { ttlSeconds: number; topic?: string; urgency?: 'normal' | 'high' },
  ): Promise<{ status: number }>;
}
export const PUSH_CLIENT = Symbol('PUSH_CLIENT');

export class WebPushClient implements PushClient {
  constructor(private readonly env: Env) {}

  get configured() {
    return !!(this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY && this.env.VAPID_SUBJECT);
  }

  send(
    target: PushTarget,
    payload: PushPayload,
    opts: { ttlSeconds: number; topic?: string; urgency?: 'normal' | 'high' },
  ) {
    return sendPush(target, payload, {
      vapid: { publicKey: this.env.VAPID_PUBLIC_KEY!, privateKey: this.env.VAPID_PRIVATE_KEY! },
      subject: this.env.VAPID_SUBJECT!,
      ...opts,
    });
  }
}
