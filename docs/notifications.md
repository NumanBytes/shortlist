# Notifications

How news reaches the user's phone: Web Push, what is sent and when, and how it's set up.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 19. Push notifications (built 2026-10-13)

### 19.1 Why

Until now the app only worked if the user remembered to open it: new jobs, ready resumes and
broken sources all waited silently (user report, 2026-10-12). The design was agreed with the
user then; the choices below follow it.

### 19.2 Web Push, hand-rolled

A PWA's way to notify: the server sends a message to the push service of the user's browser
(Google's FCM for Chrome, Mozilla's, Apple's), which delivers it to the device even when the
app is closed. Two standards, implemented by hand in `packages/shared/src/node/web-push.ts`
(no `web-push` library — the mechanism is the point, like the hand-rolled JWT and OAuth):

- **VAPID (RFC 8292):** the server signs a short ES256 JWT (`aud` = the push service's origin,
  `exp` 12 h, `sub` = a contact) with a key pair; the browser was given the public half
  (`applicationServerKey`) when it subscribed, so the push service only accepts messages from
  this server for that subscription. JWS wants the raw 64-byte `r||s` signature, not Node's DER.
- **Message encryption (RFC 8291, aes128gcm):** each message is encrypted for one device:
  ECDH between a fresh server key and the device's `p256dh` key, mixed with the device's
  `auth` secret through HKDF, then AES-128-GCM. The push service only ever carries
  ciphertext. **A test reproduces the RFC's worked example byte for byte**, and decrypts a
  fresh message the way a browser does.
- Push services accept about 4 KB, so payloads are small: title, body, the in-app URL, a tag,
  and the unread count for the app badge.
- Keys: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in the worker (validated as a
  matching pair at boot; all three or none), `VAPID_PUBLIC_KEY` in the API. Generate with
  `pnpm --filter @shortlist/worker vapid:keys`. Changing the pair makes every device re-enable.

### 19.3 Storing and sending

- **`PushSubscription`** — one row per device (endpoint + its keys + a "Chrome on Android"
  label), keyed by endpoint: the same browser signing in to another account moves over.
  **Only real push services' endpoints are accepted** (`isPushEndpoint()`): the worker POSTs
  to them, so any URL would make "subscribe" an SSRF hole.
- **`Notification`** — every notification, sent or not, with a **unique key per user**
  (`digest:2026-10-13`, `job:<id>:strong-match`, `resume:<variantId>`,
  `problem:source-failing:<id>:<day>`). The same event produced twice — a retried job, two
  runs — is stored and pushed once: the key is the idempotency guard, as job ids are for the
  queue.
- **Sending is the worker's** (the API never does slow outbound I/O): the `notifications` queue,
  job id = notification id. `NotificationsProcessor.send()` encrypts and posts to each device:
  2xx delivered; **404/410 → the device is deleted** (the subscription expired or was
  revoked); other failures are retried only if no device took it — a retry after a partial
  success would show the others a duplicate.
- TTL (how long a push service holds it for an offline phone): digest 12 h, problems 24 h,
  the rest 6 h. Strong matches are sent with `Urgency: high`.

### 19.4 What is sent, and when

All through `Notifier` (worker, global), which records the notification and queues the push
unless the user turned that kind off or it's quiet hours. It never throws: a notification
must not fail the job that produced it.

| Kind | When | Where it's raised |
|---|---|---|
| **Morning digest** | 08:00 in `DISCOVERY_TZ` (`DIGEST_CRON`, a Redis job scheduler), after discovery (02:00) and scoring (03:00): "9 new jobs · 2 strong matches" and the top three. Only if there's something new; once a day per user. | `NotificationsProcessor.digest()` |
| **Strong match** | A job **from an alert email** scored at or above the user's threshold (default 80). Alerts arrive through the day, and early applications do better; board jobs arrive at night and go in the digest. | `AnalysisService` after scoring |
| **Resume ready** | A tailored resume was stored (tailoring takes a minute or two). | `ResumeService` |
| **Problem** | Gmail needs reconnecting; a source **failed 3 runs in a row** (a dead source otherwise looks exactly like "no new jobs"); the monthly AI budget was reached. Once a day (budget: once a month). | `EmailService`, `DiscoveryService`, `BudgetGuard` |

**Settings** (`NotificationSettings`, Profile → Notifications, saved as they change): each kind
on/off, the strong-match threshold, and quiet hours (default 23:00–08:00) during which instant
notifications are recorded but not pushed — the digest covers them; the digest and a
requested resume aren't held.

### 19.5 The phone side

- **Our own service worker** (`apps/web/src/sw/sw.ts`, vite-plugin-pwa `injectManifest`) instead
  of the generated one, because push handling needs code. It keeps the old rules: precache the
  app shell only, `/api` never cached or served from it, pdf.js not precached.
- `push` → show the notification (tag-collapsed: a newer digest replaces the older) and set the
  app icon badge; `notificationclick` → focus an open window on the notification's screen, or
  open one. Only this app's own paths are ever opened.
- Profile → Notifications: "Turn on" asks permission, subscribes with the server's public key,
  and registers the device with the API; "Turn off" unsubscribes. Lists the devices and
  offers "Send a test". On iPhone, Web Push works only for the app added to the home screen
  (iOS 16.4+), and the screen says so.
- Opening the app clears the badge and marks notifications read.

### 19.6 Setting it up

1. On the laptop: `pnpm --filter @shortlist/worker build && pnpm --filter @shortlist/worker vapid:keys`.
2. Put all three values in `apps/worker/.env` and `VAPID_PUBLIC_KEY` in `apps/api/.env`
   (production: `deploy/.env`, which Compose passes to both).
3. Restart the API and worker, open Profile → Notifications on the phone → Turn on → Send a test.
