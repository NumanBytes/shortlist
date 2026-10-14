# Authentication and security

Hand-rolled JWT auth, the refresh cookie, rate limits and other security decisions.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 8. Authentication and security

### 8.1 API authentication (hand-rolled JWT — no Passport)

Deliberately hand-rolled so every mechanism is visible and explainable ([§14](architecture.md)).

- **Passwords:** bcrypt, cost 12 (`BCRYPT_ROUNDS`). Passwords over **72 bytes** are
  rejected, because bcrypt silently ignores everything after 72 bytes.
- **No account enumeration:** one message for "unknown email" and "wrong password", and
  an unknown email still runs a bcrypt compare against a dummy hash so both failures take
  the same time.
- **Access token:** HS256 JWT, 15 minutes (`JWT_ACCESS_TTL_SECONDS`), verification pins
  `algorithms: ['HS256']` (blocks `alg: none` and algorithm-confusion forgeries); the
  secret must be ≥32 characters (checked at boot).
- **Refresh token:** 32 random bytes (opaque, not a JWT — the server has to look it up to
  check revocation anyway), 30 days (`REFRESH_TOKEN_TTL_DAYS`). Only its SHA-256 hash is
  stored (SHA-256 rather than bcrypt: 256 bits of randomness can't be dictionary-attacked,
  and a deterministic hash can be looked up by unique index).
- **Rotation with reuse detection:** each refresh token works once; the swap is a
  conditional update (`WHERE revokedAt IS NULL`) so concurrent requests with the same
  token can't both win. If an already-revoked token is presented, two parties hold it, so
  **every session of that user is revoked**.
- **Pruned as it goes (2026-10-11):** every refresh adds a row, so issuing tokens also
  deletes that user's *expired* ones — the table stays bounded by the token lifetime
  without a scheduled job. Revoked-but-unexpired rows stay: reuse detection needs them.
- **Secure by default:** a global `AuthGuard` (`APP_GUARD`) protects every route; public
  routes opt out with `@Public()`. Forgetting the decorator leaves a route locked, not
  open.
- **Never return `passwordHash`:** responses use `PUBLIC_USER_SELECT`.
- **Rate limits on login and register (built 2026-10-04).** Hand-rolled
  (`apps/api/src/rate-limit/`), with Redis counters ([§4](architecture.md)):
  - **Per account:** 10 *failed* logins per 15 minutes, counted against the email from any
    IP, which stops guessing one account from many machines. Once exhausted, the attempt
    is refused **before the password is checked**. The key is a hash of the email as typed,
    so an unknown email behaves exactly like a real one and the limit reveals nothing about
    which accounts exist. Redis never holds the addresses themselves. A successful login
    resets the count, so earlier typos don't punish the real user.
  - **Per IP:** 30 login attempts per 15 minutes (one machine trying many accounts), and 5
    registrations per hour.
  - The limits are enforced in the controller, not a guard, because only the handler knows
    whether an attempt *failed*.
  - Refusals are **429** with a `Retry-After` header and "try again in N minutes".
  - **Algorithm:** a fixed-window counter: `INCR` plus `PEXPIRE` in one Lua script, which
    is one round trip and atomic. As two separate commands, a crash in between could leave
    a counter with no expiry, a permanent lockout. A fixed window allows up to twice the
    limit across a window boundary, which is fine for slowing guessing and far simpler
    than a sliding log.
  - **Fails open:** if Redis doesn't answer within 1s, the request is allowed and a warning
    logged. Redis isn't the store of record, an outage shouldn't lock everyone out, and
    bcrypt's ~250ms per attempt still slows guessing meanwhile.
  - **Client IP behind proxies:** `TRUST_PROXY_HOPS` (default 0) sets Express's `trust
    proxy`. It **must** match the number of proxies in production. Too low and every user
    shares the proxy's IP, so one limit applies to everyone. Too high and a client can
    spoof its IP with its own `X-Forwarded-For`.
  - The limits are code constants (`DEFAULT_AUTH_RATE_RULES`), changed by review. Tests
    inject their own via `AUTH_RATE_RULES`: the e2e helper lifts them, and
    `rate-limit.e2e-spec.ts` checks real behaviour with low limits.

### 8.2 The refresh cookie

The refresh token is never in a response body — only in an httpOnly cookie:
`shortlist_refresh; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Secure (production);
Max-Age = 30 days`.
- *HttpOnly:* page scripts can't read it, so an XSS bug can't steal a 30-day credential.
- *SameSite=Strict:* the browser never sends it on requests started by another site —
  the CSRF defence for `/refresh` and `/logout`. This is why web and API must share a
  site ([§4](architecture.md)).
- *Path=/api/v1/auth:* sent only to auth endpoints.
- A failed refresh clears the cookie; logout clears it and is idempotent; a token sent in
  a request body is ignored.
- **CORS:** credentials allowed only for the exact origins in `WEB_ORIGINS` (validated at
  boot as bare origins — never `*`).

### 8.3 The web app's token handling

- The **access token lives in a JavaScript module variable only** — never
  `localStorage`/`sessionStorage`, which any script on the page can read. On reload it's
  gone and is restored by a refresh using the cookie.
- **Refreshes can't race.** Two refreshes with the same cookie would look like token
  theft to the API and revoke every session. Causes: React StrictMode's double mount,
  several requests getting 401 at once, two tabs opening together. Two guards in
  `refreshSession()`: (1) single-flight within a tab (concurrent callers share one
  promise); (2) a **Web Lock** (`navigator.locks`, `shortlist-refresh`) across tabs — a
  waiting tab runs only after the browser has stored the rotated cookie. Never call
  `/auth/refresh` directly.
- A 401 from a non-auth endpoint triggers one refresh and one retry; if refresh fails, the
  UI signs out. A 401 from `/auth/login` means wrong password and doesn't trigger refresh.

### 8.5 Other security decisions

- **PWA service worker:** precaches the app shell only; `/api` is excluded from the
  navigation fallback and there is no runtime caching, so one user's data is never served
  from cache. Sign-out also clears the query cache.
- **Project URLs** must be http(s) — a bare `z.url()` accepts `javascript:` URLs, which
  would be an XSS hole once rendered as a link.
- **Outbound requests** identify themselves honestly (`ShortlistBot/0.1 …`), time out
  after 20 seconds, and never impersonate a browser.
- **Gmail access** is read-only and limited by the code to one label ([§10.3](email-alerts.md)).

### 8.7 Email verification and password reset (built 2026-10-14)

Asked for from production: sign-up had no email verification, and there was no "forgot
password". Sign-ups are open to anyone with the URL, so verification matters: it stops an
account being made with someone else's address.
- **Sending:** any SMTP server (decided 2026-10-14 — self-hosters pick their own: a Gmail app
  password, Brevo, Mailgun, Zoho), from the **worker** over Nodemailer, on the `mail` queue.
  SMTP with TLS, AUTH and MIME is a library's job; the parts below are ours. Env:
  `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` (all or none; `SMTP_PORT` 587 =
  STARTTLS required, 465 = TLS) on the worker, `SMTP_HOST` on the API too.
- **No SMTP configured:** new accounts start verified (no email could reach them) and
  `POST /auth/forgot-password` is a 503; `GET /auth/options` tells the app, which then hides
  "Forgot password?". E2E tests run this way by default.
- **Tokens** (`AuthToken`): 32 random bytes, base64url, made **in the worker** — the API only
  queues "send VERIFY_EMAIL/RESET_PASSWORD to user X", so the plain token exists nowhere but
  the email (not Redis, not Postgres). Stored as SHA-256 (high-entropy input: no dictionary
  to attack, and a deterministic hash is findable by a unique index — same reasoning as
  refresh tokens, §8.1). Single use via a compare-and-swap on `usedAt`; 24 h to verify, 1 h
  to reset; a new email deletes the user's earlier unused links of that kind. The pages
  read the token once, drop it from the address bar, and POST it.
- **Enforcement on the server:** `User.emailVerifiedAt`; the access token carries `ev`
  (verified), so the global guard refuses an unverified account with **403
  `EMAIL_UNVERIFIED`** without a database read per request — except routes marked
  `@AllowUnverified()` (`GET /auth/me`, `POST /auth/resend-verification`) and the public ones.
  After verifying, the app refreshes its session to get a token with `ev: true`. Tokens
  without the claim (issued before it existed) count as verified; the migration backfilled
  every existing account as verified, so nobody was locked out.
- **Forgot password** (`POST /auth/forgot-password`) answers 202 "sent" whether or not the
  address has an account, and a queue failure is logged, not returned — either would reveal
  which emails are registered. Rate-limited per IP and per address as typed (hashed, like
  login), so the limit can't reveal it either.
- **Reset** (`POST /auth/reset-password`) sets the new password, **revokes every session**
  (a reset is often "someone else got in"), deletes other unused reset links, and verifies
  the address (it proves inbox control). Verify and reset attempts are rate-limited per IP.
- **Web:** signed in but unverified → a "Check your inbox" screen instead of the app
  (Resend, "I've confirmed it", Sign out); pages `/verify-email`, `/forgot-password`,
  `/reset-password` work signed in or out (links open on phones).

