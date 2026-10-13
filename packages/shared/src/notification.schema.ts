import { z } from 'zod';

// Web Push notifications (docs/notifications.md §19). Request bodies, queue names, and the pure
// rules (quiet hours, digest wording) shared by the API, the worker and the web app.

// ── Push services ────────────────────────────────────────────────────────────────
// A subscription's endpoint comes from the browser, and the worker POSTs to it, so it must
// belong to a real push service — otherwise "subscribe" would make the worker send requests
// anywhere (SSRF).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const base64url = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'Must be base64url')
    .refine((s) => Math.floor((s.length * 3) / 4) === bytes, `Must encode ${bytes} bytes`);

// What PushManager.subscribe() returns, as PushSubscription.toJSON() shapes it.
export const SubscribePushSchema = z
  .object({
    endpoint: z.string().max(1000).refine(isPushEndpoint, 'Not a known push service endpoint'),
    keys: z.object({ p256dh: base64url(65), auth: base64url(16) }).strict(),
    expirationTime: z.number().nullable().optional(),
    userAgent: z.string().max(300).optional(),
  })
  .strict();
export type SubscribePushInput = z.infer<typeof SubscribePushSchema>;

export const UnsubscribePushSchema = z.object({ endpoint: z.string().max(1000) }).strict();
export type UnsubscribePushInput = z.infer<typeof UnsubscribePushSchema>;

// ── Settings ─────────────────────────────────────────────────────────────────────
const hour = z.number().int().min(0).max(23).nullable();
export const NotificationSettingsSchema = z
  .object({
    digest: z.boolean(),
    strongMatch: z.boolean(),
    strongMatchMin: z.number().int().min(50).max(100),
    resumeReady: z.boolean(),
    problems: z.boolean(),
    quietStart: hour,
    quietEnd: hour,
  })
  .strict()
  .refine((s) => (s.quietStart === null) === (s.quietEnd === null), {
    message: 'Set both ends of quiet hours, or neither',
    path: ['quietEnd'],
  });
export type NotificationSettingsInput = z.infer<typeof NotificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsInput = {
  digest: true,
  strongMatch: true,
  strongMatchMin: 80,
  resumeReady: true,
  problems: true,
  quietStart: 23,
  quietEnd: 8,
};

// Whether `hour` falls in quiet hours [start, end), which may wrap midnight (23 → 8).
export function inQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

// The hour (0-23) of `date` in `timeZone`.
export function hourIn(date: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(date));
}

// ── Queue ────────────────────────────────────────────────────────────────────────
// Sending is slow outbound I/O to push services, so it runs in the worker on its own queue.
export const NOTIFICATIONS_QUEUE = 'notifications';

export const NotifyJob = {
  // Push one stored Notification to every device of its user.
  Send: 'notify-send',
  // The morning digest for every user, fired by a scheduler in DISCOVERY_TZ.
  Digest: 'notify-digest',
} as const;

export interface NotifySendData {
  notificationId: string;
}

export const DIGEST_SCHEDULER_ID = 'morning-digest';

// What the service worker receives (encrypted), and shows.
export interface PushPayload {
  title: string;
  body: string;
  url: string; // in-app path opened on tap
  tag: string; // a newer notification with the same tag replaces the older one on the device
  unread?: number; // for the app icon badge
}

// ── Wording ──────────────────────────────────────────────────────────────────────
export interface DigestJob {
  title: string;
  company: string;
  score: number | null;
  verdict: 'APPLY' | 'STRETCH' | 'SKIP' | null;
}

// "9 new jobs · 2 strong matches" / "React Developer @ Acme (84), Frontend Engineer @ Kwanso (78)".
// Null when there is nothing worth a notification.
export function digestMessage(jobs: DigestJob[]): { title: string; body: string } | null {
  if (jobs.length === 0) return null;
  const strong = jobs.filter((j) => j.verdict === 'APPLY').sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const title = `${jobs.length} new ${jobs.length === 1 ? 'job' : 'jobs'}${
    strong.length ? ` · ${strong.length} strong ${strong.length === 1 ? 'match' : 'matches'}` : ''
  }`;
  const top = (strong.length ? strong : [...jobs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))).slice(0, 3);
  const body = top.map((j) => `${j.title} @ ${j.company}${j.score !== null ? ` (${j.score})` : ''}`).join(', ');
  return { title, body };
}
