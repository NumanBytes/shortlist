# Shortlist — Project Context

This document is the complete context for the Shortlist project. It exists so an AI
assistant (or a new contributor) can pick up the codebase and continue building it
correctly, without re-deriving decisions that were already made and argued through.

Read this before generating code. Where this document states a rule, follow it even
if a more "standard" pattern would normally apply — the rules encode specific,
hard-learned constraints, not stylistic preference.

---

## 1. Why this exists

The builder, Numan, is a ~2-year frontend developer at CloudCard Inc. (Lahore,
Pakistan), job-hunting alongside his current role. The manual grind of job hunting —
tracking applications in memory, tailoring resumes by hand, no visibility into what's
working — is the problem. Every existing productivity tool for this gets abandoned
because the cost of not using it is zero.

**The product is not "an AI that applies to jobs for you."** It is an AI that does the
tedious 80% (discovery, JD parsing, match scoring, resume tailoring, outreach drafts)
and hands the person a ready-to-submit application. **The human clicks submit.**
This was a deliberate scope decision, not a limitation:

- LinkedIn's and Indeed's Terms of Service explicitly ban automated applying. Bot
  detection risks account suspension.
- Recruiters can detect bot-written outreach messages.
- Full automation was considered and explicitly rejected.

### The incident that shaped the data model

Early on, while manually tailoring a resume for a real application (MERN Stack
Engineer @ Devsorb, Lahore), an AI assistant inserted **"Azure B2C"** as a claimed
skill, pulled from a stale, unverified note. Numan has never worked with Azure —
CloudCard's B2C layer is an in-house **Ruby** service. The false claim went out on a
real, submitted application.

**This is the single most important fact in this document.** It is the reason the
data model has an `isVerified` flag that defaults to `false`, and the reason no
resume-generation code may read from anything the user has not explicitly confirmed.
Treat truthfulness as a hard constraint, not a nice-to-have — see §6.

### Success criteria (stated by the builder)

- Output quality must match or beat what he'd write himself by hand.
- ~60–70% reduction in per-application manual effort.
- Mobile-first: a push notification saying "resume ready, just review and submit."
- Architected as a real multi-user product (proper auth, no shortcuts), but only he
  uses it for now. May be sold later — this affects naming/trademark caution, not
  architecture.

---

## 2. What — product scope

**Name:** Shortlist. (Double meaning, chosen deliberately: the product gives you a
shortlist of jobs every morning, and its purpose is getting *you* shortlisted.)
Target domain: `getshortlist.com` (or a `get-`/`use-` prefix variant — `shortlist.com`
is taken). Codebase and repo name: `shortlist` — no separate internal codename.
Package scope: `@shortlist/*`.

**One-liner:** Finds jobs worth your time, tailors a truthful resume for each, and
notifies you. You make the final click.

### In scope
- Multi-source job discovery (see §5)
- JD parsing → structured requirements
- Match scoring against a verified skills database
- Resume tailoring, rendered into the user's own CV layout (not a generic template)
- Outreach message drafting
- Push notification when a match clears the threshold
- Delivery as a installable PWA (not a native app)

### Explicitly out of scope
- One-click / zero-touch auto-submission
- Scraping LinkedIn/Indeed directly (ToS risk) — see §5 for the legitimate
  alternative (email alert parsing)

---

## 3. Runtime architecture

Three logical processes, two stores. This split is deliberate — do not collapse the
worker into the API.

```
apps/web      React + Vite PWA — the only thing that talks to the browser
apps/api      NestJS HTTP API — auth, CRUD, owns identity
apps/worker   NestJS, no HTTP server — consumes the job queue, runs the pipeline
packages/shared  Zod schemas + inferred types, imported by web, api, and worker
packages/db      Prisma schema + generated client
```

```
Browser (PWA)
   │ HTTPS + JWT
   ▼
Express-style NestJS API ──► PostgreSQL (source of truth)
   ▲
Scheduler (cron) ──enqueue──► Redis (queue only — nothing here is precious)
                                   │ consume
                                   ▼
                              Worker process
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼               ▼
              Job sources     Claude API      Web Push service
           (ATS/APIs/inbox)                         │
                                                     ▼
                                              notification → PWA
```

**Why the worker is a separate process, not a Nest route:** a job source can hang, a
Claude call can take 15–20s, a nightly run processes hundreds of postings. None of
that may compete with the API's event loop for the requests a real user is making
right now. The queue (Redis + BullMQ) is what buys this isolation, and it gives
retries/backoff for free.

**Why Redis holds nothing important:** it is a queue and rate-limit counters only.
Postgres is the only store that must never lose data.

**API key boundary:** the Claude API key lives only in the worker's environment. The
browser and the Express-style API layer never see it. A compromised frontend cannot
spend money.

---

## 4. Entity model

The schema splits into two halves that meet at exactly one table.

```
TRUTH (slow-moving, hand-curated)          JOBS (fast-moving, machine-generated)
────────────────────────────────           ───────────────────────────────────
User ──< WorkExperience                    User ──< JobSource ──< DiscoveryRun ──< Job
User ──< Project                           Job ──< JobRequirement
User ──< Skill ──< SkillEvidence
     (evidence links optionally to
      WorkExperience OR Project)

                    both sides meet at:
              User + Job ──< JobMatch >── SkillGap
                              JobMatch ──< TailoredResume
```

`JobMatch` is the only join between the two halves. Scoring logic lives in one place,
not scattered — re-scoring the entire job history after updating one skill never
requires re-reading a single job description.

### The Prisma schema

The source of truth is `packages/db/prisma/schema.prisma` — read it there rather than
keeping a copy in this document (a copy here drifted out of date once already). The
points below are the design decisions it encodes, which the file alone doesn't explain:

- **`SkillEvidence` is the core table.** One `Skill` can carry several truths at once
  (e.g. PostgreSQL: COMMERCIAL/PRODUCTION at work *and* PERSONAL/WORKING on a side
  project). `whatIDid` is the user's own wording and the **only** source a resume bullet
  may be derived from. `isVerified` defaults to `false` — the Azure-incident safeguard;
  do not weaken that default.
- **Evidence links to at most one origin** — `workExperienceId` *or* `projectId`, never
  both. Prisma can't express this, so it is enforced by a hand-written `CHECK`
  constraint (`chk_evidence_single_source`) in its own migration, and again in the Zod
  schema. Keep that migration if migrations are ever regenerated.
- **`Skill` is unique per `(userId, lower(name))`** — "React" and "react" collide. The
  Prisma `@@unique([userId, name])` is case-sensitive, so the case-insensitive index is
  another raw-SQL migration. (Aliases like "React" / "React.js" are not caught — that
  needs a canonical-name mapping, not an index.)
- **`Job` is unique per `(userId, dedupeHash)`** — the same posting from multiple
  sources collapses to one row.
- **`RefreshToken` stores only a hash** of each refresh token, so tokens can be revoked
  (logout) and a database leak doesn't leak usable tokens.
- **`JobSource`** (`type`: `ATS_BOARD` | `AGGREGATOR_API` | `EMAIL_INBOX` | `MANUAL`,
  per-source `config` JSON, `isEnabled`). Toggling a source on/off is a data change,
  never a code change.
- **`DiscoveryRun`** (`RUNNING` | `SUCCESS` | `FAILED` | `EMPTY`, `jobsFound`, `jobsNew`,
  `errorMessage`). **Must be opened in `RUNNING` state before the fetch starts**, not
  after — an empty or failed source must be visibly distinguishable from "no jobs
  today." This is the direct lesson from a real incident: a single-source job search
  silently returned nothing and was mistaken for "the job doesn't exist," when the
  search tool itself had failed.
- **`TailoredResume`** hangs off `JobMatch` (one per match) and holds the generated
  bullets plus a reference to the rendered PDF.

---

## 5. Job discovery — four tiers, toggleable, cost-gated

1. **ATS public boards** (Greenhouse, Lever, Ashby, Workable, Recruitee,
   SmartRecruiters) — public JSON per company, no ToS issue, highest-quality JD text.
   **This is the primary, highest-value tier.**
2. **Aggregator APIs** (Adzuna, Jooble, Remotive, RemoteOK, WeWorkRemotely,
   Arbeitnow, Himalayas) — Pakistan coverage is unverified and likely weak.
3. **Email alert inbox parsing** — set LinkedIn / Indeed / **Rozee.pk** job alerts to
   a dedicated inbox, parse over IMAP. This is the legitimate way to get LinkedIn and
   Rozee coverage without touching their ToS or scraping. Rozee matters most for the
   Lahore market specifically.
4. **Manual URL paste** — fallback, always available.

**Tier selection is data, not code.** A `JobSource` row per source; disabling Rozee
is a database update, never a redeploy. This also allows measuring which sources
actually produce interviews later.

**Pipeline order (cost strategy):**
```
sources → normalize + dedupe (hash) → cheap rule filter (NO AI CALL)
        → AI extraction (Haiku, batched) → AI match scoring (Haiku, cached context)
        → [if score ≥ threshold] → AI tailoring (Sonnet) → render PDF → push notify
```

The rule filter (location, title keywords, core-stack mention, dedupe, posting age —
plain TypeScript, no model call) is what turns ~300 raw postings/day into ~30 that
reach any AI call. This single step is roughly a 10x cost reduction and is not
optional. Expensive operations always sit behind cheap ones.

**The match-score threshold that gates tailoring is a runtime config value, not a
constant.** It is the cost/noise dial — raise it and Sonnet spend drops immediately.

### Budget (verified against current published API pricing)

At ~300 jobs/day ingested → ~30 reach AI → ~5 get a tailored resume:
- Extraction + matching on Haiku: ~$8/month
- Tailoring on Sonnet: ~$3/month
- ~$11/month at standard rates; **$5–8/month** using the Batch API (the pipeline runs
  overnight on a schedule — a perfect fit for async batch processing at 50% off) plus
  prompt caching on the invariant career-database context.
- Infra: Neon (Postgres) free tier, Upstash (Redis) free tier, Vercel free tier for
  the frontend, ~$5–7/month for an always-on worker host (cron cannot run on a host
  that sleeps), domain ~$12/year.
- **Total: roughly $12–18/month all-in.**

---

## 6. Truthfulness rules — non-negotiable

This is domain logic, not a suggestion. Any code that generates resume content must
obey these rules exactly.

| Context + Depth | Where it may appear |
|---|---|
| COMMERCIAL + PRODUCTION | Experience bullets, Skills section, Summary |
| COMMERCIAL + MAINTENANCE | Experience bullets, but worded as maintenance (upgraded/fixed, not built) |
| PERSONAL/ACADEMIC + WORKING | Skills + Projects sections only — never an Experience bullet |
| PERSONAL/ACADEMIC + EXPOSURE | Skills section only if `lastUsed` < 2 years ago, otherwise omitted entirely |

**Hard rules for any AI generation step:**
1. Query only `SkillEvidence` rows where `isVerified = true`. Unverified evidence
   must be invisible to any generation prompt.
2. Every generated resume bullet must be traceable back to a specific `whatIDid`
   string the user wrote. Never synthesize a claim the user did not author.
3. `isVerified` is never settable by a request body from the client-facing API layer
   — it can only be flipped by an explicit, deliberate verification action.

### The verified career database (seed data reference)

**COMMERCIAL — CloudCard Inc., Lahore (May 2024–present, hired as frontend dev):**
HTML5, CSS, Tailwind CSS, JavaScript, TypeScript, React.js, Material UI, Ant Design
(all PRODUCTION); React version upgrades across apps and Angular version upgrades
across apps (MAINTENANCE, not primary development); Ruby, a little (WORKING);
PostgreSQL/SQL/DB migrations/new tables & columns (PRODUCTION); role-based access
control via DB configuration (PRODUCTION); full understanding of the in-house Ruby
B2C layer sitting between frontend and a core Java backend (PRODUCTION); SonarQube
error remediation (PRODUCTION); Docker, Docker Compose, microservices — real, but
consumed/worked-within rather than owned (non-DevOps side, so WORKING not PRODUCTION
for infra ownership).

**SELF-TAUGHT / PERSONAL:** MERN stack — small learning projects only, paused for a
long time (WORKING, not PRODUCTION — do not let this read as commercial Node
experience). Next.js — currently in active use building a separate side project
(WORKING, trending toward PRODUCTION as that project ships).

**UNIVERSITY / ACADEMIC (dated):** Python, Flask, Django, Java, C++, .NET
(EXPOSURE — evaluate each against the 2-year staleness rule before ever surfacing).

**Known overclaims that must never resurface:**
- Node.js / Express.js as *CloudCard* experience — false. His only Node/Express
  experience is the self-taught MERN projects (PERSONAL/WORKING at best). This
  overclaim is precisely what building Shortlist's own backend in NestJS/Express-style
  Node is meant to fix — it converts this from a false claim into real, verifiable,
  shipped evidence.
- **"Azure B2C" — false, never repeat.** CloudCard's B2C layer is in-house Ruby.
  See §1. If this string appears anywhere in generated output, it is a bug.

---

## 7. Technology decisions and why

| Layer | Choice | Why (and what was rejected) |
|---|---|---|
| Backend framework | **NestJS** (runs on Express under the hood) | Chosen over plain Express because the system is more than one API — it's an API + worker + scheduler + queue sharing modules. Nest's module system, `@nestjs/bullmq`, and `@nestjs/schedule` fit this directly. Also increasingly asked for in job listings; patterns transfer to Spring Boot if a Java-fintech path is ever pursued. |
| Auth inside Nest | **Hand-rolled JWT**, not Passport | Nest's own docs steer toward `@nestjs/passport`. Deliberately avoided — the goal is understanding bcrypt hashing, short-lived access tokens, longer-lived refresh tokens (stored in `RefreshToken` for real revocation), verification middleware, and logout, not configuring a library that hides all of it. |
| Request validation inside Nest | **Zod via a custom `ZodValidationPipe`**, not `class-validator` | Nest defaults to decorator-based class-validator. Rejected because it would fragment validation into two systems (Zod for Claude's output, class-validator for requests) and block sharing schemas with the frontend. One schema, defined once in `packages/shared`, used everywhere. |
| Frontend | **React + Vite**, not Next.js | Shortlist is a private, authenticated dashboard — Next's main advantages (SSR for SEO, colocated server code) don't apply when Express/Nest already owns the API and auth, and nothing needs to be indexed by Google. Vite + `vite-plugin-pwa` covers the PWA requirement cleanly. (Next.js remains the right choice for the separate Manzil project, where a public, SSR'd profile page genuinely needs SEO — that's a different product with a different requirement, not an inconsistency.) |
| Database | **PostgreSQL + Prisma** | The data is deeply relational (a milestone/skill has no meaning without its parent), queried with joins and aggregations (drift/match scoring). Rejected MongoDB for this reason — it would need multiple round trips for what Postgres does in one JOIN. |
| Validation | **Zod**, used at three distinct boundaries | (1) API request bodies, (2) Claude API responses — parsed and rejected/retried if malformed before anything touches Postgres, (3) environment variables at process startup, so a missing `DATABASE_URL` fails immediately with a clear error instead of failing mysteriously on the first request. |
| Queue | Redis + BullMQ | Standard pairing with `@nestjs/bullmq`; holds nothing that isn't safely re-derivable. |
| AI | Claude API — Haiku for extraction/matching, Sonnet for tailoring | Split by cost/quality need — extraction and matching are structured-output tasks Haiku handles well and cheaply; tailoring needs Sonnet's writing quality. Batch API + prompt caching used specifically because the pipeline runs overnight on a schedule. |
| Deployment (target, not yet done) | Vercel (web) + Render/Railway (api, worker) + Neon (Postgres) + Upstash (Redis) | Free tiers where available; the worker needs an always-on host since cron cannot run on something that sleeps. |

**Monorepo tooling:** pnpm workspaces. Root `package.json` orchestrates
`apps/*` and `packages/*`. `packages/shared` and `packages/db` are compiled to `dist/`
and built before `apps/api` (the `db` build also runs `prisma generate`), so the API
always imports compiled schemas and a current Prisma client.

---

## 8. Current build state (as of 2026-09-30)

**Done and verified working:**
- Monorepo scaffolded: `apps/api` (NestJS), `packages/shared` (Zod schemas),
  `packages/db` (Prisma schema, migrations, re-exported client).
- `packages/shared` exports the skill, auth (register/login/refresh), and skill-evidence
  schemas. This is the pattern for every future schema: define once, infer the TS type,
  never hand-write a duplicate interface. The evidence schemas deliberately have no
  `isVerified` field and use `.strict()`, so a request that tries to set it is rejected.
- Full Prisma schema written, including `JobSource`, `DiscoveryRun`, and
  `TailoredResume`. Two migrations exist — `init` and the `SkillEvidence`
  single-origin `CHECK` constraint — and are applied to a **local** Postgres. Neon is
  not set up yet.
- Skills + SkillEvidence CRUD (`apps/api/src/skills/`, `apps/api/src/evidence/`),
  Prisma-backed and scoped to the signed-in user, enforcing §6 in code:
  evidence is always created unverified; `POST /evidence/:id/verify` is the only path
  that sets `isVerified` (with `/unverify` to undo); editing evidence un-verifies it;
  **renaming a skill un-verifies all of its evidence** (otherwise evidence verified for
  "React" would vouch for whatever the skill is renamed to — the Azure-incident shape);
  evidence can only link to the user's own WorkExperience/Project; `lastUsed` can't be
  in the future; another user's resources return 404, not 403.
- WorkExperience + Project CRUD (`apps/api/src/work-experience/`, `apps/api/src/projects/`).
  Editing a field that changes what linked evidence claims (a role's company, title,
  or dates; a project's name, description, shipped status, or dates) un-verifies that
  evidence — otherwise "CloudCard, Frontend Dev" edited to "Google, Senior Engineer"
  would carry verified bullets with it. Cosmetic fields (location, URLs) don't.
  Deleting a role/project keeps its evidence (FK is SET NULL) but un-verifies it.
  Date rules: nothing starts in the future; end ≥ start; a role is either current or
  has an end date (checked on the merged row for PATCHes). Project URLs must be
  http(s) — a `javascript:` URL would be an XSS vector once rendered as a link.
- `apps/api` has: environment validation at boot (`src/config/env.ts` — requires a
  Postgres `DATABASE_URL`, loads `apps/api/.env` via Node's built-in
  `process.loadEnvFile()` when the file exists, fails fast on bad config), a generic
  `ZodValidationPipe` (`src/common/pipes/`), and a `GET /health` endpoint.
- Hand-rolled JWT auth (`apps/api/src/auth/`): register, login, refresh, logout, and
  `GET /auth/me`. bcrypt password hashing (with a dummy-hash compare so login timing
  doesn't reveal which emails exist); 15-minute HS256 access tokens; opaque refresh
  tokens stored as SHA-256 hashes and rotated on every use, with reuse detection that
  revokes all of a user's sessions. A global guard protects every route; `@Public()`
  opts out. Refresh tokens currently travel in the JSON body — moving them to an
  httpOnly cookie is a follow-up once `apps/web` exists.
- Global route prefix `api/v1` is set, with `/health` excluded from it.
- Unit tests (Vitest) for the validation pipe, env loader, and token service; e2e
  tests (Vitest + Supertest, against the real database) for health, the full auth
  flow, skills, evidence, work experience, and projects (one test per §6 rule). All passing. `tsc --noEmit` passes
  with `strict: true`; oxlint is clean.
- Uses Nest 12 defaults: ESM output (import paths end in `.js` even in `.ts` source —
  this is required by Node's ESM resolution, not a mistake), Vitest instead of Jest,
  oxlint instead of ESLint.

**Not yet built — in order:**
1. Seed the database with the real verified career data from §6.
2. `apps/web` — React + Vite PWA shell.
3. `apps/worker` — the discovery/extraction/matching/tailoring pipeline itself,
   starting with exactly one `JobSource` (one Greenhouse board) end to end before
   adding more sources.
4. Move the database to Neon when deploying (step 2 of the original plan was done
   against local Postgres instead).
5. Rate-limit `/auth/login` and `/auth/register` (Redis-backed counters, once Redis
   is in place for the queue).

---

## 9. Working agreements

- The builder wants genuine understanding of every layer, not just working code —
  prefers explanations of *why* a pattern is used before or alongside the code
  itself, especially for anything that maps to a system-design interview concept
  (queues, validation boundaries, idempotency, failure visibility).
- Prefers hand-rolled implementations of interview-relevant mechanisms (auth, in
  particular) over pulling in a library that hides the mechanism, even when the
  library would be faster to ship.
- Naming: English names only for anything product-facing (the Manzil→Shortlist
  history reflects this — Urdu-derived names were explicitly rejected for this
  product).
- Product names aside, this document itself and all code/comments should be in
  plain, direct English.