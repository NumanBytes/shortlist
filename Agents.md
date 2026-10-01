# Shortlist — Complete Project Documentation

This document is the complete record of the Shortlist project: what it is, why it exists,
every design decision (with the reasoning and the alternatives that were rejected), how
each part works, how the product behaves in real-world situations, and what is built
versus planned. It exists so an AI assistant or a new contributor can pick up the
codebase and continue correctly without re-deriving decisions that were already argued
through.

**Rules for using this document**

- Read it before generating code. Where it states a rule, follow it even if a more
  "standard" pattern would normally apply — the rules encode specific, hard-learned
  constraints (several of them from real incidents, recorded in §1.3), not style.
- **Every design decision must be recorded here** — in the relevant section *and* in the
  decision log (§16) — in the same change that makes it. Decisions that live only in a
  chat or a PR description are lost.
- For exact data shapes, trust the code (`packages/db/prisma/schema.prisma`,
  `packages/shared/src/*.schema.ts`) over any copy here. This document explains *why*.

## Contents

1. Why this exists — problem, philosophy, incidents, success criteria
2. Product scope
3. Real-world scenarios — how Shortlist behaves
4. Runtime architecture
5. Data model
6. Truthfulness rules (non-negotiable)
7. The career database (seed reference)
8. Authentication and security
9. Job discovery
10. Email job alerts (planned)
11. Manual job intake — "Add a job" (planned)
12. AI pipeline — extraction and match scoring (planned)
13. Resume tailoring, the resume library, and the application kit (planned)
14. Technology decisions
15. Development workflow and conventions
16. Decision log
17. Build state and roadmap
18. Working agreements

---

## 1. Why this exists

### 1.1 The problem

The builder, Numan, is a frontend developer (~2 years) at CloudCard Inc. in Lahore,
Pakistan, job-hunting alongside his current role. The manual grind is the problem:
tracking applications in memory, tailoring resumes by hand for every posting, no
visibility into what is working. Every existing productivity tool for this gets
abandoned, because the cost of *not* using it is zero.

### 1.2 The product philosophy: the human clicks submit

**Shortlist is not "an AI that applies to jobs for you."** It does the tedious 80% —
discovery, job-description parsing, match scoring, resume tailoring, outreach drafts —
and hands the person a ready-to-submit application. **The human always makes the final
click.** This is a deliberate scope decision, not a limitation:

- LinkedIn's and Indeed's Terms of Service explicitly ban automated applying; bot
  detection risks account suspension.
- Recruiters can recognise bot-written applications and messages.
- Most importantly, every claim that leaves the system must have been seen and approved
  by the person it describes (see the Azure incident below).

Full automation was considered and explicitly rejected. Consequences that run through
the whole design: Shortlist never clicks Apply, never uploads a file to a third-party
site, never sends an email or message, and never fills a form. It prepares; the user
submits; the user tells Shortlist they did ("I applied").

### 1.3 Incidents that shaped the design

These are real events. Each one produced a rule that the code enforces.

**The Azure B2C incident — the single most important fact in this document.**
While manually tailoring a resume for a real application (MERN Stack Engineer @ Devsorb,
Lahore), an AI assistant inserted **"Azure B2C"** as a claimed skill, pulled from a
stale, unverified note. Numan has never worked with Azure — CloudCard's B2C layer is an
in-house **Ruby** service. The false claim went out on a real, submitted application.
→ This is why `SkillEvidence.isVerified` exists and defaults to `false`, why no
generation code may read unverified evidence, why every resume bullet must trace to the
user's own words, and why any edit that changes what a claim says un-verifies it (§6).

**The silent single-source search.** A job search that relied on one source silently
returned nothing, and the result was read as "the job doesn't exist" — when in fact the
search tool itself had failed. → Every discovery run is recorded as a `DiscoveryRun` row
opened in `RUNNING` state *before* fetching, and an empty or failed source is always
shown as such, never folded into "no jobs today" (§9.5).

**The posting-age filter that hid open jobs (2026-10-01, first live discovery run).**
A 30-day posting-age rule dropped all 10 of Septem Systems' postings — including a
*Full Stack Software Engineer (MERN)* role in Lahore — and 99 of Motive's 160. On a
company's own job board, a listed job *is* open; long-running openings keep their
original publish date. → Posting age is enforced on aggregator sources only (§9.6).

**The shadow-database reset (2026-09-30, development).** While checking a migration,
the dev database was passed to Prisma as `--shadow-database-url`; Prisma resets shadow
databases, so the dev database was wiped (it happened to be empty). → Never point a
shadow URL, `migrate diff` with a shadow, or `migrate reset` at the dev database; generate
migration SQL by diffing the live schema read-only (§15.4).

### 1.4 Success criteria (stated by the builder)

- Output quality must match or beat what he would write himself by hand.
- ~60–70% reduction in per-application manual effort.
- Mobile-first: a push notification saying "resume ready — just review and submit."
- Architected as a real multi-user product (proper auth, no shortcuts), even though only
  he uses it for now. It may be sold later — this affects naming/trademark caution and
  some third-party setup (e.g. Google OAuth verification, §10.3), not architecture.

---

## 2. Product scope

**Name:** Shortlist. The double meaning is deliberate: it gives you a shortlist of jobs
every morning, and its purpose is getting *you* shortlisted. Target domain:
`getshortlist.com` (or a `get-`/`use-` variant; `shortlist.com` is taken). Repo and
codebase name: `shortlist`. Package scope: `@shortlist/*`. Product-facing names are
English only (Urdu-derived names, e.g. "Manzil", were considered and rejected for this
product; Manzil is the name of a separate side project).

**One-liner:** Finds jobs worth your time, tailors a truthful resume for each, and
notifies you. You make the final click.

### In scope

- Multi-source job discovery: public company job-board APIs, remote-job aggregators,
  job-alert emails from the user's own inbox, hosted ATS pages, custom careers sites,
  and manual entry (§9–§11).
- Job-description parsing into structured requirements (§12).
- Match scoring against the verified career database, with gaps (§12).
- Resume tailoring rendered into the user's own CV layout, plus a reusable resume
  library (§13).
- An application kit per job: tailored PDF, drafted email for "send your CV to"
  postings, drafted answers to screening questions, outreach drafts (§13.5).
- Push notification when a resume is ready (§13.6).
- Application pipeline tracking (New → Interested → Applied → … → Offer/Rejected).
- Delivery as an installable PWA (not a native app).

### Explicitly out of scope

- Any automatic submission: no auto-apply, no Easy Apply automation, no form filling, no
  sending email on the user's behalf.
- Scraping LinkedIn, Indeed, Glassdoor, Wellfound or remote.co pages (ToS). Their jobs
  arrive through the user's job-alert emails instead (§10).
- Reading a LinkedIn feed (no API; scraping forbidden). Feed posts come in through
  manual "Add a job" (§11).

---

## 3. Real-world scenarios — how Shortlist behaves

The principle behind every answer: **Shortlist prepares, the user submits** (§1.2).
Every automated flow ends the same way — a notification "Resume ready for X", the user
reviews it in the app, applies on the original site, and taps "I applied."

**3.1 A LinkedIn feed post by an HR person, with an email or an application link.**
Shortlist can't see the LinkedIn feed (no API, scraping is forbidden, and feed posts
don't trigger alert emails). The user brings it in with **Add a job** (§11) — paste the
text, or on Android share the post straight into Shortlist.
- If the post links to a supported job platform (e.g. a Workable link), Shortlist fetches
  the full job description from that platform's public API.
- If the post says "send your CV to hr@…", Shortlist produces the tailored PDF **and a
  drafted email** (subject, short body, PDF attached). One tap opens it in the user's own
  mail app; the user presses Send. Shortlist never sends it.

**3.2 LinkedIn jobs: "Easy Apply" versus "Apply" (company site).**
These arrive as LinkedIn job-alert emails (§10), which usually carry title, company,
location and a link — not the full description — so the job is marked **partial info**.
- *External "Apply":* if the same job is also on the company's own board (watched by
  Shortlist), the full description is filled in automatically from there (§10.5).
- *Easy Apply:* automating it is exactly what LinkedIn bans, so Shortlist never touches
  it. It provides the **application kit**: the tailored PDF plus drafted answers to
  common screening questions (e.g. "Years of React experience?" — computed from verified
  role dates). The user clicks Easy Apply, uploads the PDF, pastes answers, submits.

**3.3 A relevant job on Indeed, Glassdoor, Taraki or a similar portal.**
Their alert emails land in the user's Gmail and are picked up from the `Shortlist`
label (§10). Shortlist will not fetch the portal page behind the link (scraping). The
job gets a rough score from the alert alone; if the user marks it **Interested**, a
**"Paste full description"** action lets them copy the description in once (~10
seconds), which unlocks a full score and tailoring. The user uploads the resume on the
portal themselves.

**3.4 A job on a company's own website.**
For companies on a supported platform (Greenhouse, Lever, SmartRecruiters, Workable
today; hosted ATS pages and custom sites later — §9.2), this is fully automatic:
discovered nightly → requirements extracted → scored against verified evidence → if the
score clears the threshold, a resume is tailored (or reused from the library, §13.2) in
the user's CV layout, every bullet linked to the evidence behind it → PDF rendered →
**push notification** "Resume ready: Full Stack Engineer @ Kwanso — review and submit."
In the app the user sees the resume, the evidence behind each bullet, and the gaps;
approves; downloads; applies on the company site; taps **I applied**. Shortlist never
submits.

**3.5 The same job arrives from several places** (LinkedIn alert + company board +
Rozee). Deduplicated into one job by a hash of normalized company + title (§9.7). The
richest description wins; later, the card shows where else it was seen.

**3.6 Many alerts for the same job.** Repeated alerts collapse into the same job (same
hash) — the description is pasted at most once per job, and only for jobs the user
marks Interested (§10.5).

**3.7 The job needs a skill the user doesn't have** (e.g. AWS). Shown as a gap, rated
blocking or learnable. Tailoring **never** adds it to the resume. An outreach draft may
honestly say the user is learning it. This is the Azure safeguard in action.

**3.8 Screening questions or a cover letter are required.** Drafted from verified
evidence only; any "years of experience" figure is computed from verified role dates,
never estimated.

**3.9 The posting has closed.** Every run updates `Job.lastSeenAt`; a job no longer
listed is marked "possibly closed" and is not tailored (no AI spend on dead postings).

**3.10 A reposted job the user already applied to.** Deduplication matches it; the card
shows "You applied on <date>."

**3.11 A scam posting** (asks for a fee, recruiter only on WhatsApp/Telegram, unrealistic
salary, "HR" using a personal Gmail). The AI extraction step looks for these red flags
and marks the job *suspected scam*. Especially relevant to WhatsApp-sourced jobs.

**3.12 A recruiter messages the user directly with a description.** Add a job (§11):
paste it → scored → resume tailored → reply drafted.

**3.13 Several roles at one company.** Grouped by company so the user picks the best fit
rather than applying to all (recruiters notice mass-applying).

**3.14 Applied a week ago, no response.** A follow-up reminder with a drafted, polite
follow-up message.

**3.15 Rejection or interview emails arrive in the same inbox.** Later: since Shortlist
reads the user's alert label, it could *suggest* status changes ("Looks like Kwanso
replied — mark Interviewing?"). It suggests; it never changes status on its own.

**3.16 Applying from the phone.** The tailored PDF downloads to the phone's files, ready
to upload (the LinkedIn app's Easy Apply accepts uploads).

**3.17 A job posted in a WhatsApp group.** Add a job (§11); on Android, long-press the
message → Share → Shortlist. Scam heuristics apply (3.11).

**3.18 A job description close to one already applied for** (different title, same
requirements). The resume library reuses the existing, already-reviewed resume at zero
AI cost instead of generating a new one (§13.2).

---

## 4. Runtime architecture

Three processes, two stores. The split is deliberate — do not collapse the worker into
the API.

```
apps/web         React + Vite PWA — the only thing that talks to the browser
apps/api         NestJS HTTP API — auth, CRUD, owns identity; only ENQUEUES work
apps/worker      NestJS, no HTTP server — consumes the queue, runs discovery (and later AI)
packages/shared  Zod schemas, inferred types, shared constants — imported by all three
packages/db      Prisma schema, migrations, re-exported client, seed scripts
```

```
Browser (PWA) ──HTTPS + Bearer access token / httpOnly refresh cookie──► NestJS API
                                                                          │      │
                                                     PostgreSQL ◄─────────┘      │ enqueue
                                                   (source of truth)              ▼
                                                          ▲                 Redis (queue only)
                                                          │                       │ consume
BullMQ job scheduler (in Redis) ──02:00 Asia/Karachi──────┼──────────────► Worker process
                                                          │          ┌────────────┼────────────┐
                                                          └──────────┤            │            │
                                                                Job sources   Claude API   Web Push
                                                          (APIs, feeds, Gmail)  (later)     (later)
```

**Why the worker is a separate process.** A job source can hang; a Claude call can take
15–20 seconds; a nightly run processes over a thousand postings. None of that may
compete with the API's event loop for requests a real user is making right now. The
queue (Redis + BullMQ) buys this isolation, plus retries with backoff.

**Why the API only enqueues.** The API never runs discovery or AI work itself; it adds a
job to the queue and returns `202 Accepted`. The worker does the work.

**Why Redis holds nothing important.** It is a queue (and later rate-limit counters)
only. Everything that matters is in Postgres. Losing Redis loses, at worst, queued work
that the next nightly run redoes.

**Secret boundaries.** The Claude API key and the Gmail access token live only in the
worker's environment/database access path. The browser never sees them; the API never
needs the Claude key. A compromised frontend cannot spend money or read mail.

**Deployment target** (not yet done): Vercel (web) + Render/Railway (API and worker) +
Neon (Postgres) + Upstash (Redis, `rediss://`). The worker needs an always-on host
because the scheduler can't run on a host that sleeps. **Web and API must share a site**
— e.g. `app.getshortlist.com` + `api.getshortlist.com`, or a Vercel rewrite of `/api` to
the API — because the refresh cookie is `SameSite=Strict` (§8.2). `*.vercel.app` →
`*.onrender.com` is cross-site and would break sign-in.

---

## 5. Data model

The source of truth is `packages/db/prisma/schema.prisma`. This section explains the
design decisions it encodes.

### 5.1 Two halves that meet at one table

```
TRUTH (slow-moving, hand-curated)            JOBS (fast-moving, machine-generated)
─────────────────────────────────            ─────────────────────────────────────
User ──< WorkExperience                      User ──< JobSource ──< DiscoveryRun
User ──< Project                             JobSource ──< Job >── DiscoveryRun (first found by)
User ──< Skill ──< SkillEvidence             Job ──< JobRequirement
     (evidence links to at most one          User ──1 DiscoveryPreferences
      WorkExperience OR Project)

                      the halves meet only at:
                 Job ──1 JobMatch ──< SkillGap
                 (resume variants & applications: §13.4)
```

`JobMatch` is the only join between truth and jobs. Scoring logic lives in one place:
re-scoring the whole job history after one skill changes never requires re-reading a
job description.

### 5.2 Decisions, table by table

- **`User`** — `email` unique and stored lowercase (normalized by the Zod schema, so
  "Numan@X.com" and "numan@x.com" can't be two accounts).
- **`RefreshToken`** — stores only the SHA-256 hash of each refresh token, with
  `expiresAt` and `revokedAt`, so sessions can be revoked and a database leak doesn't
  leak usable tokens (§8.1).
- **`WorkExperience`, `Project`** — what evidence is anchored to. Their claim-bearing
  fields un-verify linked evidence when changed (§6.3).
- **`Skill`** — unique per `(userId, lower(name))`: "React" and "react" collide. Prisma's
  `@@unique([userId, name])` is case-sensitive, so a hand-written SQL migration adds
  the case-insensitive unique index `Skill_userId_lower_name_key`. Aliases ("React" vs
  "React.js") are *not* caught — that needs a canonical-name mapping, not an index.
- **`SkillEvidence` — the core table.** One skill can carry several truths at once (e.g.
  PostgreSQL: COMMERCIAL/PRODUCTION at work *and* PERSONAL/WORKING on a side project).
  - `context`: COMMERCIAL (paid work) | PERSONAL (side projects, self-learning) |
    ACADEMIC (coursework).
  - `depth`: PRODUCTION (built and shipped) | WORKING (can build independently, not
    shipped commercially) | MAINTENANCE (upgraded/fixed/operated, did not build) |
    EXPOSURE (tutorials, coursework, small experiments).
  - `whatIDid`: the user's own words — the **only** source a resume bullet may be
    derived from.
  - `lastUsed`: drives the staleness rule; can't be in the future.
  - `isVerified` (default `false`) + `verifiedAt` — the Azure safeguard (§6).
  - Links to at most one origin: `workExperienceId` **or** `projectId`. Prisma can't
    express "not both", so a hand-written `CHECK` constraint
    (`chk_evidence_single_source`) enforces it in the database, and the Zod schema and
    the service (checking the merged stored + incoming values on update) enforce it too.
- **`JobSource`** — one row per thing Shortlist watches. `key` is a stable identity
  (e.g. `greenhouse:gomotive`, unique per user) that seeding matches on; `name` is for
  display; `type` is ATS_BOARD | AGGREGATOR_API | EMAIL_INBOX | MANUAL; `config` (JSON)
  is validated by `JobSourceConfigSchema` in shared; `isEnabled` toggles it — **turning a
  source on or off is a data change, never a code change**; `lastRunAt`/`lastRunStatus`
  give at-a-glance health.
- **`DiscoveryRun`** — one row per fetch attempt: `status` (RUNNING | SUCCESS | EMPTY |
  FAILED), `jobsFound` (everything returned), `jobsMatched` (passed the rule filter),
  `jobsNew` (matched and not seen before), `errorMessage`. Opened as RUNNING **before**
  fetching (§1.3, §9.5). Indexed by `(jobSourceId, startedAt)`.
- **`Job`** — a discovered posting: title, company, location, `workMode`, `source`
  (provider, shown as attribution), `sourceUrl` (the original posting; "Open posting"
  always goes here), `rawJD` (plain-text description), `dedupeHash` (unique per user),
  `jobSourceId` and `discoveryRunId` (the run that first found it; both SET NULL on
  delete), `status` (DISCOVERED → INTERESTED | SKIPPED → APPLIED → ASSESSMENT →
  INTERVIEWING → OFFER | REJECTED | WITHDRAWN), `postedAt`, `discoveredAt`, `lastSeenAt`
  (bumped by every run that still lists it — powers "possibly closed"), `appliedAt`
  (set when the user says they applied).
- **`DiscoveryPreferences`** — one row per user holding the rule filter's settings
  (§9.6). Data, not code: tuning what gets through is an update, never a redeploy. A user
  without a row gets `DEFAULT_DISCOVERY_PREFERENCES` from shared.
- **`JobRequirement`, `JobMatch`, `SkillGap`** — exist in the schema; filled by the AI
  step (§12). `JobMatch.verdict` is APPLY | STRETCH | SKIP.
- **`TailoredResume`** — currently one per `JobMatch`. **Decided to change** into
  reusable resume variants plus an application record (§13.4); the migration happens
  when tailoring is built.

### 5.3 Constraints Prisma can't express

They live in hand-written SQL migrations, created with `prisma migrate dev --create-only`
and then edited: `chk_evidence_single_source` and `Skill_userId_lower_name_key`. Keep
them if migrations are ever regenerated — Prisma ignores both when diffing, so it will
neither recreate nor drop them.

---

## 6. Truthfulness rules (non-negotiable)

This is domain logic, not a suggestion. Any code that generates resume content must obey
these rules exactly.

### 6.1 Placement rules — where evidence may appear on a resume

| Context + Depth | Where it may appear |
|---|---|
| COMMERCIAL + PRODUCTION | Experience bullets, Skills section, Summary |
| COMMERCIAL + MAINTENANCE | Experience bullets, worded as maintenance (upgraded/fixed, not built) |
| PERSONAL/ACADEMIC + WORKING | Skills and Projects sections only — never an Experience bullet |
| PERSONAL/ACADEMIC + EXPOSURE | Skills section only if `lastUsed` < 2 years ago; otherwise omitted entirely |

**Open decision (must be made before tailoring is built):** the table does not cover
COMMERCIAL + WORKING (e.g. Ruby and Docker at CloudCard), COMMERCIAL + EXPOSURE, or
PERSONAL + PRODUCTION / MAINTENANCE.

### 6.2 Hard rules for every AI generation step

1. Read only `SkillEvidence` rows where `isVerified = true`. Unverified evidence must be
   invisible to any generation prompt.
2. Every generated resume bullet must be traceable to a specific `whatIDid` the user
   wrote (stored as evidence IDs per bullet). Never synthesize a claim the user did not
   author.
3. Never add a skill the job asks for that the verified evidence doesn't support — it
   becomes a gap, never a claim.
4. If "Azure B2C", or Node.js/Express presented as CloudCard experience, appears in any
   generated output, it is a bug (§7.2).

### 6.3 How verification is enforced in code

- `isVerified` is **never** accepted in a request body: create/update schemas don't
  contain it and are `.strict()`, so sending it is a 400, not silently ignored.
- `POST /evidence/:id/verify` is the **only** path that sets it (idempotent; keeps the
  original `verifiedAt`); `POST /evidence/:id/unverify` undoes it. Verification is its
  own endpoint so no request body can ever carry it.
- **Any write that changes what a claim says resets verification** (`UNVERIFIED` in
  `apps/api/src/common/verification.ts`):
  - editing the evidence itself;
  - **renaming its skill** — otherwise evidence verified for "React" would vouch for
    whatever the skill is renamed to, the exact shape of the Azure incident (changing
    only the category keeps verification);
  - editing a claim field of the linked role (company, title, start/end, current) or
    project (name, description, shipped, start/end) — compared by value, so a form
    resubmitting unchanged values doesn't un-verify; cosmetic fields (location, URLs)
    don't count;
  - deleting the linked role/project — the evidence survives (FK is SET NULL) but is
    un-verified, because it was confirmed in that context.
  - **Any new write path must do the same.**
- Ownership: every query is scoped to the caller; another user's resource is a 404,
  never a 403 (a 403 would confirm the ID exists). Evidence ownership goes through its
  skill (`skill: { userId }`).
- Verification in the web UI is never optimistic — "Verified" shows only after the server
  confirms.
- Seed data must pass `findSeedProblems()` (`packages/db/prisma/seed/guards.ts`) and never
  sets `isVerified` (§7).
- Resume variants become **stale** when any evidence they use is edited or un-verified,
  and can't be reused until regenerated (§13.3).

---

## 7. The career database (seed reference)

### 7.1 The data

`packages/db/prisma/seed/career-data.ts` encodes this as data; everything is seeded
**unverified** for the user to review, reword and verify.

**COMMERCIAL — CloudCard Inc., Lahore (May 2024–present, hired as Frontend Developer):**
HTML5, CSS, Tailwind CSS, JavaScript, TypeScript, React, Material UI, Ant Design (all
PRODUCTION); React and Angular version upgrades across apps (MAINTENANCE, not primary
development); Ruby, a little (WORKING); PostgreSQL / SQL — migrations, new tables and
columns (PRODUCTION); role-based access control via DB configuration (PRODUCTION); full
understanding of the in-house Ruby B2C layer between the frontend and a core Java
backend (PRODUCTION — seeded under the placeholder skill name "API integration", to be
renamed by the user); SonarQube error remediation (PRODUCTION); Docker, Docker Compose,
microservices — real but consumed/worked-within rather than owned (WORKING).

**PERSONAL / SELF-TAUGHT:** MERN (MongoDB, Express.js, Node.js) — small learning projects
in 2024, picked back up in 2026 (WORKING, never commercial). Next.js — building the
Manzil side project, not yet shipped (WORKING, linked to the Manzil project).

**ACADEMIC:** Python, Flask, Django, Java, C++, .NET — coursework, last used 2023
(EXPOSURE; already stale under the 2-year rule, kept in the database but never shown).

Dates known only to the year use July 1 of that year. The user supplied the university
and MERN dates (2026-10-01) rather than letting them be guessed.

### 7.2 Known false claims that must never resurface

- **"Azure B2C"** — false. CloudCard's B2C layer is in-house Ruby (§1.3).
- **Node.js / Express.js as CloudCard experience** — false. The only Node/Express
  experience is the self-taught MERN work. Building Shortlist's backend in NestJS is
  meant to turn this into real, verifiable evidence — **which the user must add in their
  own words** once they can explain each part; it is deliberately not seeded.

### 7.3 Seed guards and behaviour

`findSeedProblems()` refuses to write anything if the data mentions Azure (in a skill
name or evidence text), marks Node.js/Express.js/MongoDB as COMMERCIAL, carries
`isVerified`/`verifiedAt`, has commercial evidence without a role, links to an unknown
role/project, links both, duplicates a skill or a context/depth pair, or has a future
`lastUsed`. The seed attaches to an existing account (`SEED_USER_EMAIL`; it never touches
passwords), runs in one transaction, supports `--dry-run`, and is additive: evidence is
skipped if its skill already has evidence with the same context+depth, so rewording an
item never causes the original to be re-added and verifications are never overwritten.
It is deliberately *not* wired into Prisma's automatic seed hook (a `migrate reset` would
run it against a wiped database where the account doesn't exist).

---

## 8. Authentication and security

### 8.1 API authentication (hand-rolled JWT — no Passport)

Deliberately hand-rolled so every mechanism is visible and explainable (§14).

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
- **Secure by default:** a global `AuthGuard` (`APP_GUARD`) protects every route; public
  routes opt out with `@Public()`. Forgetting the decorator leaves a route locked, not
  open.
- **Never return `passwordHash`:** responses use `PUBLIC_USER_SELECT`.
- **Planned:** rate-limit `/auth/login` and `/auth/register` with Redis counters.

### 8.2 The refresh cookie

The refresh token is never in a response body — only in an httpOnly cookie:
`shortlist_refresh; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Secure (production);
Max-Age = 30 days`.
- *HttpOnly:* page scripts can't read it, so an XSS bug can't steal a 30-day credential.
- *SameSite=Strict:* the browser never sends it on requests started by another site —
  the CSRF defence for `/refresh` and `/logout`. This is why web and API must share a
  site (§4).
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

### 8.4 Other security decisions

- **PWA service worker:** precaches the app shell only; `/api` is excluded from the
  navigation fallback and there is no runtime caching, so one user's data is never served
  from cache. Sign-out also clears the query cache.
- **Project URLs** must be http(s) — a bare `z.url()` accepts `javascript:` URLs, which
  would be an XSS hole once rendered as a link.
- **Outbound requests** identify themselves honestly (`ShortlistBot/0.1 …`), time out
  after 20 seconds, and never impersonate a browser.
- **Gmail access** is read-only and limited by the code to one label (§10.3).

---

## 9. Job discovery

### 9.1 Source tiers

1. **Public company job-board APIs** (Greenhouse, Lever, SmartRecruiters, Workable; later
   Ashby, Recruitee, …) — no ToS issue, best description text. The primary tier.
2. **Remote-job aggregators** with public APIs/feeds (Remote OK, Remotive, Arbeitnow,
   Himalayas, Jobicy, We Work Remotely).
3. **Hosted ATS pages** without a public API (JazzHR, Zoho Recruit, OpenCATS-style, …) —
   one HTML parser per *platform*.
4. **Custom careers sites** — a generic change watcher plus AI extraction (§9.10).
5. **Job-alert emails** in the user's Gmail — the legitimate way to cover LinkedIn,
   Indeed, Glassdoor, Taraki, Wellfound, Rozee.pk, remote.co (§10).
6. **Manual "Add a job"** — always available (§11).

### 9.2 Source inventory (probed 2026-10-01 from the user's list of 40 URLs)

Each careers URL was fetched and classified by platform. All of it is recorded as
`JobSource` rows in `packages/db/prisma/seed/job-sources.ts` — 48 sources, 13 enabled.

| Status | Sources |
|---|---|
| **Enabled — public ATS APIs** | Motive (`greenhouse:gomotive`), Careem (Greenhouse), Educative, Kwanso (Lever), Septem Systems (SmartRecruiters), Programmers Force (Workable account `hr-force`) |
| **Enabled — aggregators** | Remote OK, Remotive (software-dev), Arbeitnow, Himalayas, Jobicy, We Work Remotely (Full-Stack, Front-End) |
| **Milestone 2 — hosted ATS pages** | VentureDive, NorthBay (JazzHR); ShopDev, Techlogix, SlashNext, Tintash (Zoho Recruit); Intagleo, i2c (OpenCATS-style); 7Vals (Simplicant); UWorx (WebHR); Cogent Labs (Hirestream); Systemvent (SAP SuccessFactors); Code District (Pinpoint) |
| **Milestone 3 — custom sites** | NetSol, Folio3, Synavos, BrainX, Coeus, Redmath, RipeSeed, Intech, SSI, Cinnova, Rolustech, Xavor, CodingCops, Nextbridge, The Developers Arena |
| **Recorded with a note** | TCM (403 to automated requests), Qbatch (careers page 404), Conrad Labs (domain doesn't resolve) |
| **Email alerts (§10)** | LinkedIn, Wellfound, Rozee.pk, remote.co — plus Indeed, Glassdoor, Taraki from the user's inbox |
| **Not a source** | Turing — a vetting marketplace (apply once, get matched), not a job feed |

Kwanso, first assumed to be a custom site, turned out to use Lever. The user's list is
explicitly "a beginning, not the limit" — more companies and portals will be added.

### 9.3 Adapter architecture — one adapter per platform, not per company

`apps/worker/src/discovery/adapters/` holds one adapter per platform; each turns that
platform's response into a common `Posting` (externalId, title, company, location,
workMode, url, postedAt, description or `loadDescription()`). Adding a *company* on an
existing platform is a `JobSource` row; adding a *platform* is one adapter plus one entry
in `ImplementedSourceConfigSchema` — the `AdapterRegistry` type makes the compiler insist
the two stay in sync. Platforms recorded for later (`PLANNED_PROVIDERS`) validate as
config but have no adapter; running one fails once, clearly, with "No adapter for
provider … yet", and the API refuses to enable it.

Platform notes: Greenhouse (`?content=true`, one request per board, HTML is
entity-encoded); Lever (`?mode=json`, includes `descriptionPlain`); SmartRecruiters (list
without descriptions; one detail request each, only for survivors); Workable (the v3 list
via POST + v2 detail — the older widget endpoint returns 0 jobs); Remote OK (first array
element is a legal notice); Remotive (naive UTC timestamps; free API delayed 24h);
Arbeitnow (paged, mostly Germany); Himalayas (cursor-paginated); Jobicy (entity-encoded
titles); We Work Remotely (RSS, titles are "Company: Title").

### 9.4 The pipeline per source

```
open DiscoveryRun (RUNNING)            ← before any network call
→ adapter: fetch + normalize to Postings
→ stage A filter: title / location / age — listing data only, free
→ descriptions: only for stage-A survivors (loadDescription), 4 at a time
→ stage B filter: a core-stack keyword in title or description
→ dedupe: hash(normalized company + title); bump lastSeenAt on known jobs
→ store new jobs with source attribution
→ close run: SUCCESS | EMPTY | FAILED + jobsFound / jobsMatched / jobsNew
```

Expensive steps always sit behind cheap ones (descriptions that cost a request are
fetched only for postings that already passed the free screen). One posting's detail
request failing is counted and skipped; it doesn't fail the source. Each run returns the
count of rejections per reason, which is how the filter is tuned.

### 9.5 Run lifecycle, failures and retries

- The run row is created as RUNNING before fetching: a crash mid-fetch leaves a visible
  RUNNING row instead of silence (§1.3).
- **EMPTY** (source returned nothing) stays distinct from **SUCCESS with 0 matches**.
- **FAILED** stores the error message; the error is rethrown so the queue retries it.
- **Permanent vs transient:** a missing adapter or invalid config raises
  `PermanentSourceError` → BullMQ `UnrecoverableError` → fails once, no retries.
  Timeouts and 5xx retry (3 attempts, exponential backoff from 60s); **each attempt is its
  own run row**, so retries are visible.

### 9.6 The rule filter (no AI)

Settings are a `DiscoveryPreferences` row per user; defaults
(`DEFAULT_DISCOVERY_PREFERENCES` in shared) are tuned for a ~2-year frontend/full-stack
developer in Lahore:
- *Title include:* developer, engineer, software, frontend, full stack, react, mern,
  javascript, typescript, web, …
- *Title exclude:* far-senior roles (principal, staff, director, head of, manager,
  architect), interns, other stacks (iOS, Android, Flutter, embedded, data/ML, DevOps,
  QA, security, Salesforce, SAP), non-engineering roles, and German-market/student
  postings ("Werkstudent", "Praktikum", "(m/w/d)"). **"Senior" is kept** — whether to
  stretch is the scorer's call, not the filter's.
- *Stack keywords* (stage B): react, next.js, typescript, javascript, node, nestjs,
  express, mern, tailwind, angular, …
- *On-site/hybrid locations:* lahore, pakistan, pk.
- *Remote:* allowed, unless restricted to a region that can't hire from Pakistan (US,
  Canada, LATAM, UK, EU-only, Germany, Australia, India, …). An allowed place wins over a
  restricted-region mention ("USA, Pakistan" passes).
- *No location and unknown work mode:* benefit of the doubt (common on company boards).
- *Posting age (30 days):* **aggregators only** — on a company's own board a listed job is
  open (§1.3).
- *Matching:* case-insensitive, whole-word on non-alphanumeric boundaries — "react"
  matches "React.js developer" but not "reactive"; "next.js" and "c++" work.

### 9.7 Deduplication

`dedupeHash = sha256(normalize(company) | normalize(title))`, unique per user. Normalizing
strips accents, punctuation and company suffixes (Inc., Ltd., Pvt., Technologies, …) but
keeps C, C++ and C# distinct. Location is deliberately excluded: sources format it too
differently to match reliably, and the same title at the same company in two cities is
one decision for the user. This is what collapses the same job from different sources
and repeated email alerts into one.

### 9.8 Scheduling and the queue

- Nightly at **02:00 Asia/Karachi** (`DISCOVERY_CRON`, `DISCOVERY_TZ`), via a BullMQ **job
  scheduler stored in Redis** (`upsertJobScheduler`). Upserting is idempotent, so any
  number of worker copies or restarts still produce exactly one run per night — an
  in-process cron would fire once per copy.
- The scheduled `discover-all` job fans out one `discover-source` job per enabled source
  (all users), so a slow or failing source retries alone and never holds up the others.
  Fan-out job IDs derive from the batch ID, so a retried fan-out re-adding the same IDs is
  a no-op. (BullMQ custom job IDs can't contain `:`; we use `__`.)
- Worker concurrency: 3 sources in parallel (`WORKER_CONCURRENCY`).
- BullMQ 6 requires a constructed `ioredis` client in ESM (`createRedis`); the worker's
  client waits for Redis to return (`maxRetriesPerRequest: null`).

### 9.9 "Run discovery now"

`POST /discovery/run` queues the user's enabled sources **except any that ran in the last
6 hours** (`MANUAL_RUN_COOLDOWN_HOURS`), so a user pressing the button can't break an
aggregator's request limits. With Redis down, BullMQ either errors immediately or waits
indefinitely for a connection (both observed), so every enqueue from the API is bounded
by a **3-second timeout** and both failures return **503**.

### 9.10 Source terms and etiquette

- Remote OK, Remotive and Jobicy require **naming them as the source and linking back to
  the original posting**, with Apply going to the original URL. Every job stores `source`
  and `sourceUrl`; the job card shows "via Remote OK" (or "<Company> careers") and "Open
  posting ↗" uses `rel="noopener"` — not `noreferrer`/`nofollow`, because they ask for
  referral traffic.
- Remotive asks for at most ~4 requests a day; the nightly run makes 1.
- LinkedIn, Indeed, Glassdoor, Wellfound and remote.co are never scraped — email only.

### 9.11 Finding sources versus finding jobs (decided 2026-10-02)

"Search every software house in Lahore and every remote board" is two different
problems, solved differently:

| Layer | What | How often | Cost |
|---|---|---|---|
| **1. Find sources** | Grow the list of companies/boards to watch | Monthly, or on demand | Cents (or free — see below) |
| **2. Portal alerts** | LinkedIn, Rozee, Indeed, Glassdoor, Wellfound search thousands of companies against saved keywords and email the results (§10) | Continuous | Free |
| **3. Poll known sources** | The platform adapters (§9.3) | Nightly | Free — no AI |
| **4. Custom sites** | Change watcher; Haiku reads only changed pages | Nightly | Fractions of a cent per change |

**Claude web search is never used for nightly job discovery.** Rejected because:
it costs $10 per 1,000 searches plus tokens for every result page (dozens of searches a
night ≈ $10–15/month, over budget); results are non-deterministic and miss companies
silently — the "silent single-source search" failure of §1.3; they are dominated by
LinkedIn/Indeed links that can't be fetched; and the portals' own alerts already search
the whole market for free.

**Where web search *is* used — layer 1, sparingly and targeted:**
- **ATS-scoped searches** such as `site:job-boards.greenhouse.io Lahore`,
  `site:jobs.lever.co Pakistan`, `site:apply.workable.com Lahore`,
  `site:jobs.ashbyhq.com Pakistan` — they find companies that post Pakistan jobs on
  platforms we already have adapters for. Each company found becomes a source polled
  free every night thereafter. ~20–30 searches ≈ $0.30–0.60 per run, monthly.
- **The user can run these searches by hand in claude.ai** (Claude Pro includes web
  search) and paste the company list in — taking the cost off the API budget (§12.3).
- **Board probing needs no AI and no search:** for any company name (from alerts, the
  user's list, or a directory such as P@SHA's member list), call the platforms' public
  APIs (`boards-api.greenhouse.io/v1/boards/<slug>`, Lever, SmartRecruiters, Workable)
  — free, deterministic. This is the board discovery of §9.12.
- Every newly found source is a **suggestion the user approves**, never added silently.

### 9.12 Planned discovery work

- **Milestone 2:** HTML parsers for JazzHR, Zoho Recruit and OpenCATS-style pages (8
  companies), then the single-company platforms.
- **Milestone 3 — custom careers sites:** a **generic change watcher** instead of 15
  hand-written scrapers (which would break on every redesign): fetch each page nightly
  and compare with the previous version (free); only when it changed, have Haiku extract
  the listings (~$0.001 per changed page). One adapter for every custom site, and the
  cheap check sits in front of the expensive one.
- **Board discovery** (decided 2026-10-02): when an email alert names a company Shortlist
  doesn't watch, check whether it has a public Greenhouse / Lever / SmartRecruiters /
  Workable board (official public APIs, not scraping). If found, **suggest adding it as a
  source** — from then on its jobs arrive automatically with full descriptions. Alerts
  thereby grow the watched-company list over time.

---

## 10. Email job alerts (planned)

### 10.1 What and why

LinkedIn and Rozee.pk are the two biggest sources for the Lahore market; with Indeed,
Glassdoor, Taraki, Wellfound and remote.co they all forbid scraping or have no API.
Their **job-alert emails** are the legitimate way in. Ordered *after* AI scoring (§17):
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
- **Google setup gotcha:** while the OAuth consent screen is in "Testing" status, refresh
  tokens expire after 7 days. Set the app to "In production" for personal use; the user
  sees an "unverified app" warning once (expected for a personal tool). Selling the
  product later would require Google's verification for this restricted scope (§1.4).

### 10.4 Processing

- One parser per sender/portal (the same one-per-platform principle as adapters).
- Each check is a `DiscoveryRun` against an `EMAIL_INBOX` source, with the same
  RUNNING/SUCCESS/EMPTY/FAILED visibility; the same filter and deduplication apply.
- Processed message IDs are recorded so an email is never ingested twice.

### 10.5 Partial information and "paste once"

Alert emails usually carry title, company, location and a link — not the full
description — and fetching the page behind the link would be scraping. So:
- Such jobs are marked **partial info** and get a rough score from what the alert
  contains (enough to decide Skip vs Interested).
- **Repeated alerts collapse into one job** by dedupe hash — the user never pastes the
  same job twice.
- **"Paste full description" appears only on jobs the user marked Interested**, because
  only tailoring needs it. Most alerts are skipped and never need it.
- Often no paste is needed at all: if the same job is on a watched company board or
  aggregator, the full description is filled from there; and board discovery (§9.12)
  turns alert-only companies into watched sources over time.

---

## 11. Manual job intake — "Add a job" (planned, decided 2026-10-02)

The universal fallback for everything automatic discovery can't reach: WhatsApp groups,
LinkedIn feed posts, recruiter messages, referrals, unsupported portals. Tier 6 of §9.1.

- **Input:** a link, pasted text, or both. A link to a supported platform → the full
  description is fetched from its public API. Otherwise the pasted text is the
  description; title and company are extracted (editable).
- **Becomes a real `Job`** (source MANUAL): it enters the pipeline (Interested → Applied…),
  is deduplicated against discovered jobs, and is scored like any other.
- **Same truthfulness rules:** verified evidence only, every bullet traceable, gaps shown
  before tailoring.
- **Bypasses the score threshold** — tailoring runs even on a low score, because the user
  asked; the score and gaps are shown first so it's an informed choice.
- **Android share target:** the PWA manifest registers a `share_target`, so the user can
  long-press a WhatsApp message or tap Share on a LinkedIn post → Shortlist, and the job
  opens pre-filled. iOS doesn't support share targets for web apps; there it's
  copy-paste.
- Scam heuristics (§3.11) apply — WhatsApp-sourced jobs are a common vector.

---

## 12. AI pipeline — extraction and match scoring (planned; next build)

### 12.1 Flow and models

```
new/updated Job (passed the rule filter)
→ extraction (Haiku): structured JobRequirement rows (skill, REQUIRED|PREFERRED|BONUS,
  yearsRequired) + red flags (scam signals) + seniority
→ match scoring (Haiku): against VERIFIED evidence only, commercial weighted above
  personal → JobMatch (overallScore 0–100, commercialScore, verdict APPLY|STRETCH|SKIP,
  strengths, risks) + SkillGap rows (BLOCKING|MODERATE|MINOR)
→ Jobs screen sorts by score
```

- **Why Haiku:** extraction and scoring are structured-output tasks Haiku handles well and
  cheaply; Sonnet's writing quality is reserved for tailoring.
- **Every model response is validated with Zod** before anything touches Postgres;
  malformed output is rejected and retried, never stored.
- **Batch API + prompt caching:** the pipeline runs overnight, a natural fit for
  asynchronous batch processing at ~50% off; the career-database context is identical
  across calls and is cached.
- **Re-scoring** after evidence changes uses stored `JobRequirement` rows — no job
  description is re-read.
- **Partial-info jobs** (email alerts) are scored on what they contain and flagged as such
  until a full description arrives.
- **"Possibly closed"** jobs (not seen in recent runs) are not scored or tailored.
- **The threshold that gates tailoring is a runtime setting, not a constant** — it is the
  cost/noise dial.
- **Prerequisites:** the user's verified evidence, and an Anthropic API key in the
  worker's environment only.

### 12.2 Budget (prices checked 2026-10-02 on the official pricing page)

| | Standard | Batch API (50% off) |
|---|---|---|
| Claude Haiku 4.5 — extraction, scoring | $1 in / $5 out per MTok | $0.50 / $2.50 |
| Claude Sonnet 5.5 — tailoring | $2 in / $10 out per MTok | $1 / $5 |
| Cache reads (the career database — identical every call) | 0.1× input price | stacks with batch |
| Web search (server tool) | $10 per 1,000 searches + result tokens | — |
| Web fetch (server tool) | tokens only | — |

**Estimate at real volume.** Live discovery stores ~25 jobs on a first run, and only
*new* jobs are scored after that (dedupe), so ~5–15 per night.
- Scoring: ~5,000 input + ~500 output tokens per job, career data cached, batched →
  **~$0.003 per job → ~$1/month**.
- Tailoring: ~$0.015–0.03 per resume; with the resume library reusing approved variants,
  ~30 new resumes/month → **~$1/month**.
- Source discovery via API web search: ~$0.50 per monthly run (or $0 if done by hand in
  claude.ai).
- **Total ≈ $2–3/month.** The user's initial $5 of credits lasts ~2 months. (The original
  plan's ~$11/month assumed 30 jobs/day reaching AI; real deduplicated volume is far
  lower.)
- Infrastructure when deployed: free tiers for Neon, Upstash, Vercel; ~$5–7/month for an
  always-on worker host; domain ~$12/year.

### 12.3 Budget guard (decided 2026-10-02; built with the scoring step)

So a bug or a sudden flood of "new" jobs can't drain the credits in one night:
1. **A monthly spend limit set in the Anthropic Console** (account-level hard stop) —
   set by the user.
2. **In the worker:** a nightly cap on AI calls (e.g. score at most 40 jobs, tailor at
   most 5 — runtime settings, not constants); every model call logs its token usage and
   computed cost; jobs over the cap wait for the next night (visible, never silently
   dropped); month-to-date spend shown on the Sources page.

### 12.4 Claude Pro subscription versus the API (2026-10-02)

The user has a Claude Pro subscription. It is **not** used to power Shortlist: Pro covers
the user's own use of Claude (claude.ai, apps, Claude Code — used to *build* Shortlist),
while the worker's nightly calls need an API key billed from Console credits. Routing the
worker through the Pro login (e.g. scripting Claude Code as a backend) was rejected — it
isn't what the subscription is for, likely breaches its terms, and is fragile (usage
limits, interactive sessions). **Pro is used for:** development; manual source discovery
with web search (§9.11); prototyping the scoring/tailoring prompts on real job
descriptions before spending API credits; one-off career work (rewording evidence before
verifying, interview prep from gaps, special cover letters). Rule of thumb: anything
automated runs on the API; anything the user does by hand can use Pro.

---

## 13. Resume tailoring, the resume library, and the application kit (planned)

### 13.1 Tailoring

Sonnet writes a resume for a job in **the user's own CV layout** (not a generic
template), using only verified evidence and obeying the placement rules (§6.1). Each
bullet stores the evidence IDs it came from. Rendered to PDF.

### 13.2 The resume library (decided 2026-10-02)

The user's idea: keep a store of resumes per niche (React, Next.js, Node, frontend,
backend, MERN, full-stack…) and reuse one when several job descriptions are effectively
the same, instead of generating a new resume each time. **Adopted, with one change:
match by requirements, not by job title.** Titles are unreliable — "Software Engineer"
at Kwanso is MERN while at Motive it may be Go, and "Frontend Engineer" and "React
Developer" often ask for the same things.

- **Every tailored resume is stored as a variant** with the requirement profile it was
  built for (e.g. {React, TypeScript, Node, MongoDB}).
- **For each new job, plain code (no AI) compares its extracted requirements against
  every variant.** If the overlap is high (~85%, tunable) **and** the job has no REQUIRED
  skill the variant doesn't cover → **reuse it at zero AI cost** ("Reusing your MERN Full
  Stack resume — 92% match", with "tailor fresh anyway"). Otherwise tailor a new one and
  store it as a new variant.
- **Base variants:** the user can create and pin a base resume per niche, each generated
  and reviewed once; most jobs then map to one of them.
- **Why it's worth it:** the API saving is real but small (a Sonnet tailoring run costs
  cents; ~$3/month at expected volume). **The bigger saving is review time** — every new
  resume must be read and approved before it goes out, while a reused, already-approved
  variant needs no second review.

### 13.3 Staleness

Because every bullet records the evidence it came from, any edit to or un-verification
of that evidence marks **every variant using it stale**. A stale variant can't be reused
or sent until regenerated — otherwise the library would keep sending a claim the user has
since corrected, which is the Azure problem returning.

### 13.4 Schema change (to be made when tailoring is built)

Today `TailoredResume` is one per `JobMatch`. It becomes:
- `ResumeVariant` — bullets with per-bullet evidence IDs, requirement profile, optional
  niche label/pin, PDF reference, stale flag, timestamps;
- an application record linking a `Job` to the variant actually used (many jobs can share
  one variant), so "what did I send Kwanso?" is answerable at interview time.

### 13.5 The application kit

Per job, ready for the user to submit themselves: the tailored (or reused) PDF; for
"send your CV to <email>" postings, a drafted email opened in the user's own mail app
(`mailto:` with subject/body; the user attaches/sends); drafted answers to common
screening questions (years of experience computed from verified dates); outreach and
follow-up drafts.

### 13.6 Notifications

When a resume is ready (tailored or reused), a Web Push notification: "Resume ready:
<title> @ <company> — review and submit." Opening it shows the resume, the evidence
behind each bullet, and the gaps.

---

## 14. Technology decisions

| Area | Choice | Why — and what was rejected |
|---|---|---|
| Backend framework | **NestJS** (on Express) | The system is an API + worker + scheduler + queue sharing modules; Nest's module system and DI fit that. Increasingly asked for in job listings; patterns transfer to Spring Boot. Plain Express rejected as too little structure for multiple processes. |
| Auth | **Hand-rolled JWT**, not `@nestjs/passport` | The goal is understanding bcrypt, short-lived access tokens, rotated refresh tokens, revocation and guards — not configuring a library that hides them (§8). |
| Password hashing | **bcrypt** | Named in the original plan; `@node-rs/argon2` was briefly installed and removed so there's one choice. |
| Validation | **Zod everywhere** via a custom `ZodValidationPipe` | One system for request bodies, Claude responses and env vars, shared with the frontend. `class-validator` rejected: it would fragment validation into two systems and block schema sharing. |
| Database | **PostgreSQL + Prisma** | Deeply relational data queried with joins (match scoring). MongoDB rejected — multiple round trips for what Postgres does in one JOIN. |
| Queue | **Redis + BullMQ** (`@nestjs/bullmq` in the worker; a plain `Queue` in the API) | Standard pairing; holds nothing that can't be re-derived. The API is producer-only so it doesn't need the Nest module. |
| Scheduling | **BullMQ job scheduler stored in Redis** | Supersedes the original `@nestjs/schedule` idea: an in-process cron fires once per worker copy; a Redis-stored scheduler fires exactly once. |
| Redis client | **ioredis**, constructed explicitly | BullMQ 6 treats it as optional and requires a constructed client under ESM. |
| Frontend | **React + Vite**, not Next.js | A private authenticated dashboard: Next's SSR/SEO advantages don't apply, and Nest already owns API and auth. (Next.js stays right for the separate Manzil project, which needs SEO.) |
| UI styling | **Tailwind CSS v4** | Chosen by the user over Tailwind+shadcn, Ant Design and MUI: used in production at CloudCard, small bundle for a mobile-first PWA. |
| Server state | **TanStack Query** | Chosen by the user over plain fetch: caching, refetch, loading/error states; widely asked for. |
| Routing | **react-router** | Standard; simple nested routes for the app shell. |
| PWA | **vite-plugin-pwa** | Manifest + service worker; app shell only (§8.4). |
| AI | **Claude: Haiku** (extraction, scoring), **Sonnet** (tailoring) | Split by cost/quality need; Batch API + prompt caching because the pipeline runs overnight. |
| RSS parsing | **fast-xml-parser** | We Work Remotely publishes RSS. |
| Cookies | **cookie-parser** | Reads the refresh cookie. |
| Tests | **Vitest** (API, worker, web), **node:test** (db seed guards), Supertest, Testing Library | Nest 12 defaults to Vitest; seeds run on Node's type stripping, so `node:test` needs no extra tooling. |
| Lint | **oxlint** (type-aware) | Nest 12 default; `no-floating-promises` is an error. |
| Seed scripts | **Node's built-in type stripping** (no `tsx`) | No extra dependency; requires `.ts` import extensions and erasable-only syntax, checked by `tsconfig.seed.json`. |
| Optional native add-on | `msgpackr-extract: false` | BullMQ's optional speed-up; the pure-JS fallback is fine at our volume and avoids a native build step. |
| Monorepo | **pnpm workspaces** | `packages/shared` and `packages/db` compile to `dist/` and are built before the apps. |
| Module format | **ESM** throughout (`nodenext`) | Relative imports end in `.js` even in `.ts` source — required by Node's ESM resolution, not a mistake. |

---

## 15. Development workflow and conventions

### 15.1 Git and GitHub

- Repository: `github.com/NumanBytes/shortlist` (private). Default branch `main`.
- **Feature branches, merged by pull request.** `main` stays deployable; each step of the
  roadmap is a short-lived branch (`feat/…`, `fix/…`, `docs/…`) with a PR describing what
  and why. No long-lived `develop` branch (overhead for a solo developer). PRs also serve
  as a portfolio record of engineering decisions.
- Large features are split into **stacked PRs** (e.g. worker, then UI); when the lower one
  merges, GitHub retargets the upper one.
- The repo auto-deletes merged branches.
- **No Claude attribution** in commit messages or PR descriptions (no `Co-Authored-By:
  Claude`, no "Generated with Claude Code") — the user removed it once and asked never to
  add it again.

### 15.2 Environment files

`packages/db/.env` is read by the Prisma CLI; `apps/api/.env` and `apps/worker/.env` are
loaded at boot with Node's `process.loadEnvFile()` (no dotenv). Every process validates its
env with Zod at startup and refuses to start on bad config. Secrets are never committed;
`.env.example` files document every variable.

### 15.3 Testing strategy

- **API:** unit tests next to the source (`*.spec.ts`); e2e tests (`test/*.e2e-spec.ts`)
  with Supertest against the real database. Use `createTestApp()` — it tracks the users it
  creates and deletes only those (files run in parallel, so never bulk-delete by domain).
  One test per truthfulness rule.
- **Worker:** adapter tests serve **recorded real responses** (`test/fixtures/`) via a
  stubbed `fetch` — never the network; recapture a fixture when an adapter changes.
  Integration tests run `DiscoveryService` against the real database with fake adapters.
- **Web:** Vitest + jsdom + Testing Library, `fetch` stubbed.
- **Live verification:** significant features are also run end to end — real sources, a
  headless browser at phone size against the real API/worker — with temporary accounts
  deleted afterwards.

### 15.4 Database migrations

- Normal changes: `prisma migrate dev --name …` (or `--create-only` then edit the SQL for
  constraints Prisma can't express).
- When Prisma demands an interactive confirmation in a non-interactive environment,
  generate the SQL by diffing the **live schema, read-only** (`migrate diff
  --from-schema-datasource … --to-schema-datamodel … --script`), review it, save it as a
  migration, and apply with `migrate deploy`.
- **Never** pass the dev database as `--shadow-database-url`, and never run `migrate
  reset` against data you care about (§1.3).

---

## 16. Decision log

| Date | Decision | Why / notes |
|---|---|---|
| 2026-09 | The human always clicks submit; full automation rejected | ToS bans auto-applying; recruiters detect bots; every claim must be approved (§1.2) |
| 2026-09 | `isVerified` defaults false; generation reads verified evidence only | Azure B2C incident (§1.3) |
| 2026-09 | Name "Shortlist"; English names only | §2 |
| 2026-09 | API / worker / web as separate processes; Redis queue-only | §4 |
| 2026-09 | NestJS, hand-rolled JWT, Zod-only validation, Postgres+Prisma, React+Vite | §14 |
| 2026-09-30 | Feature-branch + PR workflow; no long-lived develop branch | §15.1 |
| 2026-09-30 | No Claude attribution in commits/PRs | User request |
| 2026-09-30 | bcrypt (argon2 removed); passwords ≤72 bytes; emails lowercased | §8.1 |
| 2026-09-30 | Refresh rotation with reuse detection; opaque tokens hashed with SHA-256 | §8.1 |
| 2026-09-30 | Evidence edits and skill renames un-verify; verify is its own endpoint | §6.3 |
| 2026-09-30 | Case-insensitive skill names via raw-SQL index | §5.2 |
| 2026-09-30 | Role/project claim-field edits and deletes un-verify linked evidence; http(s)-only URLs | §6.3, §8.4 |
| 2026-09-30 | Career data seeded unverified with guards; dates supplied by the user | §7 |
| 2026-09-30 | Never use the dev DB as a Prisma shadow database | Shadow-DB reset incident (§1.3) |
| 2026-10-01 | Refresh token only in an httpOnly SameSite=Strict cookie; web and API must share a site | §8.2, §4 |
| 2026-10-01 | Access token in memory only; single-flight + Web Lock refresh | §8.3 |
| 2026-10-01 | Tailwind CSS and TanStack Query for the web app | User's choice (§14) |
| 2026-10-01 | Adapters per platform, not per company; all 48 sources recorded as data | §9.2–9.3 |
| 2026-10-01 | Two-stage rule filter driven by per-user `DiscoveryPreferences` | §9.6 |
| 2026-10-01 | Posting age enforced on aggregators only | Age-filter incident (§1.3) |
| 2026-10-01 | Dedupe by normalized company+title, location excluded | §9.7 |
| 2026-10-01 | BullMQ scheduler stored in Redis (not in-process cron); fan-out per source | §9.8 |
| 2026-10-01 | Manual run cooldown 6h; API enqueue bounded by 3s timeout → 503 | §9.9 |
| 2026-10-01 | Source attribution + link-back; `rel="noopener"` without `noreferrer` | Aggregator terms (§9.10) |
| 2026-10-01 | Wellfound, remote.co, LinkedIn, Indeed via email alerts only; Turing isn't a source | §9.2, §10 |
| 2026-10-01 | Custom careers sites via change watcher + Haiku extraction (Milestone 3) | §9.12 |
| 2026-10-02 | Use the user's personal Gmail (no new inbox); OAuth `gmail.readonly`; worker reads only the `Shortlist` label; never sends | §10.2–10.3 |
| 2026-10-02 | Email alerts move ahead of discovery Milestone 2, after AI scoring | §10.1, §17 |
| 2026-10-02 | Partial-info jobs; "paste full description" once, only for Interested jobs | §10.5 |
| 2026-10-02 | Board discovery: suggest watching companies found in alerts that have public boards | §9.12 |
| 2026-10-02 | "Add a job" (paste text/link) + Android share target; bypasses score threshold | §11 |
| 2026-10-02 | Resume library: variants matched by requirement overlap (not title), base variants per niche, stale on evidence change; `TailoredResume` → variants + application record | §13.2–13.4 |
| 2026-10-02 | Application kit: drafted email (user sends), screening answers, outreach drafts | §13.5 |
| 2026-10-02 | Scam-posting red flags; "possibly closed" jobs aren't tailored | §3.9, §3.11 |
| 2026-10-02 | Every design decision is recorded in this document | User request |
| 2026-10-02 | Separate *finding sources* (monthly, targeted ATS-scoped web search + free board probing) from *finding jobs* (nightly, no AI) | §9.11 |
| 2026-10-02 | Claude web search is never used for nightly job discovery | Cost, non-determinism, silent misses (§9.11) |
| 2026-10-02 | Budget re-estimated at current prices: ≈ $2–3/month; initial $5 credit | §12.2 |
| 2026-10-02 | Budget guard: Console spend limit + nightly AI-call caps, per-call cost log, spend shown in app | §12.3 |
| 2026-10-02 | Claude Pro is for development and manual work, not for powering the worker | §12.4 |

---

## 17. Build state and roadmap

### 17.1 Built and verified (as of 2026-10-02)

- **Monorepo:** `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`.
- **Auth** (§8): register, login, refresh, logout, `GET /auth/me`; refresh cookie; CORS
  allowlist; web token handling with single-flight + Web Lock.
- **Career truth CRUD** (§6): skills, evidence (+ verify/unverify), work experience,
  projects — every verification-reset rule enforced and tested.
- **Career seed** (§7): 1 role, 1 project, 28 skills, 29 evidence items, all unverified;
  seeded into the user's account.
- **Discovery Milestone 1** (§9): worker, 10 adapters, two-stage filter, dedupe, run
  lifecycle, nightly Redis scheduler, 48 sources recorded (13 enabled). First live run:
  1,321 postings → 25–28 stored, including Septem's MERN role and Kwanso's Full Stack /
  MERN roles in Lahore.
- **Web app:** sign in/register; Jobs (New / Interested / Applied / Skipped, attribution,
  "Open posting", pipeline stages); Evidence review (verify / unverify / reword);
  Sources (health, counts, errors, on/off, "Run discovery now"). Installable PWA.
- **API for jobs and discovery:** `/jobs`, `/jobs/:id`, `/discovery/sources`,
  `/discovery/run`.
- Tests: unit, e2e/integration and web tests across all packages; typecheck and lint
  clean. Migrations applied to a **local** Postgres (Neon not yet set up).

### 17.2 Roadmap (in order)

1. **User:** verify the 29 seeded evidence items in the Evidence screen (rename the
   placeholder "API integration" skill; add Manzil's description and dates). Everything
   AI reads only verified evidence.
2. **AI extraction + match scoring** (§12) with the **budget guard** (§12.3), together
   with **"Add a job"** (§11, incl. the Android share target) — they share the pipeline,
   and a pasted job is only useful once scored. Needs an Anthropic API key in the worker
   env and a Console spend limit (user, with $5 of credits).
3. **Email job alerts** from the personal Gmail (§10): OAuth read-only, `Shortlist`
   label, per-portal parsers, partial-info jobs, "paste full description", board
   discovery.
4. **Tailoring, the resume library and the application kit** (§13), with push
   notifications. **Decide the open placement rules (§6.1) first.**
5. **Discovery Milestone 2** (hosted ATS pages), **source discovery** (§9.11: board
   probing + monthly ATS-scoped search), then **Milestone 3** (custom sites via change
   watcher).
6. **Deploy** (§4): Neon, Upstash, Vercel + Render/Railway on a shared site.
7. Rate-limit `/auth/login` and `/auth/register`.

### 17.3 Open decisions

- Placement rules for COMMERCIAL + WORKING, COMMERCIAL + EXPOSURE, PERSONAL + PRODUCTION /
  MAINTENANCE (§6.1).
- The score threshold that gates tailoring (§12.1) and the resume-reuse overlap threshold
  (§13.2) — both runtime settings; initial values to be set when built.
- Skill aliases ("React" vs "React.js") — needs a canonical-name mapping (§5.2).
- UI for renaming skills and editing roles/projects (API endpoints exist).

---

## 18. Working agreements

- The builder wants genuine understanding of every layer, not just working code — explain
  *why* a pattern is used alongside the code, especially anything that maps to a
  system-design interview concept (queues, validation boundaries, idempotency, failure
  visibility, auth).
- Prefer hand-rolled implementations of interview-relevant mechanisms over libraries
  that hide them, even when the library would be faster to ship.
- Decisions that belong to the user (preferences, personal facts, product direction) are
  asked, not guessed — e.g. evidence dates, UI library, which inbox to use.
- Record every design decision in this document (see the rules at the top).
- Product-facing names in English; this document and all code/comments in plain, direct
  English.
