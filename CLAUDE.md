# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `Agents.md` first.** It holds the product philosophy, the truthfulness rules and the working agreements, plus a map of `docs/`: one file per area (architecture and deploy, security, web design, discovery, email alerts, AI scoring, resume tailoring, development), the dated decision log (`docs/decisions.md`, §16) and the roadmap (`docs/roadmap.md`, §17). Before changing an area, read its file. Where the docs state a rule, follow it even if a more conventional pattern exists. For exact data shapes, trust `packages/db/prisma/schema.prisma` and the migrations folder over the docs. Section numbers are shared across files; cite them with the file (`docs/email-alerts.md §10.4`). Applied migration files are never edited, not even their comments — Prisma checksums them.

**Every design decision must be recorded** — in the `docs/` file for its area (or `Agents.md` for product rules) *and* as a row in `docs/decisions.md` — in the same change that makes it. Don't leave decisions only in chat or PR descriptions.

## Commands

pnpm workspace (pnpm 12, Node >= 22). Run from the repo root unless noted.

```bash
pnpm install
pnpm dev:api            # builds shared, generates Prisma client, starts Nest in watch mode (:3000/health)
pnpm dev:web            # Vite on :5173; proxies /api to :3000 (run dev:api alongside)
pnpm dev:worker         # queue consumer + nightly scheduler (needs Redis: REDIS_URL, default localhost)
pnpm discover           # queue a discovery run for every enabled source now (worker must be running)
pnpm --filter @shortlist/worker capture:emails you@x.com [max]
                        # save recent Shortlist-label emails as .eml (git-ignored) for writing parsers
pnpm --filter @shortlist/worker scrub:email in.eml out.eml "Your Name" you@x.com
                        # make a committable fixture: personal data, tracking and IDs removed
pnpm --filter @shortlist/worker preview:resume <jobId>
                        # real tailoring call (~$0.03, logged to AiUsage), printed with word counts, NOT saved
pnpm build              # shared -> db (prisma generate) -> api -> worker -> web
pnpm typecheck          # tsc --noEmit across all packages
pnpm lint               # oxlint, type-aware, in every package (root .oxlintrc.json)
pnpm format             # Prettier write (root .prettierrc.json); CI runs pnpm format:check
pnpm test               # unit tests (*.spec.ts) in every package — does NOT run e2e

pnpm db:generate        # regenerate Prisma client after editing schema.prisma
pnpm db:migrate:dev     # create + apply a migration (needs DATABASE_URL in packages/db/.env)
SEED_USER_EMAIL=you@x.com pnpm --filter @shortlist/db db:seed:career [--dry-run]
                        # seed docs/career-data.md §7 career data into an existing account, all unverified
SEED_USER_EMAIL=you@x.com pnpm --filter @shortlist/db db:seed:sources [--dry-run]
                        # seed the job-source list (packages/db/prisma/seed/job-sources.ts)
pnpm --filter @shortlist/db test   # seed truthfulness guards (node:test)
pnpm --filter @shortlist/shared test   # scoring, resume placement, board addresses, OAuth/SecretBox
pnpm --filter @shortlist/worker test               # adapters (recorded fixtures, no network), filter, dedupe
pnpm --filter @shortlist/worker test:integration   # DiscoveryService against the real DB

# API-only (apps/api)
pnpm --filter @shortlist/api test:e2e                         # *.e2e-spec.ts — hits the real DB in apps/api/.env
pnpm --filter @shortlist/api exec vitest run src/common/pipes/zod-validation.pipe.spec.ts   # single file
pnpm --filter @shortlist/api exec vitest run -t "returns 400"                               # single test by name
```

`@shortlist/shared` and `@shortlist/db` are consumed from their compiled `dist/`, so after changing either, rebuild it (`pnpm --filter @shortlist/shared build` / `pnpm --filter @shortlist/db build`, which also runs `prisma generate`) before the API sees the change. The root scripts do this for you.

Env files: `packages/db/.env` is read by the Prisma CLI; `apps/api/.env` is loaded by the API at boot via `process.loadEnvFile()` (no dotenv). Both need `DATABASE_URL`.

## Architecture

```
apps/api          NestJS HTTP API — auth, CRUD, owns identity
apps/worker       NestJS, no HTTP server — BullMQ consumers + nightly schedulers: discovery, then AI analysis
apps/web          React + Vite PWA — Tailwind v4, TanStack Query, react-router
packages/shared   Zod schemas + inferred types, imported by every app
packages/db       Prisma schema, migrations, re-exported PrismaClient
```

- **One validation system: Zod.** Request bodies, Claude API responses, and env vars are all validated with Zod. Do not introduce `class-validator`/`class-transformer`. Schemas live in `packages/shared/src/*.schema.ts`; export the schema and `z.infer` the type — never hand-write a duplicate interface. New schema files must also be re-exported from `packages/shared/src/index.ts`. Request schemas use `.strict()` so unknown fields are rejected, not dropped.
- **Validation in controllers** is per-parameter: `@Body(new ZodValidationPipe(Schema))` (`apps/api/src/common/pipes/zod-validation.pipe.ts`). Errors come back as 400 with `{ message, errors: [{ path, message }] }`.
- **Env config** is parsed at boot by `apps/api/src/config/env.ts` before Nest starts; add every new env var to that schema so a missing value fails fast.
- **Routing:** global prefix `api/v1`, with `health` excluded. App-wide setup lives in `configureApp()` (`src/app.setup.ts`), called by both `main.ts` and the e2e tests — put new global settings there, not in `main.ts`.
- **Config/DB injection:** services get validated env via `@Inject(ENV) env: Env` (global `ConfigModule`) and the database via the global `PrismaService`. Don't read `process.env` directly.
- **Auth is hand-rolled JWT** (`src/auth/`). Do not use `@nestjs/passport` — understanding the mechanism is a stated goal. A global `AuthGuard` (`APP_GUARD`) protects **every** route; public routes opt out with `@Public()`. Get the caller with `@CurrentUser() user: AuthUser` and scope every query by `user.id`. Access tokens: HS256 JWT, 15 min, verified with a pinned algorithm. Refresh tokens: opaque random, stored as SHA-256 hash, rotated on every use; reuse of a revoked token revokes all the user's sessions. The refresh token is only ever in the httpOnly `shortlist_refresh` cookie (`src/auth/refresh-cookie.ts`, `SameSite=Strict`, `Path=/api/v1/auth`) — never put it in a response body. CORS allows credentials only for the exact origins in `WEB_ORIGINS`. Never select `passwordHash` into a response — use `PUBLIC_USER_SELECT`. Login/register are rate-limited in `AuthController` via `AuthRateLimits` (`src/rate-limit/`, Redis counters, fail open); production must set `TRUST_PROXY_HOPS` to the number of proxies, or every user shares one IP's limit. E2E tests get lifted limits from `createTestApp()` — override `AUTH_RATE_RULES` to test them.
- **Worker stays a separate process.** Slow Claude calls and job fetches must never run on the API's event loop. Redis is queue-only; Postgres is the only store of record. The Claude API key belongs only in the worker's env.
- **Data model** has two halves — career "truth" (`User`, `WorkExperience`, `Project`, `Skill`, `SkillEvidence`) and machine-generated jobs (`JobSource`, `DiscoveryRun`, `Job`, `JobRequirement`) — joined only through `JobMatch`. Job sources are toggled by data (`JobSource.isEnabled`), never by code. A `DiscoveryRun` row is created in `RUNNING` state *before* fetching so a failed source is distinguishable from "no jobs".
- **Discovery (`apps/worker/src/discovery/`):** one adapter per *platform* (not per company) in `adapters/`, registered in `ADAPTERS`; the `AdapterRegistry` type forces it to match `ImplementedSourceConfigSchema` in shared. New company on an existing platform = a `JobSource` row, never code. Pipeline per source: open `DiscoveryRun` as RUNNING *before* fetching → adapter → stage A filter (title/location/age, listing only) → fetch descriptions only for survivors (`loadDescription`) → stage B (stack keywords) → dedupe by hash of normalized company+title → store. `EMPTY` (source returned nothing) must stay distinct from `SUCCESS` with 0 matches. Posting age is enforced for `AGGREGATOR_API` sources only — a job listed on a company's own board is open. Filter settings are `DiscoveryPreferences` rows (defaults in shared), never constants.
- **Queue:** `DiscoveryJob.All` (nightly via a BullMQ job scheduler stored in Redis — not in-process cron) fans out one `DiscoveryJob.Source` job per enabled source. Custom job ids can't contain `:`. `PermanentSourceError` → `UnrecoverableError` (no retries); anything else retries with backoff, each attempt its own run row. Pass BullMQ a constructed `ioredis` client (`createRedis`, `apps/worker/src/redis.ts`), not connection options; the worker registers that one connection in `worker.module.ts`, not in a feature module.
- **AI analysis (`apps/worker/src/analysis/`, docs/ai-scoring.md §12):** the model (Haiku) only maps job requirements to the user's VERIFIED skills, by short refs it was given; `scoreJob()` in `packages/shared/src/scoring.ts` computes score/verdict/gaps deterministically. Never ask a model for a score or let it introduce a skill. Every model call goes through `JobAnalyzer` (fake it in tests — never spend money in tests) and is logged to `AiUsage` with its cost before the output is used; `BudgetGuard` is checked before every call and over-budget work is DEFERRED, never dropped. Structured output uses the hand-written `JOB_ANALYSIS_JSON_SCHEMA` (kept in sync with the Zod schema by a test); responses are still Zod-validated. Pricing lives in `MODEL_PRICES` (shared) — update it when prices change.
- **Resume tailoring (`apps/worker/src/resume/`, `packages/shared/src/resume.ts`, docs/resume.md §13):** Sonnet only words bullets and groups skills, citing evidence by `E`/`S` refs; `assembleResume()`/`checkBullet()` enforce placement (`placementFor()`, §6.1) and drop any bullet that cites nothing, cites misplaced evidence, mentions a term on the user's never-claim list (`NeverClaim`, docs/resume.md §13.8 — Azure anywhere and Node/Express-at-work for this user; never hardcode a user's terms again), adds a number, names an uncited technology, or uses a building verb on working/maintenance evidence. Every call goes through `ResumeWriter` (fake it in tests), is logged to `AiUsage`, and is checked against `BudgetGuard.checkMonthly`. Tailoring starts only on the user's request. Staleness is derived at read time from `ResumeVariant.evidenceIds` (deleted / unverified / `updatedAt > generatedAt`) — don't add a stored stale flag. "Save as PDF" is the browser's print on a Letter stylesheet matched to the user's CV (docs/resume.md §13.1; keep bullet markers in normal flow — positioned content scrambles the PDF's text order) and appears only after approval (`POST /resumes/:id/approve`, refused when stale); keep app chrome `print:hidden`.
- **Gmail job alerts (docs/email-alerts.md §10):** OAuth is hand-rolled (`packages/shared/src/node/google.ts`, no googleapis SDK): authorization code + PKCE, scope `gmail.readonly` only. The callback is `@Public()` and identifies the attempt by a single-use hashed `OAuthState` **and** the `shortlist_oauth` nonce cookie (SameSite=Lax, path-scoped) — keep both checks (login-CSRF defense). Only the refresh token is stored, sealed with `SecretBox` (AES-256-GCM, user id as AAD); never return it or log it, never store access tokens. The worker queries ONLY the user's label and stores message metadata, never bodies. Node-only shared code lives behind `@shortlist/shared/node` — the web app must never import it. Google clients are injected (`GOOGLE_OAUTH`/`GMAIL_API`, `WORKER_*`) so tests fake them. Captured real emails go in the git-ignored `apps/worker/test/fixtures/email/.private/`; never commit them unscrubbed — `scrub:email` makes committable fixtures. Emails become jobs in `apps/worker/src/email/`: code parsers (`parsers/`, registered in `EMAIL_PARSERS`) only where volume justifies one; every other sender goes to the model through `EmailExtractor` (fake it in tests), and `checkExtracted()` keeps a job only if its title and company appear in the email and its link ref exists — never relax that. A parser that finds nothing falls back to the model and leaves a note. Alert jobs are `isPartial` until a description is pasted or found on a board (`storeJobs()`); tailoring refuses partial jobs. Email sources (`EMAIL_INBOX`) are never run by the discovery fan-out.
- **API → queue:** the API never processes jobs, it only enqueues via `JobQueues` (`apps/api/src/queue/`). Every enqueue is bounded by a timeout and mapped to 503 — BullMQ otherwise waits indefinitely for a Redis connection, hanging the HTTP request. Manual runs honour `MANUAL_RUN_COOLDOWN_HOURS`.
- **Source terms:** aggregators (Remote OK, Remotive, Jobicy, …) require showing the source name and linking back to the original posting; Apply must go to `Job.sourceUrl`, linked with `rel="noopener"` (not `noreferrer`/`nofollow` — they ask for referral traffic). Don't scrape LinkedIn, Indeed, Wellfound, or remote.co — they're email-alert sources.
- Constraints Prisma can't express go in hand-written SQL migrations (`chk_evidence_single_source` on `SkillEvidence`; the case-insensitive `Skill_userId_lower_name_key` index). Create them with `prisma migrate dev --create-only`, then edit the SQL. Keep them if you regenerate migrations.
- **Never point `--shadow-database-url` (or any `migrate diff`/`migrate reset`) at the dev database** — Prisma wipes the shadow database.
- **Ownership:** every query filters by the caller's `userId` (evidence goes through `skill: { userId }`). Another user's resource is a 404, never a 403.
- **Web app (`apps/web/`):** auth, data and styling rules are in `apps/web/CLAUDE.md`, loaded when working there.
- **Deploy (`deploy/`, docs/architecture.md §4):** one VPS, Docker Compose. One root `Dockerfile` builds `server` (API, worker and `migrate` — same image, different command) and `web` (Caddy + built app; the only service with ports; HTTPS + `/api` forwarding on one origin). A new env var must be added to `deploy/docker-compose.yml` (and `.env.example` if it's a secret) as well as the app's env schema. Empty env values count as unset. Postgres stays on the same major version as development (18).
- **PWA:** the service worker precaches the app shell only; `/api` is excluded from navigation fallback and there is no runtime caching, so per-user data is never served from cache.

## Truthfulness rules (hard constraints)

- `SkillEvidence.isVerified` defaults to `false` and must **never** be accepted from a client request body. Only a dedicated verification action may set it. Keep it out of every create/update schema.
- `isVerified` is set only by `POST /evidence/:id/verify`. Any write that changes what evidence claims resets it with `UNVERIFIED` (`src/common/verification.ts`): editing the evidence, renaming its skill, editing claim fields on its linked WorkExperience/Project (`claimChanged()` + each service's `CLAIM_FIELDS`, including a project's `workExperienceId`), or deleting that WorkExperience/Project. Any new write path must do the same.
- The career seed is a one-time bootstrap; after it, the database is canonical (`docs/career-data.md` §7.4). Add new career facts through the app or a reviewed one-off data change, never by extending `career-data.ts`. Personal contact data (phone, LinkedIn, …) lives only in the DB.
- Seed data (`packages/db/prisma/seed/career-data.ts`) must pass `findSeedProblems()` in `guards.ts`, and must never set `isVerified`. Seed scripts run on Node's type stripping: use `.ts` import extensions and erasable-only syntax (checked by `tsconfig.seed.json`).
- Any resume/AI generation code reads only `isVerified = true` evidence, and every generated bullet must trace to a user-written `whatIDid`.
- Context/depth placement rules (e.g. PERSONAL/ACADEMIC never becomes an Experience bullet; EXPOSURE older than 2 years is omitted; COMMERCIAL+WORKING goes in Skills and in Experience bullets worded as what was actually done) are in `Agents.md` §6.1. PERSONAL+PRODUCTION goes in Projects and Skills (decided 2026-10-13); COMMERCIAL+EXPOSURE, PERSONAL+MAINTENANCE and ACADEMIC+PRODUCTION/MAINTENANCE are still open, so ask before tailoring code assumes a rule for them.
- Shortlist never submits, uploads, sends email or fills a form on the user's behalf (`Agents.md` §1.2). It prepares; the user submits.
- "Azure B2C" and "Node.js/Express at CloudCard" are known false claims; if either appears in generated output, it's a bug.

## Conventions

- **ESM throughout** (`"type": "module"`, `nodenext`). Relative imports in `.ts` source end in `.js` — this is required, not a mistake.
- **Vitest** (with globals) instead of Jest, **oxlint** instead of ESLint, Prettier for formatting — one root config each, tools installed once at the root (docs/development.md §15.6). `typescript/no-floating-promises` and `no-explicit-any` are errors everywhere; mark a deliberately unawaited promise with `void`. Run `pnpm format` before committing: CI (`.github/workflows/ci.yml`) fails on unformatted files, lint, types, tests, e2e/integration and the Docker build. A red check doesn't block merging (private repo, free plan), so never merge a PR with one.
- Worker tests: adapter tests serve recorded real responses from `apps/worker/test/fixtures/` via a stubbed `fetch` — never the network. When an adapter changes, recapture its fixture.
- Web tests: Vitest + jsdom + Testing Library (`apps/web/src/**/*.test.ts(x)`), with `fetch` stubbed via `vi.stubGlobal`.
- Unit tests: `*.spec.ts` next to the source (never a `__tests__/` folder), in the package whose code they test — `packages/shared` has its own Vitest suite. Code is grouped by feature (docs/development.md §15.5). E2E tests: `apps/api/test/*.e2e-spec.ts` using Supertest against the real database. Use `createTestApp()` from `test/helpers.ts`: it registers users, tracks their IDs, and `close()` deletes only those (files run in parallel, so never bulk-delete by email domain). It also points the app at Redis database 15 — specs that open Redis themselves must use `TEST_REDIS_URL`, never database 0 (a running dev worker would consume the jobs).
- Commit messages and PRs carry no Claude attribution (no `Co-Authored-By: Claude`, no "Generated with Claude Code").
- The user wants to understand each layer — when adding an interview-relevant mechanism (queues, auth, idempotency, validation boundaries), briefly explain why the pattern is used, and prefer a hand-rolled implementation over a library that hides it.
