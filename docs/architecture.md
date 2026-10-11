# Architecture

Processes, deployment, the data model, and the technology choices.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

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

**Deployment: one VPS running everything (decided 2026-10-04; live since 2026-10-09).**
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
  so web and API share **one origin** and the `SameSite=Strict` cookie works ([§8.2](security.md)), the
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
- **`TRUST_PROXY_HOPS=1`:** Caddy is the one proxy ([§8.1](security.md)).

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

**Host: AWS EC2 `t4g.small` on the free plan, then a budget VPS (decided 2026-10-08).**
Oracle Cloud's Always Free ARM server was tried first, and failed for days with "Out of
capacity". The user chose AWS's free plan for hands-on AWS experience. It gives credits
for **6 months**, so it's a bridge: plan the move to a budget VPS before it ends. The
README documents both as step 1A (AWS) and 1B (VPS: Contabo/Netcup monthly, RackNerd
yearly), with every later step shared.
- **AWS setup:** root user with MFA, used only for billing; an `Admins` group with
  AdministratorAccess and an IAM user in it (permissions on groups, not users); no
  access keys; a zero-spend budget alert. Mumbai (`ap-south-1`), nearest default region
  to Pakistan. 30 GiB gp3. An Elastic IP, since a public IP changes on stop/start.
- **ARM (Graviton):** every base image is multi-arch. Native packages were checked:
  `bcrypt` 6 ships `linux-arm64` glibc prebuilds, and the lockfile has the arm64 builds
  of rollup, rolldown, lightningcss, tailwind oxide and oxlint. Prisma fetches its engine
  for the build machine, and images are built on the server. Confirmed 2026-10-09: the
  full stack built and runs on the t4g.small, and the user's local database was imported
  with README step 6.
- **Firewall:** on AWS the security group (22 from the user's IP; 80 for Let's Encrypt;
  443). On a VPS, `ufw` with the same ports, plus SSH keys only via
  `/etc/ssh/sshd_config.d/00-keys-only.conf` (`00-` because sshd keeps the first value it
  reads, so it beats provider drop-ins that re-enable passwords). AWS images are keys-only
  already.
- **The repo is private,** so the server clones it with a read-only GitHub **deploy key**
  scoped to this one repository, never the user's own key or a token.
- **Data loss is the main risk** of a free account that can end. Moving follows "Moving
  to another server": backup → steps 3–6 → repoint DuckDNS, same `TOKEN_ENCRYPTION_KEY`.

**Off-site backups: Google Drive via an `offsite` Compose service (decided 2026-10-09).**
The nightly dumps in `deploy/backups/` die with the server, and a copy in S3 would die
with the AWS account, so the copy lives with a different company. Every night at 04:00
(after the 03:30 dump) `deploy/offsite-backup.sh` copies the newest dump to
`gdrive:shortlist-backups` and deletes copies there older than 30 days. At worst a day of
data is lost.
- **Why Drive:** the user already has it (15 GB free; a dump is ~100 KB), and the server
  pushes by itself. Pulling to the laptop would need the laptop on and an unattended SSH
  key.
- **Why a Compose service, not rclone on the host:** it uses the official multi-arch
  `rclone/rclone:1` image with busybox `crond`, the same pattern as `backup`. Moving
  servers is copying one file (`deploy/rclone/rclone.conf`, git-ignored) with nothing to
  install.
- **Least privilege:** the Google scope is `drive.file`, so rclone sees only files it
  created. A leaked token can't read the user's other documents. The server has no
  browser, so OAuth runs once on the laptop (`rclone authorize`) and the token is pasted
  back.
- **Fails loudly:** a non-zero exit and a log line when there's no dump, the newest dump
  is older than 26 hours (the nightly backup itself stopped), or the upload or pruning
  fails. `rclone copy` skips files already there, so a re-run is harmless.
- **Dead man's switch (optional `OFFSITE_PING_URL`, e.g. healthchecks.io):** pinged on
  success and `/fail` on failure. The service emails when a ping fails or doesn't arrive,
  the only way to notice a job that never ran. A failed ping never fails the backup.
- Tested locally against a stand-in remote: no dump, a stale dump, success with pruning,
  an idempotent re-run with an unreachable ping URL, a read-only remote, a missing config,
  and job output reaching `docker compose logs`. Not encrypted: it's the user's own Drive.
  rclone's `crypt` could be added later, but a forgotten passphrase would make every
  backup useless.

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
  leak usable tokens ([§8.1](security.md)).
- **`WorkExperience`, `Project`** — what evidence is anchored to. Their claim-bearing
  fields un-verify linked evidence when changed ([§6.3](../Agents.md)). A project can belong to a role
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
  - `isVerified` (default `false`) + `verifiedAt` — the Azure safeguard ([§6](../Agents.md)).
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
  fetching ([§1.3](../Agents.md), [§9.5](discovery.md)). Indexed by `(jobSourceId, startedAt)`.
- **`Job`** — a discovered posting: title, company, location, `workMode`, `source`
  (provider, shown as attribution), `sourceUrl` (the original posting; "Open posting"
  always goes here), `rawJD` (plain-text description), `dedupeHash` (unique per user),
  `jobSourceId` and `discoveryRunId` (the run that first found it; both SET NULL on
  delete), `status` (DISCOVERED → INTERESTED | SKIPPED → APPLIED → ASSESSMENT →
  INTERVIEWING → OFFER | REJECTED | WITHDRAWN), `postedAt`, `discoveredAt`, `lastSeenAt`
  (bumped by every run that still lists it — powers "possibly closed"), `appliedAt`
  (set when the user says they applied).
- **`DiscoveryPreferences`** — one row per user holding the rule filter's settings
  ([§9.6](discovery.md)). Data, not code: tuning what gets through is an update, never a redeploy. A user
  without a row gets `DEFAULT_DISCOVERY_PREFERENCES` from shared.
- **`JobRequirement`, `JobMatch`, `SkillGap`** — exist in the schema; filled by the AI
  step ([§12](ai-scoring.md)). `JobMatch.verdict` is APPLY | STRETCH | SKIP.
- **`ResumeVariant`, `JobResume`** (built 2026-10-02, replacing the never-used
  `TailoredResume`) — a variant is one tailored resume: `content` (JSON, Zod-validated
  `ResumeContent`), `evidenceIds` (everything it relies on), `requirementProfile`
  (normalized requirement names of the job it was made for), `status` DRAFT | APPROVED,
  `generatedAt`. `JobResume` is one per job: which variant it uses, whether it was
  reused (and at what overlap), and the state of preparing it (PENDING | READY |
  DEFERRED | FAILED). `evidenceIds` has no foreign key on purpose: a deleted item must
  leave a trace so the resume reads as stale instead of silently shrinking ([§13.3](resume.md)).

### 5.3 Constraints Prisma can't express

They live in hand-written SQL migrations, created with `prisma migrate dev --create-only`
and then edited: `chk_evidence_single_source` and `Skill_userId_lower_name_key`. Keep
them if migrations are ever regenerated — Prisma ignores both when diffing, so it will
neither recreate nor drop them.

---

## 14. Technology decisions

| Area | Choice | Why — and what was rejected |
|---|---|---|
| Backend framework | **NestJS** (on Express) | The system is an API + worker + scheduler + queue sharing modules; Nest's module system and DI fit that. Increasingly asked for in job listings; patterns transfer to Spring Boot. Plain Express rejected as too little structure for multiple processes. |
| Auth | **Hand-rolled JWT**, not `@nestjs/passport` | The goal is understanding bcrypt, short-lived access tokens, rotated refresh tokens, revocation and guards — not configuring a library that hides them ([§8](security.md)). |
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
| PWA | **vite-plugin-pwa** | Manifest + service worker; app shell only ([§8.5](security.md)). |
| AI | **Claude: Haiku** (extraction, scoring), **Sonnet** (tailoring) | Split by cost/quality need; Batch API + prompt caching because the pipeline runs overnight. |
| RSS parsing | **fast-xml-parser** | We Work Remotely publishes RSS. |
| Cookies | **cookie-parser** | Reads the refresh cookie. |
| Tests | **Vitest** (API, worker, web), **node:test** (db seed guards), Supertest, Testing Library | Nest 12 defaults to Vitest; seeds run on Node's type stripping, so `node:test` needs no extra tooling. |
| Lint | **oxlint** (type-aware) | Nest 12 default; `no-floating-promises` is an error. |
| Seed scripts | **Node's built-in type stripping** (no `tsx`) | No extra dependency; requires `.ts` import extensions and erasable-only syntax, checked by `tsconfig.seed.json`. |
| Optional native add-on | `msgpackr-extract: false` | BullMQ's optional speed-up; the pure-JS fallback is fine at our volume and avoids a native build step. |
| Monorepo | **pnpm workspaces** | `packages/shared` and `packages/db` compile to `dist/` and are built before the apps. |
| Module format | **ESM** throughout (`nodenext`) | Relative imports end in `.js` even in `.ts` source — required by Node's ESM resolution, not a mistake. |
