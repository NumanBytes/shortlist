# Email job alerts

Reading job-alert emails from Gmail (read-only) and turning them into jobs.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 10. Email job alerts (built 2026-10-03)

### 10.1 What and why

LinkedIn and Rozee.pk are the two biggest sources for the Lahore market; with Indeed,
Glassdoor, Taraki, Wellfound and remote.co they all forbid scraping or have no API.
Their **job-alert emails** are the legitimate way in. Ordered *after* AI scoring ([§17](roadmap.md)):
LinkedIn/Rozee alerts are high-volume, and without scoring they would flood the New tab
unranked.

### 10.2 The user's personal Gmail (decided 2026-10-02)

The user is registered on every portal with their personal Gmail and will **not** create
a separate inbox. That makes setup simpler (alerts already arrive; nothing to forward),
and it means Shortlist touches the same mailbox as the user's bank, family and work
email — so access is designed to be as narrow as Gmail allows.

### 10.3 Access design

- **Gmail API with OAuth, read-only scope (`gmail.readonly`)** — not an IMAP app password.
  An app password grants full mailbox control (send, delete); the OAuth grant can only
  read and can be revoked anytime from the Google account.
- **A Gmail filter applies a `Shortlist` label** to mail from the alert senders (LinkedIn,
  Indeed, Glassdoor, Taraki, Wellfound, remote.co, Rozee.pk). **The worker only ever
  queries that label.** Other email is never read, processed or stored.
- **Honest limit:** Gmail has no per-label permission — the read-only grant could read
  the whole mailbox; it is the code that confines itself to the label. Hence: read-only
  scope, token stored encrypted, the token never leaves the worker.
- **Shortlist never sends email** from the account.
- **Built 2026-10-03 — how the connection works** (`apps/api/src/gmail/`,
  `packages/shared/src/node/google.ts`), hand-rolled with `fetch`, no googleapis SDK:
  - **Authorization-code flow with PKCE.** "Connect Gmail" asks the API for Google's
    consent URL (scope `gmail.readonly` only; `access_type=offline`, `prompt=consent` so a
    refresh token always comes back). The browser goes to Google and back to
    `GET /api/v1/gmail/callback`. The code is useless without the PKCE verifier, which
    never leaves the server.
  - **Who is this redirect for?** A redirect carries no bearer token (it lives in memory
    in the tab), so the attempt is identified by a random single-use **state** (stored
    hashed, 10-minute life, consumed with a conditional delete so two racing callbacks
    can't both use it) — and bound to the **browser** by an httpOnly nonce cookie
    (`shortlist_oauth`, Path=/api/v1/gmail/callback, SameSite=**Lax**: Strict would not be
    sent on Google's cross-site redirect). Without the cookie check, an attacker could send
    someone their own consent link and attach the victim's mailbox to the attacker's
    account (OAuth login CSRF); a test covers exactly that.
  - **Scope check:** Google lets the user untick a scope; the callback refuses a grant
    without read access.
  - **Token at rest:** only the refresh token is stored, encrypted with AES-256-GCM
    (`SecretBox`, key `TOKEN_ENCRYPTION_KEY`), with the user's id as additional
    authenticated data so a ciphertext copied to another row won't decrypt; the full
    16-byte authentication tag is required (Node otherwise accepts a truncated one, which
    is easier to forge). Access tokens
    are minted per check and never stored. The status endpoint never returns the token.
  - **Disconnect** revokes the grant at Google, then deletes the row.
  - **Health is visible:** each check records status (SUCCESS / EMPTY / FAILED), time,
    count and error on the connection; a revoked grant (`invalid_grant`) or an
    undecryptable token sets `NEEDS_RECONNECT` and the Sources page asks to reconnect; a
    missing label fails visibly without retries.
- **Google setup gotcha:** while the OAuth consent screen is in "Testing" status, refresh
  tokens expire after 7 days. Set the app to "In production" for personal use; the user
  sees an "unverified app" warning once (expected for a personal tool). Selling the
  product later would require Google's verification for this restricted scope ([§1.4](../Agents.md)).

### 10.4 Processing

- **Built 2026-10-03:** a worker check (every two hours, `GMAIL_CHECK_CRON`, plus "Check
  now") lists messages under the label only — the last 30 days on the first check, then
  everything after the previous check minus a two-day overlap (Gmail's `after:` is
  day-granular) — and records each new message in `EmailMessage` (sender, received time,
  status) so it is **never read twice**. Bodies are not stored. Own queue (`email`),
  deduplicated per mailbox.
- **Parsers come from real emails, not guesses.** Until a portal has a parser, its mail is
  `UNPARSED`, and the Sources page lists those senders with counts — that list decides
  which portal to support first. `pnpm --filter @shortlist/worker capture:emails <you>`
  saves recent labelled mail as `.eml` under `apps/worker/test/fixtures/email/.private/`,
  which is **git-ignored** (it holds the user's name, address and tracking links).
  Committed parser fixtures must be scrubbed copies.
- **How an email becomes jobs (built 2026-10-03; decided with the user): code parsers
  where volume justifies them, the model for everything else, code checks on both.**
  1. The worker fetches each new message (`format=raw`), decodes it in memory with a
     hand-rolled MIME reader (`email/mime.ts`: nested multipart, quoted-printable,
     base64, charsets, RFC 2047 headers) into plain text plus a de-duplicated link list.
     Nothing is stored but the outcome.
  2. Obvious non-alerts are skipped by subject without a model call ("your application
     was sent", "verify your email"…).
  3. **Code parser** if the sender has one — today Indeed (`parsers/indeed.ts`), written
     against real captured alerts. Free and exact. It reads the daily alerts *and* the
     "your job alert is now active" confirmations (they list jobs too); with Indeed's job
     key it stores a clean `pk.indeed.com/viewjob?jk=…` link, otherwise the portal's own
     link. Salary, the one-line summary and "posted N days ago" come along.
  4. **Model fallback (Haiku)** for every sender without a parser — so a new portal works
     the day its first email arrives, with no code. The model sees the email text and the
     links as short refs (`L3`); it returns jobs (title, company, location, work mode,
     salary, link ref) or "not a job email". **Code then keeps a job only if its title and
     company appear in the email word for word** (case and punctuation aside) **and its
     link ref exists** — an invented job or URL can't get through. Every call is budget-
     guarded (monthly cap), logged to `AiUsage` as `EXTRACT_EMAIL` before its output is
     used; over budget or without a key the message is **DEFERRED and read again on the
     next check by id** (never dropped); invalid output → FAILED.
  5. **Self-healing:** if a code parser finds no jobs in what should be an alert (or
     throws), the model reads it instead and the message records a note and
     `parserFailed = true`; the Sources page counts those flags and shows "<portal>'s email
     layout may have changed — read by AI for now". A redesign is a visible warning, not
     silently missing jobs. (A flag since 2026-10-11 — the count used to match the word
     "parser" in the free-text note, which a reworded note would have silently broken.)
  6. Each portal's jobs are recorded as a `DiscoveryRun` against its `EMAIL_INBOX` source
     (`email_alerts:<portal>` — the seeded LinkedIn/Rozee.pk/Wellfound/remote.co rows,
     created on first use for others). Email sources are never run by the nightly
     fan-out or "Run now", and are shown on the Gmail card, not the board list.
  7. Same stage-A filter as boards (posting age not enforced: an alert is new by
     definition), then the **summary stage** ([§9.6](discovery.md), `roleTitleTerms`), the same dedupe,
     shared `storeJobs()`; new jobs are queued for scoring.
- **Which senders get a code parser:** decided by data, not guesses — a sender with
  several emails a day and a stable layout. One sender at one email a day through the
  model costs ≈ $0.09/month, less than maintaining a parser. Plan: Indeed (built),
  LinkedIn next once its alert format is confirmed, the rest through the model.
  Recommendation emails (Wellfound, Arc.dev, Welcome to the Jungle) change layout most and
  stay on the model.
- **Cost:** an alert is ≈ 1–2k tokens as text ≈ $0.003 per model-read email; with
  Indeed in code, well under a dollar a month.
- **Fixtures:** `scrub:email` turns a captured email into a committable fixture — the
  user's name and address replaced, every link stripped to host + path (keeping only
  public job ids like Indeed's `jk`), click-tracking paths and long IDs redacted, routing
  headers dropped. The Indeed fixtures were checked for leftover personal data and IDs.
- **First real check (2026-10-03):** 13 labelled emails → 11 alerts (10 Indeed by code, 1
  LinkedIn by the model — one call), 2 skipped (a confirmation with no jobs, a LinkedIn
  application receipt), 21 new jobs — of which 8 were electrical/mechanical/telecom roles
  that stage A alone let through. That run is why the summary stage exists; the 8 (none
  acted on) were removed.

### 10.5 Partial information and "paste once" (built 2026-10-03)

Alert emails carry title, company, location, sometimes salary and a one-line summary —
not the description — and fetching the page behind the link would be scraping. So:
- Such jobs are stored with **`isPartial = true`**, the summary as their text ("From the
  Indeed alert: …") and the **salary** text (new `Job.salary`, shown on the card). They
  are **scored roughly**: the analysis prompt says only a summary is available and to
  list only requirements it states or the title names directly. The card says "From
  alert"; the job page explains the score is rough.
- **Repeated alerts collapse into one job** by dedupe hash — the user never pastes twice.
- **"Paste full description"** (`POST /jobs/:id/description`, 200–50,000 chars) appears
  on the job page **once the job is Interested** — only tailoring needs it, and most
  alerts are skipped. It replaces the summary, clears `isPartial`, and queues the job
  for scoring again (≈ $0.006). Allowed only on partial jobs (409 otherwise).
- **Tailoring waits for it:** a resume tailored to a two-line summary would be tailored to
  a guess, so `canTailor` is false (and the API refuses with 409) until the description
  is pasted; the Resume card says so.
- **Often no paste is needed:** if the same job (company + title) turns up on a watched
  board or aggregator with a description, `storeJobs()` fills it in, clears `isPartial`
  and queues the job for scoring again. Its first link (where it was found) is kept.

### 10.6 Setting up Google (one-time, by the user)

Shortlist can't do this part: it needs the user's own Google Cloud project.

1. At console.cloud.google.com, create a project (e.g. "Shortlist") and enable the
   **Gmail API** (APIs & Services → Library).
2. Configure the **OAuth consent screen** (Google Auth Platform): External, app name,
   support email; under Data Access add the scope `…/auth/gmail.readonly`; add your own
   address as a test user.
3. **Publish the app ("In production")** so refresh tokens don't expire after 7 days
   (§10.3). Google then shows an "unverified app" warning when connecting — expected for a
   personal tool. If Google won't allow publishing, it still works in Testing, but needs a
   reconnect every 7 days (the Sources page will say so).
4. Create an **OAuth client → Web application** with the authorized redirect URI
   `http://localhost:5173/api/v1/gmail/callback` (in production, the deployed web URL +
   `/api/v1/gmail/callback`).
5. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and
   `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) in `apps/api/.env`, and the same
   client id, secret and key in `apps/worker/.env`. They are all-or-none: a partial set
   refuses to start.
6. In Gmail, create a filter per portal that applies the label **Shortlist** to its alert
   emails (the Sources page shows the steps), then **Connect Gmail** on the Sources page.
