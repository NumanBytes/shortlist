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
7. The career database (seed reference, CV reconciliation)
8. Authentication and security
9. Job discovery
10. Email job alerts
11. Manual job intake — "Add a job" (planned)
12. AI pipeline — extraction and match scoring
13. Resume tailoring, the resume library, and the application kit
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

**Is a worker running? — the heartbeat (2026-10-04).** The API can only add jobs, so a
stopped worker used to look exactly like a slow one: a tailoring request sat in the queue
for over ten minutes while the UI said "Tailoring…" and polled every 3 seconds, and
nothing told the user that no worker was running. Now the worker writes
`shortlist:worker:heartbeat` to Redis every 20s with a 60s TTL (`HeartbeatService`) and
deletes it on a clean stop. The API reads it (`JobQueues.workerOnline()`) and reports it
wherever work waits on the worker: a resume being tailored and the discovery status. A key
with a TTL is a dead-man's switch: if the process dies without a clean stop, the key
expires on its own. BullMQ's `getWorkers()` was rejected because it relies on Redis
`CLIENT LIST`, which hosted Redis (Upstash) doesn't allow. The read is best effort: if Redis
doesn't answer within 3s it returns `null` ("unknown"), not a 503.

**Why Redis holds nothing important.** It is a queue (and later rate-limit counters)
only. Everything that matters is in Postgres. Losing Redis loses, at worst, queued work
that the next nightly run redoes.

**Secret boundaries.** The Claude API key and the Gmail access token live only in the
worker's environment/database access path. The browser never sees them; the API never
needs the Claude key. A compromised frontend cannot spend money or read mail.

**Deployment: one VPS running everything (decided 2026-10-04; prepared, not yet live).**
The user chose a single small Linux server (a VPS, ~$4–6/month) over managed services:
- **Free tiers didn't fit.** Upstash's free Redis caps commands per month, and BullMQ polls
  Redis constantly, so an idle worker would exhaust it.
- **The worker must never sleep.** Free hosts put programs to sleep until a web request
  arrives. The worker receives none, so the 2 AM run, Gmail checks and tailoring would
  stop.
- **Vercel can only host the web app.** It runs server code as short request-bound
  functions, so it can't host the long-running worker.
- **One server and one bill,** with no quotas.

The VPS runs **Docker Compose** (`deploy/`), using one multi-stage `Dockerfile` at the
repo root that produces two images:
- **`server`** runs the API, the worker *and* the migration step: the same code, started
  with a different command. Development-only packages are removed after the build, so
  the Prisma CLI is a runtime dependency of `@shortlist/db` to keep `migrate deploy`.
  About 250 MB.
- **`web`** is Caddy plus the built React app.

The services:
- **`caddy`** is the only one with open ports. It gets and renews a Let's Encrypt
  certificate automatically for `SITE_ADDRESS`. That has to be a hostname, so the user,
  who owns no domain, uses a free DuckDNS subdomain. HTTPS is required for a phone to
  install the PWA. Caddy forwards `/api/*` and `/health` to the API and serves the app,
  so web and API share **one origin** and the `SameSite=Strict` cookie works (§8.2), the
  same arrangement as Vite's dev proxy. The page and the service worker are sent with
  `no-cache` so phones pick up new versions; the hashed `/assets` are cached for a year.
  It also sets HSTS, nosniff, `X-Frame-Options: DENY` and a referrer policy.
- **`migrate`** runs `prisma migrate deploy` and exits. The API and worker start only
  after it succeeds, so code never runs against an older schema.
- **`postgres`** is version 18, the same as development, so a local dump restores cleanly.
  **`redis`** uses `appendonly` and `noeviction`. Neither is reachable from outside.
- **`backup`** runs `pg_dump` nightly at 03:30 local time and keeps 14 days in
  `deploy/backups/`. Those dumps guard against mistakes, not against losing the server,
  so the README says to copy them off the machine.
- **`TRUST_PROXY_HOPS=1`:** Caddy is the one proxy (§8.1).

Verified locally (2026-10-04) on test ports with the full stack:
- health, register and refresh through Caddy;
- a `Secure; HttpOnly; SameSite=Strict` cookie and an HTTP → HTTPS redirect;
- `workerOnline: true` across containers;
- the login limit holding against **faked `X-Forwarded-For`** (31st attempt: 429);
- a nightly dump;
- the README's step of **importing the user's real local database** (jobs, verified
  evidence and resumes intact, then "No pending migrations");
- seeding a fresh account.

That test found a bug: Compose passes a blank optional setting (`${VAR:-}`) as `""`,
which failed env validation. **Both apps now treat an empty env value as not set.**
`deploy/README.md` is the step-by-step guide.

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
  "Numan@X.com" and "numan@x.com" can't be two accounts). Resume-header fields
  (`name`, `headline`, `location`, `phone`, `linkedinUrl`, `githubUrl`, added 2026-10-02)
  are edited on the Profile page (`GET`/`PATCH /profile`); email is not editable there.
  Personal contact data lives **only in the database**, never in the repo or the seed.
  None of it is a claim, so editing it never un-verifies anything.
- **`Education`** (2026-10-02) — degree, institution, optional location, start/end year
  (end ≥ start, checked on the merged values on update). A resume's Education section
  reads from here. Not evidence: a degree is a fact on a certificate, not a skill claim.
- **`RefreshToken`** — stores only the SHA-256 hash of each refresh token, with
  `expiresAt` and `revokedAt`, so sessions can be revoked and a database leak doesn't
  leak usable tokens (§8.1).
- **`WorkExperience`, `Project`** — what evidence is anchored to. Their claim-bearing
  fields un-verify linked evidence when changed (§6.3). A project can belong to a role
  (`Project.workExperienceId`, SET NULL on role delete, added 2026-10-02): the CloudCard
  banking products are projects *of* the job, so a resume can list them under that
  Experience entry instead of in a personal Projects section. The role must be the
  caller's (400 otherwise), and changing the link is a claim change.
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
- **`ResumeVariant`, `JobResume`** (built 2026-10-02, replacing the never-used
  `TailoredResume`) — a variant is one tailored resume: `content` (JSON, Zod-validated
  `ResumeContent`), `evidenceIds` (everything it relies on), `requirementProfile`
  (normalized requirement names of the job it was made for), `status` DRAFT | APPROVED,
  `generatedAt`. `JobResume` is one per job: which variant it uses, whether it was
  reused (and at what overlap), and the state of preparing it (PENDING | READY |
  DEFERRED | FAILED). `evidenceIds` has no foreign key on purpose: a deleted item must
  leave a trace so the resume reads as stale instead of silently shrinking (§13.3).

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
| COMMERCIAL + WORKING | Skills section, and Experience bullets worded as what was actually done ("deployed through existing CI/CD pipelines", "small changes in Ruby") — never as having built or owned it (decided by the user 2026-10-02) |
| PERSONAL/ACADEMIC + EXPOSURE | Skills section only if `lastUsed` < 2 years ago; otherwise omitted entirely |

**Still open (ask before tailoring code assumes one):** COMMERCIAL + EXPOSURE and
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
    project (name, description, shipped, start/end, the role it belongs to) — compared by value, so a form
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
- The Evidence screen's **Edit** (formerly "Reword") changes the wording, *where*
  (context) and *how deeply* (depth) of an item, sending only the fields that changed;
  saving says up front that it un-verifies the item. Context and depth are claims as much
  as the wording is — "PERSONAL" vs "COMMERCIAL" is the difference between a Projects
  line and an Experience bullet.
- **Add a skill / add evidence (2026-10-04).** The Evidence screen has an **Add skill**
  form: a skill name and kind plus its first piece of evidence (what you did, where, how
  deeply, last used, optional role or project). A skill with no evidence can't be used for
  anything, so the two are added together. The evidence is validated *before* the skill is
  created, so a mistake doesn't leave an empty skill. Naming a skill you already have
  (case-insensitive) adds the evidence to it rather than failing on the duplicate. Each
  skill also has **Add evidence**. Both use the existing `POST /skills` and
  `POST /evidence`. New evidence is unverified, and the screen switches to "To review",
  where it appears.
- Seed data must pass `findSeedProblems()` (`packages/db/prisma/seed/guards.ts`) and never
  sets `isVerified` (§7).
- Resume variants are **stale** when any evidence they use is deleted, un-verified or
  changed since they were generated — derived when read, so no write path has to flag
  them; a stale resume can't be approved, reused or saved as a PDF (§13.3).
- Every resume bullet stores the evidence IDs it was built from and passes the code
  checks in §13.1 before it is stored.

---

## 7. The career database (seed reference)

### 7.1 The data

`packages/db/prisma/seed/career-data.ts` encodes this as data; everything is seeded
**unverified** for the user to review, reword and verify.

**COMMERCIAL — CloudCard Inc., Lahore (May 2024–present; title Software Engineer, per
the user's CV — the seed's "Frontend Developer" was corrected 2026-10-02):**
HTML5, CSS, Tailwind CSS, JavaScript, TypeScript, React, Material UI, Ant Design (all
PRODUCTION); React and Angular version upgrades across apps (MAINTENANCE, not primary
development); Ruby, a little (WORKING); PostgreSQL / SQL — migrations, new tables and
columns, joins, stored procedures, query optimizations (PRODUCTION; wording from the
CV); role-based access control via DB configuration (PRODUCTION); full
**API Integration** — writing Ruby functions and classes in the in-house B2C layer
(between the frontend and the core Java backend) that call backend API endpoints, expose
them as **GraphQL** APIs, and consume them in the frontend (PRODUCTION; named and
described by the user 2026-10-02 — GraphQL added as its own commercial skill from that
description); SonarQube error remediation (PRODUCTION); Docker and Docker Compose — the user wrote the
Dockerfiles and compose setups (PRODUCTION, corrected 2026-10-02) but deployed through
CI/CD pipelines they didn't build or own (CI/CD: WORKING); microservices — worked within,
not owned (WORKING).
**Everyday tools (user-confirmed 2026-10-02):** Git, REST APIs, npm (PRODUCTION);
prompt engineering — daily use of AI assistants (WORKING: real, but not "built a feature
that shipped").

**PERSONAL / SELF-TAUGHT:** MERN (MongoDB, Express.js, Node.js) — small learning projects
in 2024, picked back up in 2026 (WORKING, never commercial). pnpm, incl. workspaces
(WORKING, Shortlist project). **Learning (EXPOSURE, user-stated 2026-10-02):** Next.js
(Manzil — *corrected from WORKING*), NextAuth, and the Shortlist stack — NestJS, Prisma,
Redis, BullMQ, Zod, TanStack Query, Vite, Vitest — worded as "learning while building
Shortlist; not yet able to build with it independently", because much of Shortlist's
code is written with an AI assistant while the user learns each layer. These move to
WORKING only when the user says they can build with them alone.

**ACADEMIC:** Python, Flask, Django, Java, C++, .NET — coursework, last used 2023
(EXPOSURE; already stale under the 2-year rule, kept in the database but never shown).

Dates known only to the year use July 1 of that year. The user supplied the university
and MERN dates (2026-10-01) rather than letting them be guessed, and on 2026-10-02 the
context (CloudCard vs personal) and depth of every newly added skill. Projects:
CloudCard (role), Manzil and Shortlist (personal, not shipped).

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

### 7.4 After bootstrap the database is canonical (decided 2026-10-02)

The seed is a **one-time bootstrap**, not the source of truth. Once the user has edited,
reworded or verified evidence in the app, the database is canonical and the seed file is
not kept in sync — re-running it is harmless (it's additive) but it would not reflect the
user's own edits. New career facts go in through the app (or a reviewed one-off data
change applying the same un-verify rules), never by extending `career-data.ts`, which
would also have to carry personal data that must stay out of the repo.

### 7.5 Reconciling the CV with the database (2026-10-02)

The user's CV (`numan software engineer.pdf`, kept outside the repo) was compared with the
database. Every discrepancy was put to the user, and nothing was resolved by guessing:

- **Title:** the CV says *Software Engineer*; the role was changed and its 24 linked items
  un-verified (a claim change).
- **Docker / Docker Compose:** "I wrote Docker/compose setup and files but didn't own
  the pipelines" → PRODUCTION for Docker/Compose (reworded), new **CI/CD** COMMERCIAL
  WORKING ("deployed through existing pipelines; did not build or own them").
- **CV-only claims, added as unverified for the user to review** (user's choice): SQL
  reworded (joins, stored procedures, query optimizations); **Performance optimization**
  (lazy loading, dependency upgrades, cleanup); **Angular** development (PRODUCTION —
  the seed only had upgrades); the two CloudCard projects from the CV, **Digital Banking
  Platform (Web & Mobile)** and **Bank Portal (Enterprise Banking System)**, linked to
  the role, each CV bullet becoming evidence under Responsive Design, REST APIs,
  Component architecture or Role-based access control; Manzil's description.
- **CV skills with no stated context** (Redux, Context API, RxJS, Bootstrap, MySQL,
  Postman, GitHub, Cursor, WebStorm, DBeaver, Vercel): recorded cautiously as
  PERSONAL / WORKING with a placeholder `whatIDid` that tells the user to fix it with
  **Edit** (where, how deeply, own words) before verifying. Understating is safe;
  overstating is the Azure incident.
- **Contact details and education** (phone, LinkedIn, GitHub, location, BS IT at the
  University of the Punjab 2019–2023) went into the Profile — database only.

Result: 63 evidence items, 19 verified, 44 to review. Tailoring only ever sees the
verified ones.

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
- **Rate limits on login and register (built 2026-10-04).** Hand-rolled
  (`apps/api/src/rate-limit/`), with Redis counters (§4):
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

### 8.4 Web UI design system (2026-10-02)

Redesigned after reviewing every screen with the user's real scored jobs (before: ~2½
jobs per phone screen, the score a small corner badge, three rows of controls above the
first job, inline details pushing the list down, no overview, no dark mode).
- **Semantic color tokens** (`apps/web/src/index.css`: `bg`, `surface`, `fg`, `muted`,
  `accent`, `apply`/`stretch`/`skip`, `danger`, …) mapped into Tailwind with
  `@theme inline`. Components use only these names, never raw palette colors, so **dark
  mode is automatic** (`prefers-color-scheme`) and a rebrand is one file.
- **Shared primitives** (`components/ui.tsx`): Button, IconButton (accessible name
  required), Badge (tones), Card, Skeleton, Switch (`role="switch"`), Segmented
  (`<fieldset>` + hidden legend), TextField, EmptyState. Icons: lucide-react
  (tree-shaken).
- **Navigation:** a bottom tab bar on phones (thumb reach, safe-area aware) and top
  navigation on desktop; Evidence shows a "to review" count; sign-out lives in an
  account menu (closes on outside tap and Escape).
- **Jobs:** the **score ring** leads every row; the source and icon actions (open
  posting, interested, skip — 40px tap targets) sit in a footer row, so a row is only as
  tall as its content; company-board jobs say "company site" rather than repeating the
  company; moving a job out of the list shows a toast with **Undo**; verdict filter chips with counts; with no filter and
  best-match order, **SKIP jobs fold into "Show N weaker matches"** (never hidden for
  good). Detail is its own route (`/jobs/:id`): **full screen on phones, a side panel
  beside the list on desktop**; score card → why it fits → gaps → risks → description
  (collapsed). **List state lives in the URL** (`?tab=&verdict=&sort=`), so back
  navigation restores it.
- **The Jobs tab returns to where you were (2026-10-04).** Previously the tab always
  linked to `/`, so if you left a job while its resume was tailoring, tapping Jobs dropped
  you at the top of the list. Now, from another page, it links back to the last jobs URL
  you were on (that job, with its list state); tapping it while already in Jobs goes to the
  list and keeps its tab and filters, which is how a tab bar normally behaves.
- **Leaving a page never stops work, so nothing blocks navigation (2026-10-04).** The user
  asked to "protect routes" while tailoring. Tailoring runs in the worker, so leaving the
  page can't break or cancel it, and blocking navigation would add friction without
  protecting anything. Instead, a slim **"Tailoring resume · <job> · 0:42"** bar under the
  header (`GET /resumes/active`) is shown on every page except that job's own page, and
  links back to the job.
- **Found time on every row (2026-10-04):** "Found 2d ago" (`discoveredAt`) leads the row
  footer, so it survives truncation on a phone, and it's the **only** time on the card (the
  user's choice). The aggregator posting age moved off the card. It is still shown on the
  job's detail page, aggregators only (§9.6). The footer keeps the source name, which the
  aggregators' terms require.
- **"Find new jobs" (2026-10-04)** heads the New tab and the Sources page (one component,
  `FindNewJobs`): "Last checked 2d ago" (latest `lastRunAt` among enabled board sources),
  the nightly run's time (read from the BullMQ scheduler in Redis), a live "Checking 3
  sources…" while runs are RUNNING, a warning when no worker is running, and when the
  cooldown lets sources be checked again. The button calls the existing
  `POST /discovery/run` (§9.9).
- **Jobs by source (2026-10-04):** a source's "24 jobs" on the Sources page, and "View
  jobs" for an alert portal on the Gmail card, open `/?source=<id>&tab=all`. The list is
  filtered by `GET /jobs?sourceId=`, an **All** pipeline tab appears only in this view
  (the count covers every stage), and a dismissible "Only jobs from Indeed alerts" bar
  clears the filter.
- **Honest display:** a company board's publish date is not shown (a listed job is open,
  §9.6) — only aggregator posting ages; locations are normalized ("pk" → "PK"); a work-
  mode badge is dropped when the location already says it.
- **Sources:** AI spend as stat tiles; sources needing attention (FAILED/EMPTY) listed
  first; healthy rows carry no badge; real switches.
- Every screen was verified in a headless browser at phone (390px), tablet (768px) and
  desktop (1280–1440px) sizes, in light and dark, including interactive states (menus,
  editing, errors, toasts), against a copy of the user's real data. A second audit pass
  caught: `m-0` on `<fieldset>` wiping the parent's `space-y` gap (controls touching
  content), tall rows from stacked icons, repeated company names, a menu that didn't
  close, and no feedback when a job left the list.

### 8.4.1 Mobile design from Claude Design (2026-10-04)

The user generated a mobile design in Claude Design from a prompt describing Shortlist's
real screens, data and tokens, and asked for it to be implemented. That's 14 boards: jobs
list and its states, job detail, status sheet, resume-card states, resume review, Evidence,
Add skill, Sources, Profile, Sign in, patterns (sheets, toast, install prompt), a
component sheet and a motion spec. It is implemented in the existing React + Tailwind PWA:
**no native app and no rewrite**. Phones get the design; wider screens keep a top bar and
the list/detail split.
- **Tokens:**
  - The existing names are kept (so every screen inherits the look), with the design's
    values.
  - Added: `accent-fg` / `accent-soft` / `on-accent` (the primary button is now the green
    accent, not near-black), `scrim`, `glass` (frosted bars), `toast-accent` and
    `shadow-card`.
  - Font: **Geist**, bundled from `@fontsource-variable/geist`, not a CDN, so the installed
    app works offline.
  - Motion: 150–250ms with one easing curve; reduced motion turns movement into fades.
- **Primitives** (`ui.tsx`): 44px touch targets; `Button` gains `tinted` and `lg`;
  `buttonStyles()` styles a real link as a button; plus `Chip`, `SectionLabel`, and
  **`Sheet`**. The sheet is built on the native `<dialog>`, whose `showModal()` gives focus
  trapping, Escape to close and an inert background for free. It's a bottom sheet on phones
  and a centred dialog on wider screens.
- **Shell:**
  - Large 30px page titles with the account avatar beside them on phones.
  - The account menu became an account sheet.
  - A frosted tab bar, which is **hidden on pushed screens** (a job and its resume), where
    the screen has its own back link and bottom action bar.
  - The tailoring indicator became the design's dark floating pill above the tab bar.
- **Jobs list:** tab counts from a new `GET /jobs/counts` (per status, optional `sourceId`).
  The freshness card reads "Check for new jobs", and shows "Available again in 3h" during
  the cooldown when there's no Gmail to check. Verdict chips with dots; "N matches · Best
  match" sort toggle; empty state with "See Interested"; an error state with Try again.
- **Job detail:**
  - Score hero; "Why it fits" maps each requirement to a verified-skill chip; Gaps end
    with "Have experience here? Add evidence"; Risks; the description collapsed under
    "Read more".
  - A sticky bar with **status ▾ + Open posting**. Status changes moved into a **status
    sheet** (Shortlist / Pipeline / Closed, plus "Move back to New"), which replaced the
    separate Interested, I applied and Skip buttons and the stage dropdown.
- **Resume card:** the design's states (reuse offer, tailor, tailoring, stalled, ready,
  approved, out of date, failed, deferred with a link to the budget). Re-tailoring a
  current resume asks in the design's confirm sheet.

**Deliberately not copied from the design:**
- The design's sample resume (a Summary section, different layout, and an "Azure AD B2C"
  bullet, a known false claim, §7.2). The document stays matched to the user's CV
  (§13.1).
- **Step-by-step tailoring progress** ("Picked 9 items → Writing bullets → Checks"): the
  worker reports no steps, so it would be fake. Instead there's an elapsed timer and an
  indeterminate bar.
- **"Forgot password?":** there's no email sending.
- **Posting age on job rows:** the user's choice (only the found time).
- **New features the design implies:** editing a failing source's URL, cancelling a
  tailoring run, adding or editing roles and projects on Profile, and swipe gestures.
  These are left for later, as separate work.

Verified in a headless browser at 390×844 in light and dark, against a **copy** of the
user's database on separate ports. Chrome is driven directly over the DevTools protocol;
no Playwright is installed.

**Phase 3 and a fidelity pass (2026-10-04).** The user doubted that the screens followed
the boards exactly. Each implemented screen was then rendered **side by side with its
board at the same size**, and every difference was listed and fixed:
- **Fixes to phases 1–2:**
  - two-line card footer ("via …" over "Found …");
  - "82 / of 100" in the hero ring;
  - a factual fit line, "4 of 5 required skills backed by verified evidence", computed
    from the requirements;
  - a status button that no longer truncates;
  - a green "Done" and "Applied" (not "I applied") in the status sheet.
- **Phase 3:**
  - **Evidence:** a progress card and collapsible skill groups, with groups needing review
    first; a collapsed group shows "N to review".
  - **One evidence sheet** for adding a skill with its first evidence, adding evidence and
    editing. Context and Depth are segmented controls with a plain-language hint. Edits
    send only what changed and warn that they un-verify; new evidence is always
    unverified. The design has no **Kind** field, but every skill needs a category, so a
    compact Kind picker sits beside the name.
  - **Resume review:** the page is shown at its real width, scaled to fit the phone, and
    printing undoes the scaling. **Tapping a bullet opens a sheet with the evidence behind
    it** (the user's words, context, depth, verified, date); this replaced the "Show
    sources" switch. "Removed by checks" is listed with reasons, there's a sticky Approve
    bar (Save as PDF once approved), and a faint DRAFT watermark. A printed check caught a
    regression: an inline-block button's baseline is its *last* line, which dropped every
    "●" to its bullet's last line in the PDF. The bullet button is now `block`, and
    positions were re-measured against the CV (within 1pt).
  - **Sources:** an AI-spend tile with a "Budget" link to Profile, a **Today** tile (new
    `last24hUsd` on `/ai/usage`), a **Jobs this week** tile (new `jobsThisWeek` on
    `/discovery/status`), and "Needs attention" with a **Retry for that one source**
    (new `POST /discovery/sources/:id/run`, same cooldown, 409 with the time it can run
    again). Then the Healthy list and the Gmail card ("Connected as …", On, Check now /
    Disconnect). Finding new jobs lives on the Jobs page only.
  - **Profile:** a back link, Edit (opens the contact sheet), an identity header, and
    Experience / Projects / Education (education opens an edit sheet, and there's "Add
    education"). The budget moved here: a monthly-cap stepper (the middle is editable and
    an emptied field never becomes $0) and the resume-reuse slider. Account: Gmail and Sign
    out.
  - **Sign in:** the mark and promise up top; a Sign in / Register switch; a password
    show/hide toggle.
  - **Install prompt:** on Chrome/Android it keeps `beforeinstallprompt` and installs from
    a button; on iPhone Safari it shows the two taps. Never shown inside the installed app,
    and "Not now" is remembered on the device.
- **Appearance (the user asked for it; the design has no control):** **System / Light /
  Dark** in the account sheet. The dark tokens apply under
  `prefers-color-scheme: dark` *unless* `<html data-theme="light">`, or always under
  `data-theme="dark"`. The choice is stored per device in `localStorage` and applied by
  an inline script in `index.html` **before the first paint** (no flash), and the
  status-bar colour follows it.
- **Done next (2026-10-05)**; see "Interactions and motion" below.

### 8.4.2 Interactions and motion (2026-10-05)

The design's remaining features, and every animation in its motion spec ("subtle and
fast: 150–250ms", easing `cubic-bezier(.2,.8,.2,1)`, exits `ease-in`):
- **Push (row → detail, detail → resume review):** the new screen slides in from the right
  in 240ms while the old one moves 30% left and dims to 70%; back reverses it in 200ms.
  The score ring is a **shared element** that grows from 44 to 88px. This uses the **View
  Transitions API**, with these choices:
  - **No react-router `viewTransition` option.** It only works with the data router, and
    this app uses `<BrowserRouter>`. `PushLink` / `pushNavigate()` call
    `document.startViewTransition` directly.
  - **The callback waits for the route to commit.** Its promise resolves from a layout
    effect (`<RouteCommitted>`), because react-router applies navigation as a
    low-priority update that `flushSync` can't force. Without this the browser snapshotted
    the *list* as the new screen.
  - **Only the tapped card's ring carries the transition name** (`nameSharedRing`). When
    every ring had one, the untapped rings stayed put while the list slid away.
  - **The job is prefetched for up to 250ms before pushing**, so the detail ring is there
    to grow into.
  - Phones only; wide screens show list and detail side by side.
  - Browsers without the API just navigate.
  - These were verified by probing the running animations (one `root` push, one
    `ring-<id>` group, both old and new) and by a capture at 1/10 speed.
- **Edge-swipe back** (40% of the width, or a flick that has also travelled 15%). It is
  enabled **only in the installed app**, because a browser tab has its own edge swipe and
  two gestures on one edge would fight.
- **Bottom sheet:**
  - in 240ms, out 180ms ease-in (the sheet stays rendered while it slides), and the
    backdrop fades;
  - **drag the handle down to dismiss** (past 30% of its height, or a flick that has
    travelled at least 40px);
  - focus moves to the sheet itself, not its first button, because a ring there looked
    like a selection on a phone.
- **Swipe a job row** (`useSwipeRow`):
  - the row follows the finger over a green "Interested" or grey "Skip" layer; only a
    mostly-horizontal drag counts, with `touch-action: pan-y pinch-zoom`;
  - past 35% the icon grows to 1.15× with a light haptic (`navigator.vibrate`, which
    Android supports and iOS ignores);
  - released past that, the row exits in 180ms, the gap closes in 200ms, and *then* the
    status is saved and the Undo toast shows; the ★/✕ buttons play the same exit;
  - **Undo slides the row back** from the side it left (200ms).
  - New: right → Interested, left → Skip. Interested: left → back to New. Skipped: right
    → back to New.
- **Toast:** rises 12px and fades in (200ms), stays 5s, then drops out (200ms). **The
  tailoring pill** rises 8px.
- **Reduced motion:** movement becomes 150ms fades, view transitions become a crossfade,
  spinners stay, and skeleton pulses stop.

The features:
- **Roles and projects are editable on Profile** (add, edit, delete; `CareerForms.tsx`).
  Forms validate with the shared schemas and send only changed fields. A claim change says
  it will un-verify linked evidence, and deleting asks first and says what happens.
- **"Edit URL"** on a failing company board: `PATCH /discovery/sources/:id/address`.
  `parseBoardAddress()` (shared) accepts the board's link or bare name for Greenhouse,
  Lever, SmartRecruiters and Workable, refuses links to another platform, stores only the
  board name, and clears the cooldown so Retry works at once. Aggregators have fixed
  addresses. Sources now return `board`.
- **Cancel a tailoring run:** `POST /jobs/:id/resume/cancel`. A run still waiting (or in
  retry backoff) is removed from the queue, found via its deduplication id, so nothing is
  charged. One the worker has started returns 409, because its Claude call is in flight.
  The job's previous resume is kept.
- **"···" menus.** The design shows them but not their contents, so these were chosen to
  be useful and already supported:
  - **Job:** copy the posting link, score again, skip / move back to New.
  - **Resume review:** **copy as plain text** (for application forms that want pasted
    text, in the printed order, without removed bullets), tailor again, open the job.

### 8.5 Other security decisions

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
- *Remote:* passes only if the location is empty, names a worldwide term (worldwide,
  anywhere, global, international), or names **only** allowed regions
  (`remoteAllowRegions`: remote, Asia, APAC, South Asia, Pakistan, Lahore). "Remote - LATAM"
  fails on "latam". **An allow-list, replacing the original block-list** (2026-10-02): the
  first real run let through roles limited to Poland, Argentina, France, South Africa,
  Nepal… — a block-list can never name every country that can't hire from Pakistan, and
  the filter's job is to err on the side of dropping. An allowed on-site place still wins
  ("USA, Pakistan" passes on "pakistan").
- *No location and unknown work mode:* benefit of the doubt (common on company boards).
- *Posting age (30 days):* **aggregators only** — on a company's own board a listed job is
  open (§1.3).
- *Matching:* case-insensitive, whole-word on non-alphanumeric boundaries — "react"
  matches "React.js developer" but not "reactive"; "next.js" and "c++" work.

**Alert jobs (2026-10-03):** a job read from an email has no description, so stage B
can't run. Instead the **summary stage** passes it if a stack keyword appears in its
title or summary, **or** its title names a software role (`roleTitleTerms`: software,
full stack, frontend, web developer, …). This keeps "Full Stack Engineer" whose summary
names no technology, and drops "Associate Electrical Engineer" — from the first real
Gmail check, where stage A alone let 8 such roles through. Borderline roles (a PHP
full-stack job) pass and are left to scoring. Like every filter setting, the list is a
`DiscoveryPreferences` column with a default in shared.

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

**Updated 2026-10-04: one "Find new jobs" button.** At the user's request the button
is on the Jobs page (New tab) as well as on Sources. It also queues a check of the Gmail
alert label when Gmail is connected (best effort, since the inbox is checked every two
hours anyway), so one tap covers every source. Each source job now carries a
**deduplication id** (`discover-<sourceId>`), so tapping again, or tapping while the worker
is stopped, joins the job already queued instead of piling up duplicates. The cooldown alone
can't prevent that, because `lastRunAt` only moves when a run *finishes*.
`GET /discovery/status` returns `{ enabledSources, lastCheckedAt, running, availableAt,
nextNightlyAt, workerOnline, cooldownHours }`. A RUNNING run older than 30 minutes is
treated as crashed, not still running. The button only queues work; the worker does the
fetching. With no worker running, the UI says so instead of showing a spinner.

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

## 10. Email job alerts (built 2026-10-03)

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
- **Built 2026-10-03 — how the connection works** (`apps/api/src/gmail/`,
  `packages/shared/src/node/google.ts`), hand-rolled with `fetch`, no googleapis SDK:
  - **Authorization-code flow with PKCE.** "Connect Gmail" asks the API for Google's
    consent URL (scope `gmail.readonly` only; `access_type=offline`, `prompt=consent` so a
    refresh token always comes back). The browser goes to Google and back to
    `GET /api/v1/gmail/callback`. The code is useless without the PKCE verifier, which
    never leaves the server.
  - **Who is this redirect for?** A redirect carries no bearer token (it lives in memory
    in the tab), so the attempt is identified by a random single-use **state** (stored
    hashed, 10-minute life) — and bound to the **browser** by an httpOnly nonce cookie
    (`shortlist_oauth`, Path=/api/v1/gmail/callback, SameSite=**Lax**: Strict would not be
    sent on Google's cross-site redirect). Without the cookie check, an attacker could send
    someone their own consent link and attach the victim's mailbox to the attacker's
    account (OAuth login CSRF); a test covers exactly that.
  - **Scope check:** Google lets the user untick a scope; the callback refuses a grant
    without read access.
  - **Token at rest:** only the refresh token is stored, encrypted with AES-256-GCM
    (`SecretBox`, key `TOKEN_ENCRYPTION_KEY`), with the user's id as additional
    authenticated data so a ciphertext copied to another row won't decrypt. Access tokens
    are minted per check and never stored. The status endpoint never returns the token.
  - **Disconnect** revokes the grant at Google, then deletes the row.
  - **Health is visible:** each check records status (SUCCESS / EMPTY / FAILED), time,
    count and error on the connection; a revoked grant (`invalid_grant`) or an
    undecryptable token sets `NEEDS_RECONNECT` and the Sources page asks to reconnect; a
    missing label fails visibly without retries.
- **Google setup gotcha:** while the OAuth consent screen is in "Testing" status, refresh
  tokens expire after 7 days. Set the app to "In production" for personal use; the user
  sees an "unverified app" warning once (expected for a personal tool). Selling the
  product later would require Google's verification for this restricted scope (§1.4).

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
     throws), the model reads it instead and the message records a note; the Sources page
     shows "<portal>'s email layout may have changed — read by AI for now". A redesign is
     a visible warning, not silently missing jobs.
  6. Each portal's jobs are recorded as a `DiscoveryRun` against its `EMAIL_INBOX` source
     (`email_alerts:<portal>` — the seeded LinkedIn/Rozee.pk/Wellfound/remote.co rows,
     created on first use for others). Email sources are never run by the nightly
     fan-out or "Run now", and are shown on the Gmail card, not the board list.
  7. Same stage-A filter as boards (posting age not enforced: an alert is new by
     definition), then the **summary stage** (§9.6, `roleTitleTerms`), the same dedupe,
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

## 12. AI pipeline — extraction and match scoring (built 2026-10-02)

### 12.1 The model reads; the code decides

**Decision:** Claude never produces the score. Haiku reads the posting and maps each
requirement to the user's verified skills; deterministic code
(`packages/shared/src/scoring.ts`) turns that mapping into the score, verdict, gaps,
strengths and risks. Rejected alternative: asking the model for a 0–100 score. Why:
- **Explainable** — every point traces to a requirement and a piece of evidence.
- **Deterministic** — the same inputs always give the same score; LLM scores drift.
- **Can't add skills** — the model may only point at skills from the list it is given
  (as short refs `S1…Sn`); unknown refs are dropped in code. The Azure safeguard is
  structural, not a prompt instruction.
- **Re-scoring is free** — when evidence changes, jobs are re-scored from the stored
  mapping with no model call.
- **Testable** — the scoring rules are plain unit-tested functions.

```
discovery stores NEW jobs ──► analysis queue: analyze-job (one per job)
nightly 03:00 Asia/Karachi ──► analysis-sweep: re-score DONE jobs (free), re-queue
                               PENDING/DEFERRED jobs up to what's left of the daily cap

analyze-job:
  1. budget guard (§12.3) — over budget/cap → DEFERRED (no call)
  2. no verified evidence → DEFERRED (no call)
  3. prompt: VERIFIED skills only (name + category, as refs) + the posting in
     <job_posting> tags, marked as untrusted data (prompt-injection hygiene)
  4. Haiku 4.5, structured output (hand-written JSON schema)
  5. log tokens + cost to AiUsage — always, even if the output is then rejected
  6. Zod-validate; drop unknown refs; score in code; store requirements/match/gaps → DONE
```

**What the model returns per requirement:** canonical skill name, importance
(REQUIRED / PREFERRED / BONUS), `isCore` (central to the role), years if stated,
`sameAs` (exact or direct-equivalent skills: React.js = React) and `relatedTo`
(transferable but **not** the same: PostgreSQL for MySQL, Express for NestJS). Plus the
posting's seniority, overall years, and red flags (scam signals). It is told not to
judge experience — only same / related / absent. Evidence text (`whatIDid`) is not sent.

**Exact names are decided in code:** after the model's mapping, a requirement whose
normalized name equals a verified skill's name (case, punctuation, a trailing ".js",
plural "s" — "Prompt Engineering" = "Prompt engineering", "React.js" = "React") is that
skill (`promoteExactNameMatches`). In the first real run the model filed the user's exact
"Prompt engineering" as merely *related*. Applied on analysis and on re-scoring.

**Alternatives are one requirement:** "AWS, GCP or Azure" becomes a single requirement
"AWS / GCP / Azure" (prompt rule). In the first real run Kwanso's five cloud options
became five separate gaps, pulling a fitting role below the SKIP line.

**Scoring rules** (`scoring.ts`):
- Evidence strength by context × depth: COMMERCIAL production 1.0, maintenance/working
  0.6, exposure 0.3; PERSONAL production 0.7, working 0.5; ACADEMIC ≤ 0.4. Stale (> 2
  years) evidence × 0.6, and stale EXPOSURE counts 0 (§6.1).
- Requirement weight: REQUIRED 3, PREFERRED 1.5, BONUS 0.5; core × 1.5.
- A `sameAs` match earns its best evidence strength; a `relatedTo` match earns **half**
  and the requirement still appears as a gap ("related experience: …") — never claimed.
- `overallScore` = weighted satisfaction %; `commercialScore` counts COMMERCIAL evidence only.
- Gaps: missing core REQUIRED → BLOCKING (softened to MODERATE by related experience);
  missing REQUIRED → MODERATE; missing PREFERRED/BONUS → MINOR.
- Verdict: **SKIP** if score < 45, ≥ 2 blocking gaps, or no requirements; **APPLY** if
  score ≥ 70 with no blocking gap, no red flag, and the posting's years not more than
  2 above the user's commercial years; otherwise **STRETCH**.
- Commercial years are computed from role dates (overlaps not double-counted).

**Implementation choices:**
- **Hand-written JSON schema** for structured output: the SDK's Zod converter turned
  enums into descriptions (not enforced by the API). A test keeps it in sync with the
  Zod schema, which still validates every response before storage.
- **Errors by type:** 429/5xx/network → retried by the SDK (×2) and the queue (×3,
  backoff); 400/401/403/404 → FAILED, not retried; **out of credit → DEFERRED** (runs
  after a top-up); invalid/truncated (`max_tokens`)/refused output → FAILED, not retried
  (it would likely fail again and cost again).
- **Never billed twice concurrently:** every enqueue path (discovery, nightly sweep, API
  "Retry") uses BullMQ `deduplication` keyed by job ID, so while an analysis is waiting,
  in retry backoff or running, further adds join it. The BullMQ job ID still includes
  the batch, so a job deferred today can be queued again tomorrow. (Found in code review:
  the sweep and "Retry" could otherwise start a second billed call for the same job.)
- **Re-analysis only when it can change the answer:** each analysis records the
  verified skills the model saw (`Job.analyzedSkillIds`). The nightly sweep re-scores
  from the stored mapping when evidence is un-verified or edited (free), but when the
  user has *verified a new skill* the model never saw, the stored mapping can't contain
  it — the job goes back to PENDING for one fresh, budget-guarded analysis, its old
  score visible meanwhile. "Retry" on an analysed job is allowed only in that case
  (409 otherwise), so a click can't re-bill an unchanged analysis.
- **Discovery isn't failed by analysis plumbing:** if queuing new jobs for analysis
  fails, the discovery run still succeeds (retrying would re-fetch and find nothing
  "new"); the nightly sweep picks the jobs up.
- **Job IDs never contain ":"** — scheduler-fired batch IDs (`repeat:<id>:<millis>`) are
  sanitized; BullMQ tolerating exactly two colons is a quirk, not a contract.
- **Separate `analysis` queue** with concurrency 2 (`ANALYSIS_CONCURRENCY`), so model
  calls never compete with discovery and rate-limit pressure stays low.
- **No prompt caching:** Haiku 4.5 caches only prefixes ≥ 4,096 tokens; ours is ~2–3K,
  so a cache marker would do nothing. Revisit if the prompt grows or the model changes.
- **No Batch API yet:** at ~10 jobs/night it would save ~$1/month while adding a
  submit-and-poll state machine; manual "Add a job" needs immediate results anyway.
  Revisit if volume grows.

**First live call (2026-10-02):** Septem Systems' *Full Stack Software Engineer (MERN)*
on a test profile — mapped React/TS/JS/MongoDB/Express/Node exactly, NestJS → related
Express/Node, MySQL → related PostgreSQL; an unverified "Azure B2C" skill never reached
the model. 2,790 input + 667 output tokens = **$0.006**. Scored 42 (SKIP): personal-only
MERN counts at half strength, and generic PREFERRED items (Git, REST APIs, testing…)
were absent from the test profile. **Lesson: a score can only be as complete as the
user's verified evidence.** Weight calibration is an open decision (§17.3), to be done
on the user's real scored jobs rather than one sample.

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
- Scoring: measured **~$0.006 per job** (≈ 2.8K input + 0.7K output tokens, no batch,
  no cache — §12.1) → at ~10 new jobs/night **≈ $1.80/month**.
- Tailoring: ~$0.015–0.03 per resume; with the resume library reusing approved variants,
  ~30 new resumes/month → **~$1/month**.
- Source discovery via API web search: ~$0.50 per monthly run (or $0 if done by hand in
  claude.ai).
- **Total ≈ $3–4/month.** The user's initial $5 of credits lasts a bit over a month at
  that rate; the budget guard (§12.3) caps it either way. (The original
  plan's ~$11/month assumed 30 jobs/day reaching AI; real deduplicated volume is far
  lower.)
- Infrastructure when deployed: free tiers for Neon, Upstash, Vercel; ~$5–7/month for an
  always-on worker host; domain ~$12/year.

### 12.3 Budget guard (built 2026-10-02)

So a bug or a sudden flood of "new" jobs can't drain the credits in one night:
1. **A monthly spend limit set in the Anthropic Console** (account-level hard stop) —
   set by the user.
2. **In the worker** (`BudgetGuard`), checked before every model call, from the
   `AiUsage` log (so it counts billed calls whose output was rejected, too):
   month-to-date spend vs `monthlyBudgetUsd` (default **$4.50**) and analyses in the
   last 24h vs `maxAnalysesPerDay` (default **40**). Over either → the job is
   **DEFERRED** with the reason shown on its card, and the nightly sweep retries it —
   never silently dropped. Settings are an `AiSettings` row per user (defaults in
   shared), editable on the Sources page; month-to-date spend is shown there
   (`GET /ai/usage`). With 2 parallel calls a burst can overshoot a cap by at most 2.

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

## 13. Resume tailoring, the resume library, and the application kit

### 13.1 Tailoring (built 2026-10-02)

**The model words; code decides what may be claimed** — the same split as scoring (§12.1).

- **Trigger:** only the user, from a job they marked Interested ("Tailor a resume",
  ≈ $0.03). "Tailor again" on a resume that is still current asks for a second click
  (it costs money and replaces a reviewed resume); an out-of-date one re-tailors directly.
  While a new attempt runs, fails or is deferred, the job's existing resume stays
  reachable on its card (code review, 2026-10-03).
  Nothing tailors automatically, so no score threshold is needed yet. The job
  must be scored: tailoring works from the analysis's requirement list.
- **Model:** Sonnet (`AI_MODELS.tailorResume`) — writing is where quality shows. Budget
  guard: the monthly cap only (the daily cap is for nightly analysis). Same rules as
  analysis: every call logged to `AiUsage` (`TAILOR_RESUME`) before its output is used,
  out-of-credit/over-budget → DEFERRED, invalid output → FAILED with no retry, a
  transient error that exhausts its retries → FAILED (never "Tailoring…" forever).
  Own queue (`resume`, concurrency 1), deduplicated per job so a double-click can't pay twice.
- **Never an endless spinner (2026-10-04).** This was found when the user saw "Tailoring…"
  for over ten minutes while the page kept polling, even across reloads. The cause was
  that no worker was running. Nothing was charged, because the model was never called. Now:
  `GET /jobs/:id/resume` returns `queuedAt` and `workerOnline` while PENDING. The card
  shows the elapsed time ("0:42 · usually under a minute — you can leave this page").
  With no worker it says so, and that nothing has been charged. After 2 minutes it says
  it's taking longer than usual. After 15 minutes it stops polling, says something is stuck
  and offers "Check again". Polling backs off: every 3s for the first minute, then 10s,
  then 15s while no worker runs, then not at all (`tailorPollInterval()`). A real run is one
  Sonnet call, typically 30–90s.
- **What the model sees:** verified evidence only, each item as an `E`-ref listed under
  the role/project it may appear in (placement rules, `placementFor()` in
  `packages/shared/src/resume.ts`); skills as `S`-refs with their strongest level, those
  known only at exposure marked "learning"; roles `R`, projects `P`; the requirement list;
  the description (≤ 8,000 chars) as untrusted data. It returns bullets (optional bold
  label + one sentence + the refs it relies on) and skill groups — refs only.
- **What code checks, per bullet** (`checkBullet()`); a failing bullet is removed and
  shown to the user with the reason, never printed:
  1. it cites at least one item, all of them known and verified;
  2. each cited item is allowed in that section **and** belongs there (a role's own items
     or its projects' items for Experience; that project's items for Projects) — personal
     work can't become an Experience bullet;
  3. no "Azure" anywhere; no Node.js/Express in paid work (§7.2);
  4. no number that isn't in the cited items' own words (no invented metrics). Numbers are
     compared **whole**: digits inside a word ("B2C", "HTML5", "2019") are not numbers.
     Found in code review (2026-10-03): a substring match let "2 years across 19 services"
     pass because the evidence said "B2C … since 2019", and refused "HTML5";
  5. no technology named that it doesn't cite — a name counts as covered if it's a cited
     item's skill, the posting's name for it (from the analysis's exact matches), or
     named in the cited items' own text; "APIs" inside a covered "REST APIs" doesn't count;
     short names ("Go") match case-sensitively so "go live" isn't a claim;
  6. building verbs (built, developed, designed, led, owned…) only if a cited item is
     PRODUCTION or the user's own words use that verb — "working" and "maintenance" can't
     be inflated.
  Limits: 6 bullets per role, 3 per project. Every role is listed (a resume doesn't hide
  jobs); a project with no surviving bullet is left out.
- **Skills section:** only skills placeable in Skills (§6.1). A skill whose verified
  evidence is all EXPOSURE goes in a **"Learning"** group that code labels, whatever the
  model did — listing NestJS beside React would overstate it (decided 2026-10-02).
- **Layout:** the user's own CV (centred name and contact line; Experience with bold
  bullet labels; grouped Skills; Projects; Education) — no summary, because their CV has
  none. Header and education come from the Profile (§5.2). Role-linked projects appear
  under Projects, as on the CV.
- **Bullet wording matched to the CV (2026-10-04).** The first real runs' Experience
  bullets averaged 20 words (up to 35), against 12 in the user's CV. They repeated the
  company name already in the heading, merged unrelated items into run-on sentences, and
  stated what the candidate *didn't* do ("without owning the services"). That last habit
  came from the prompt's "keep qualifiers" rule. The prompt now asks for at most 18 words
  (never more than 22), one topic per bullet, no company or role name, and the scope
  stated positively with the candidate's own limiting words ("existing pipelines"). It
  sets **no minimum length**: a "10 to 18 words" draft made the model pad a five-word
  fact with work the evidence didn't describe. A short true bullet beats a padded one.
  Result on the same job: an average of 12.9 words, longest 19, nothing padded.
  - The same run once returned skill **names** instead of `S` refs, which failed the whole
    paid resume at validation. `assembleResume()` now also accepts a skill's exact name
    (case-insensitive), but only for a skill that was offered with an `S` ref. Any other
    name is dropped like an unknown ref, so nothing new can be listed.
  - Validation failures now name the field ("skillGroups.0.skills.4"), not just "too big".
  - **`preview:resume <jobId>`** (worker CLI) runs a real tailoring and prints the bullets
    with word counts *without saving* them (`ResumeService.preview()`, which shares
    `draft()` with `tailor()`). Spend is logged to `AiUsage` as usual, and the model's raw
    answer is printed when validation fails. It's for tuning the prompt on real output.
- **Typography matched to the CV (2026-10-04).** The user found that the Experience and
  Projects bullets didn't look like their CV (`numan software engineer.pdf`, a Google Docs
  export). The page is rebuilt from measurements of that PDF: **US Letter, 1in margins**,
  Arial 11pt on a 15.5pt line, name 18pt, contact lines 12pt. Experience and Projects use
  a large **"●"** and Skills a small **"•"**, both 18pt from the margin with the text at
  36pt, so wrapped lines align with the text. A blank line separates sections and
  projects. The printed PDF was checked against the original with `pdftotext -bbox`
  (positions within 1pt). The markers are a **fixed-width column in a flex row**, not
  absolutely positioned: Chrome writes positioned content to the PDF out of reading order
  (all headings first, then the bullet text), which would garble the text an applicant
  tracking system reads.
- **PDF:** the browser's print → "Save as PDF" on a Letter print stylesheet (app chrome and
  toasts hidden; the page title becomes the file name). No PDF library and no server-side
  rendering: the text stays selectable for applicant tracking systems, and the paper
  stays white in dark mode (`paper`/`ink` tokens).
- **The review page shows the resume as it will print (2026-10-04).** The per-bullet
  sources used to be on by default, in a light-grey box in the resume's own font. The user
  read them as every bullet duplicated in smaller type, "a bugged resume". Now the page
  opens clean, and **Show sources** turns them on as clearly marked review notes (an
  accent edge, the app's UI font, a "From your evidence" label). They are never printed.
- **Review and approval:** the review page shows, under every bullet, the evidence it was
  built from, plus the bullets the checks removed. **"Save as PDF" appears only after the
  user approves**, and approval is refused for an out-of-date resume (409). Approve is its
  own endpoint (`POST /resumes/:id/approve`), like verify, and never optimistic. A draft
  printed anyway (Ctrl+P) carries a "DRAFT — NOT YET APPROVED" banner. The code checks are
  a net; the user's reading is the final gate.

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
  every APPROVED, up-to-date variant** (`resumeOverlap()`: share of the job's normalized
  requirement names, alternatives split, that the variant was built for). If the overlap is high (~85%, tunable) **and** the job has no REQUIRED
  skill the variant doesn't cover → **reuse it at zero AI cost** ("Reusing your MERN Full
  Stack resume — 92% match", with "tailor fresh anyway"). Otherwise tailor a new one and
  store it as a new variant.
- **Built 2026-10-02:** reuse is offered on the job's Resume card (up to 3 offers, with
  the jobs each was used for); the threshold is a setting
  (`AiSettings.resumeReuseMinOverlap`, default 0.85). Only approved resumes are offered or
  accepted (409 otherwise) — reuse skips review, so the reused resume must already have had one.
- **Base variants (not built yet):** the user can create and pin a base resume per niche, each generated
  and reviewed once; most jobs then map to one of them.
- **Why it's worth it:** the API saving is real but small (a Sonnet tailoring run costs
  cents; ~$3/month at expected volume). **The bigger saving is review time** — every new
  resume must be read and approved before it goes out, while a reused, already-approved
  variant needs no second review.

### 13.3 Staleness (built 2026-10-02: derived, never stored)

A resume is **out of date** when any evidence it relies on (`evidenceIds`: every cited
item plus the items behind each listed skill) has been deleted, un-verified, or changed
after the resume was generated (`updatedAt > generatedAt`). `generatedAt` is the moment
the worker **read** the evidence, not when it saved the result: stamping it after the
≈30s model call hid an edit + re-verify made during the call (code review, 2026-10-03).
Staleness is **computed when read**, not flagged on write: every claim change —
rewording, a skill rename, a role edit —
already touches the evidence row (un-verifying it), so no current or future write path has
to remember to mark resumes. Re-verifying an item after an edit doesn't make an old resume
current again: its wording came from the old text. An out-of-date resume can't be
approved, reused or saved as a PDF from the app until it is tailored again. Verifying a
*new* item doesn't make a resume stale — it's still true, just less complete.

### 13.4 Schema (built 2026-10-02)

`TailoredResume` (one per `JobMatch`, 0 rows) was dropped and replaced by `ResumeVariant`
and `JobResume` (§5.2). Many jobs can share one variant, and "what did I send Kwanso?" is
answered by the job's `JobResume`.

### 13.5 The application kit (planned)

Per job, ready for the user to submit themselves: the tailored (or reused) PDF; for
"send your CV to <email>" postings, a drafted email opened in the user's own mail app
(`mailto:` with subject/body; the user attaches/sends); drafted answers to common
screening questions (years of experience computed from verified dates); outreach and
follow-up drafts.

### 13.6 Notifications (planned)

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
| PWA | **vite-plugin-pwa** | Manifest + service worker; app shell only (§8.5). |
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

- **E2E tests use their own Redis database (15)** — `createTestApp()` sets it, and specs
  that open Redis directly use `TEST_REDIS_URL`. A development worker listens on database
  0; when both shared it, the worker grabbed jobs the tests had just queued (failing every
  "is it queued?" check) and tried to run test users' fake sources (2026-10-04).

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
| 2026-09-30 | Role/project claim-field edits and deletes un-verify linked evidence; http(s)-only URLs | §6.3, §8.5 |
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
| 2026-10-02 | The model maps requirements to verified skills; deterministic code scores (no model-produced scores) | §12.1 |
| 2026-10-02 | Exact vs related matches: related earns half credit and stays a gap — never claimed | §12.1 |
| 2026-10-02 | Hand-written JSON schema for structured output (SDK converter dropped enums) + Zod validation | §12.1 |
| 2026-10-02 | Out-of-credit → DEFERRED; invalid output → FAILED without retry; analysed jobs never re-billed | §12.1 |
| 2026-10-02 | No prompt caching (below Haiku's 4,096-token minimum) and no Batch API yet (saving too small for the complexity) | §12.1 |
| 2026-10-02 | Budget guard defaults: $4.50/month, 40 analyses/24h; deferred jobs retried nightly | §12.3 |
| 2026-10-02 | Analysis deduplicated per job across all enqueue paths; re-analysis only after a newly verified skill | §12.1 (code review) |
| 2026-10-02 | "Best match" ranks every scored job (two queries), not only the newest 200 | Code review |
| 2026-10-02 | Career data: "API Integration" (Ruby → GraphQL) named by the user; GraphQL, Git, REST APIs, npm commercial; prompting commercial WORKING; pnpm personal; Next.js corrected to EXPOSURE; Shortlist stack added as EXPOSURE ("learning") | §7.1 — user-confirmed, all unverified until reviewed |
| 2026-10-02 | Seed data first, verify, THEN score — scoring before verifying new skills would pay for every job twice | §12.1 re-analysis rule |
| 2026-10-02 | First real scoring run: 30 jobs, $0.18 | §17.1 |
| 2026-10-02 | Exact skill-name matches decided in code; alternatives extracted as one requirement; remote regions by allow-list | §9.6, §12.1 — from the first real run |
| 2026-10-02 | UI redesign: semantic tokens + automatic dark mode, bottom tab bar on phones, score-ring rows, split list/detail, URL list state, SKIPs folded | §8.4 |
| 2026-10-02 | Resume tailoring before email alerts | User's choice (§17.2) |
| 2026-10-02 | COMMERCIAL + WORKING → Skills section + Experience bullets worded as what was actually done | User's choice (§6.1) |
| 2026-10-02 | Profile (resume header fields) and Education tables; personal data in the DB only | §5.2 |
| 2026-10-02 | Projects can belong to a role; the link is a claim field | §5.2, §6.3 |
| 2026-10-02 | Evidence context and depth editable in the UI; the edit un-verifies | §6.3 |
| 2026-10-02 | Seed is a one-time bootstrap; afterwards the database is canonical | §7.4 |
| 2026-10-02 | Tailoring built: Sonnet words bullets citing E-refs; code checks each bullet (placement, belonging, Azure/Node, numbers, uncited technologies, building verbs) and drops failures with a reason | §13.1 |
| 2026-10-02 | Tailoring only on the user's request, from an Interested, scored job | §13.1 |
| 2026-10-02 | Exposure-only skills go in a code-labelled "Learning" group | §13.1 |
| 2026-10-02 | PDF via the browser's print to PDF on an A4 stylesheet, in the user's CV layout; no PDF library | §13.1 |
| 2026-10-05 | Motion spec implemented: View Transitions push + shared ring (manual `startViewTransition`, waits for route commit), edge-swipe back (installed app only), sheet slide-out + drag-to-dismiss, row swipe with Undo return, toast exit; reduced-motion fades | §8.4.2 |
| 2026-10-05 | Roles/projects editing, Edit URL (`parseBoardAddress`), cancel tailoring (dedup id lookup; 409 once running), ··· menus incl. copy resume as text | §8.4.2 |
| 2026-10-04 | Design fidelity pass (side-by-side with each board) + phase 3 screens; System/Light/Dark appearance (pre-paint, per device); single-source retry, today's spend, jobs this week | §8.4.1 — user doubted fidelity, asked for a theme switch |
| 2026-10-04 | E2E tests use Redis database 15, never 0 | §15.3 — a running dev worker consumed the jobs e2e tests queued |
| 2026-10-04 | Mobile design implemented in the existing PWA (tokens, Geist, native-`<dialog>` sheets, pushed screens without tab bar, status sheet, `GET /jobs/counts`); fake progress steps, the sample resume and "Forgot password" not copied | §8.4.1 — user's Claude Design boards |
| 2026-10-04 | Deploy on one VPS with Docker Compose (Caddy for HTTPS, Postgres 18, Redis, API, worker, migrate, nightly backup); DuckDNS hostname; empty env values = unset | §4 — user's choice over free tiers (Upstash quota vs BullMQ polling; sleeping hosts can't run the worker) |
| 2026-10-04 | Tailoring prompt: ≤18 words, one topic, no company name, scope stated positively, no minimum (it caused padding); skill names resolved only to offered skills; `preview:resume` CLI | §13.1 — bullets averaged 20 words vs the CV's 12 |
| 2026-10-04 | Login/register rate limits: Redis fixed-window counters (Lua), failed logins per account + attempts per IP + sign-ups per IP; 429 + Retry-After; fail open; `TRUST_PROXY_HOPS` | §8.1 — roadmap step 8 |
| 2026-10-04 | Resume review opens clean (as printed); per-bullet sources are an opt-in, clearly labelled review note | §13.1 — read as duplicated bullets |
| 2026-10-04 | Resume page matched to the user's CV by measurement: Letter, 1in margins, 11pt Arial, "●" bullets (Experience/Projects) and "•" (Skills) with hanging indents; markers in a flex row to keep PDF text order | §13.1, user request |
| 2026-10-02 | "Save as PDF" only after approval; approve is its own endpoint and refused when stale | §13.1 |
| 2026-10-02 | Resume staleness derived at read time from cited evidence, never stored | §13.3 |
| 2026-10-03 | Gmail connection: authorization code + PKCE; single-use hashed state bound to the browser by a SameSite=Lax nonce cookie (login-CSRF defense); read-only scope verified on return | §10.3 |
| 2026-10-03 | Gmail refresh token encrypted with AES-256-GCM, user id as AAD; access tokens never stored; disconnect revokes at Google | §10.3 |
| 2026-10-03 | Node-only shared code (crypto, Google) behind `@shortlist/shared/node`, never bundled into the web app | §10.3 |
| 2026-10-03 | Inbox checked every two hours + "Check now"; messages recorded once (metadata only); unparsed senders listed | §10.4 |
| 2026-10-03 | Parsers are written against captured real emails (git-ignored); committed fixtures are scrubbed | §10.4 |
| 2026-10-03 | Alert emails → jobs: code parsers only where volume justifies one (Indeed now), Haiku for every other sender; code keeps a model-read job only if its title and company appear in the email and its link ref exists | §10.4, user-approved |
| 2026-10-03 | A code parser that finds nothing hands the email to the model and the Sources page warns the layout may have changed | §10.4 |
| 2026-10-03 | Over-budget email extraction is DEFERRED and re-read by id next check; obvious non-alerts skipped by subject | §10.4 |
| 2026-10-03 | Hand-rolled MIME reader; bodies parsed in memory, never stored; scrubbed fixtures via `scrub:email` | §10.4 |
| 2026-10-03 | Partial jobs (`isPartial`, `salary`): rough score from the summary; paste full description once Interested; tailoring waits for it; a board with the description completes it | §10.5 |
| 2026-10-03 | Alert jobs pass a summary stage: stack keyword in title/summary or a software-role title (`roleTitleTerms`) | §9.6 — first real check let 8 non-software roles through |
| 2026-10-03 | Email sources excluded from the nightly fan-out, "Run now" and the board list; shown on the Gmail card | §10.4 |
| 2026-10-03 | Code review fixes: whole-number check; `generatedAt` = evidence read time; existing resume stays reachable during/after a failed re-tailor; "Tailor again" on a current resume needs confirmation | §13.1, §13.3 |
| 2026-10-04 | Worker heartbeat key with a TTL in Redis; API reports `workerOnline` wherever work waits on the worker (not BullMQ `getWorkers()`: needs `CLIENT LIST`) | §4 — tailoring sat queued 10+ min with no worker running |
| 2026-10-04 | Tailoring shows elapsed time, says when no worker runs, and polling backs off then stops after 15 min with "Check again" | §13.1 |
| 2026-10-04 | No navigation blocking while tailoring (work runs in the worker); app-wide "Tailoring resume" bar instead; the Jobs tab returns to the last jobs URL | §8.4, user request |
| 2026-10-04 | "Find new jobs" on the Jobs page and Sources: queues boards + Gmail check; per-source dedup id; `GET /discovery/status` | §9.9, user request |
| 2026-10-04 | "Found 2d ago" is the only time on a job row (posting age only on the detail page); jobs filterable by source (`?sourceId=`), linked from Sources and the Gmail card | §8.4, user request |
| 2026-10-04 | Add skill (with its first evidence) and Add evidence in the Evidence screen; always unverified | §6.3, user request |
| 2026-10-02 | `TailoredResume` replaced by `ResumeVariant` + `JobResume`; reuse threshold is a setting (0.85) | §5.2, §13.2, §13.4 |
| 2026-10-02 | CV reconciled: title Software Engineer, Docker PRODUCTION + CI/CD WORKING, CV-only claims added unverified, context-less CV skills recorded PERSONAL/WORKING | User's answers (§7.5) |

---

## 17. Build state and roadmap

### 17.1 Built and verified (as of 2026-10-02)

- **Monorepo:** `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`.
- **Auth** (§8): register, login, refresh, logout, `GET /auth/me`; refresh cookie; CORS
  allowlist; web token handling with single-flight + Web Lock.
- **Career truth CRUD** (§6): skills, evidence (+ verify/unverify), work experience,
  projects — every verification-reset rule enforced and tested.
- **Career seed** (§7): 1 role, 1 project, 28 skills, 29 evidence items, all unverified;
  seeded into the user's account. CV reconciliation (§7.5): 63 items, 44 to review.
- **Resume tailoring** (§13): Sonnet bullets checked by code, Resume card on Interested
  jobs, review page with sources, approval, reuse of approved resumes, derived staleness,
  "Save as PDF" (US Letter, matched to the user's CV) in the user's CV layout. Tested with a fake model; no real run yet.
- **Profile & education** (§5.2): `/profile`, `/education`, web Profile page; projects
  linkable to a role; evidence context/depth editable.
- **Discovery Milestone 1** (§9): worker, 10 adapters, two-stage filter, dedupe, run
  lifecycle, nightly Redis scheduler, 48 sources recorded (13 enabled). First live run:
  1,321 postings → 25–28 stored, including Septem's MERN role and Kwanso's Full Stack /
  MERN roles in Lahore.
- **Web app:** sign in/register; Jobs (New / Interested / Applied / Skipped, attribution,
  "Open posting", pipeline stages); Evidence review (verify / unverify / edit wording, context and depth); Profile & education;
  Sources (health, counts, errors, on/off, "Run discovery now"). Installable PWA.
- **API for jobs and discovery:** `/jobs`, `/jobs/:id`, `/discovery/sources`,
  `/discovery/run`.
- **UX pass (2026-10-04):** worker heartbeat, honest tailoring progress, app-wide
  tailoring bar, Jobs tab memory, "Find new jobs" with freshness, found time per job, jobs
  by source, Add skill / Add evidence.
- Tests: unit, e2e/integration and web tests across all packages; typecheck and lint
  clean. Migrations applied to a **local** Postgres (Neon not yet set up).

### 17.2 Roadmap (in order)

1. **User:** review the 44 unverified items from the CV reconciliation (§7.5) in the
   Evidence screen — fix the placeholder ones with Edit before verifying. Everything AI
   reads only verified evidence.
2. ~~**One real tailoring run**, then tune~~ — done 2026-10-04: real runs on the user's
   MERN job; layout matched to the CV and bullet wording tuned (§13.1).
3. **Email job alerts** (§10): built 2026-10-03 — Gmail connected, Indeed parser, model
   fallback for every other portal, partial jobs and "paste full description". **Next:**
   a LinkedIn code parser once its alert volume and layout are confirmed; board discovery
   from alert-only companies (§9.12).
4. **"Add a job"** (§11, incl. the Android share target). (AI scoring + budget guard:
   built — §12.)
5. **Resume extras** (§13): base variants per niche and a library page, removing a single
   bullet, the application kit (§13.5) and push notifications (§13.6).
6. **Discovery Milestone 2** (hosted ATS pages), **source discovery** (§9.11: board
   probing + monthly ATS-scoped search), then **Milestone 3** (custom sites via change
   watcher).
7. **Deploy** (§4): one VPS with Docker Compose. **Prepared and tested locally
   2026-10-04** (`deploy/`); going live needs the user's VPS and a DuckDNS hostname.
8. ~~Rate-limit `/auth/login` and `/auth/register`~~ — built 2026-10-04 (§8.1).

### 17.3 Open decisions

- **Scoring weight calibration** (§12.1): PREFERRED/BONUS weights and the 45/70 verdict
  thresholds — tune on the user's real scored jobs, not a single sample.
- **Career data completeness:** Git, REST APIs, npm, pnpm, prompting added
  (2026-10-02). Testing (Jest/Vitest in paid work) not stated — the user decides.
- Whether prompt engineering at CloudCard is WORKING (seeded) or PRODUCTION — the user can raise it.
- Placement rules for COMMERCIAL + EXPOSURE and PERSONAL + PRODUCTION / MAINTENANCE
  (§6.1). COMMERCIAL + WORKING decided 2026-10-02.
- The score threshold that gates tailoring (§12.1) and the resume-reuse overlap threshold
  (§13.2) — both runtime settings; initial values to be set when built.
- Skill aliases ("React" vs "React.js") — needs a canonical-name mapping (§5.2).
- UI for renaming skills and editing roles/projects (API endpoints exist; Profile and
  Education have UI since 2026-10-02; adding skills and evidence has UI since 2026-10-04).

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
