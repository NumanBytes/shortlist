# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `Agents.md` first.** It is the complete project documentation: product philosophy, real-world scenarios, every design decision with its reasoning (and a dated decision log, §16), the truthfulness rules, and the roadmap (§17). Where it states a rule, follow it even if a more conventional pattern exists. For exact data shapes, trust `packages/db/prisma/schema.prisma` and the migrations folder over the document.

**Every design decision must be recorded in `Agents.md`** — in the relevant section and in the decision log — in the same change that makes it. Don't leave decisions only in chat or PR descriptions.

## Commands

pnpm workspace (pnpm 12, Node >= 22). Run from the repo root unless noted.

```bash
pnpm install
pnpm dev:api            # builds shared, generates Prisma client, starts Nest in watch mode (:3000/health)
pnpm dev:web            # Vite on :5173; proxies /api to :3000 (run dev:api alongside)
pnpm dev:worker         # queue consumer + nightly scheduler (needs Redis: REDIS_URL, default localhost)
pnpm discover           # queue a discovery run for every enabled source now (worker must be running)
pnpm build              # shared -> db (prisma generate) -> api -> worker -> web
pnpm typecheck          # tsc --noEmit across all packages
pnpm test               # unit tests (*.spec.ts) in every package — does NOT run e2e

pnpm db:generate        # regenerate Prisma client after editing schema.prisma
pnpm db:migrate:dev     # create + apply a migration (needs DATABASE_URL in packages/db/.env)
SEED_USER_EMAIL=you@x.com pnpm --filter @shortlist/db db:seed:career [--dry-run]
                        # seed Agents.md §7 career data into an existing account, all unverified
SEED_USER_EMAIL=you@x.com pnpm --filter @shortlist/db db:seed:sources [--dry-run]
                        # seed the job-source list (packages/db/prisma/seed/job-sources.ts)
pnpm --filter @shortlist/db test   # seed truthfulness guards (node:test)
pnpm --filter @shortlist/worker test               # adapters (recorded fixtures, no network), filter, dedupe
pnpm --filter @shortlist/worker test:integration   # DiscoveryService against the real DB

# API-only (apps/api)
pnpm --filter @shortlist/api test:e2e                         # *.e2e-spec.ts — hits the real DB in apps/api/.env
pnpm --filter @shortlist/api lint                             # oxlint --type-aware
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
- **Auth is hand-rolled JWT** (`src/auth/`). Do not use `@nestjs/passport` — understanding the mechanism is a stated goal. A global `AuthGuard` (`APP_GUARD`) protects **every** route; public routes opt out with `@Public()`. Get the caller with `@CurrentUser() user: AuthUser` and scope every query by `user.id`. Access tokens: HS256 JWT, 15 min, verified with a pinned algorithm. Refresh tokens: opaque random, stored as SHA-256 hash, rotated on every use; reuse of a revoked token revokes all the user's sessions. The refresh token is only ever in the httpOnly `shortlist_refresh` cookie (`src/auth/refresh-cookie.ts`, `SameSite=Strict`, `Path=/api/v1/auth`) — never put it in a response body. CORS allows credentials only for the exact origins in `WEB_ORIGINS`. Never select `passwordHash` into a response — use `PUBLIC_USER_SELECT`.
- **Worker stays a separate process.** Slow Claude calls and job fetches must never run on the API's event loop. Redis is queue-only; Postgres is the only store of record. The Claude API key belongs only in the worker's env.
- **Data model** has two halves — career "truth" (`User`, `WorkExperience`, `Project`, `Skill`, `SkillEvidence`) and machine-generated jobs (`JobSource`, `DiscoveryRun`, `Job`, `JobRequirement`) — joined only through `JobMatch`. Job sources are toggled by data (`JobSource.isEnabled`), never by code. A `DiscoveryRun` row is created in `RUNNING` state *before* fetching so a failed source is distinguishable from "no jobs".
- **Discovery (`apps/worker/src/discovery/`):** one adapter per *platform* (not per company) in `adapters/`, registered in `ADAPTERS`; the `AdapterRegistry` type forces it to match `ImplementedSourceConfigSchema` in shared. New company on an existing platform = a `JobSource` row, never code. Pipeline per source: open `DiscoveryRun` as RUNNING *before* fetching → adapter → stage A filter (title/location/age, listing only) → fetch descriptions only for survivors (`loadDescription`) → stage B (stack keywords) → dedupe by hash of normalized company+title → store. `EMPTY` (source returned nothing) must stay distinct from `SUCCESS` with 0 matches. Posting age is enforced for `AGGREGATOR_API` sources only — a job listed on a company's own board is open. Filter settings are `DiscoveryPreferences` rows (defaults in shared), never constants.
- **Queue:** `DiscoveryJob.All` (nightly via a BullMQ job scheduler stored in Redis — not in-process cron) fans out one `DiscoveryJob.Source` job per enabled source. Custom job ids can't contain `:`. `PermanentSourceError` → `UnrecoverableError` (no retries); anything else retries with backoff, each attempt its own run row. Pass BullMQ a constructed `ioredis` client (`createRedis`), not connection options.
- **AI analysis (`apps/worker/src/analysis/`, Agents.md §12):** the model (Haiku) only maps job requirements to the user's VERIFIED skills, by short refs it was given; `scoreJob()` in `packages/shared/src/scoring.ts` computes score/verdict/gaps deterministically. Never ask a model for a score or let it introduce a skill. Every model call goes through `JobAnalyzer` (fake it in tests — never spend money in tests) and is logged to `AiUsage` with its cost before the output is used; `BudgetGuard` is checked before every call and over-budget work is DEFERRED, never dropped. Structured output uses the hand-written `JOB_ANALYSIS_JSON_SCHEMA` (kept in sync with the Zod schema by a test); responses are still Zod-validated. Pricing lives in `MODEL_PRICES` (shared) — update it when prices change.
- **API → queue:** the API never processes jobs, it only enqueues via `JobQueues` (`apps/api/src/queue/`). Every enqueue is bounded by a timeout and mapped to 503 — BullMQ otherwise waits indefinitely for a Redis connection, hanging the HTTP request. Manual runs honour `MANUAL_RUN_COOLDOWN_HOURS`.
- **Source terms:** aggregators (Remote OK, Remotive, Jobicy, …) require showing the source name and linking back to the original posting; Apply must go to `Job.sourceUrl`, linked with `rel="noopener"` (not `noreferrer`/`nofollow` — they ask for referral traffic). Don't scrape LinkedIn, Indeed, Wellfound, or remote.co — they're email-alert sources.
- Constraints Prisma can't express go in hand-written SQL migrations (`chk_evidence_single_source` on `SkillEvidence`; the case-insensitive `Skill_userId_lower_name_key` index). Create them with `prisma migrate dev --create-only`, then edit the SQL. Keep them if you regenerate migrations.
- **Never point `--shadow-database-url` (or any `migrate diff`/`migrate reset`) at the dev database** — Prisma wipes the shadow database.
- **Ownership:** every query filters by the caller's `userId` (evidence goes through `skill: { userId }`). Another user's resource is a 404, never a 403.

- **Web auth (`apps/web/src/lib/api.ts`):** the access token lives in a module variable only — never localStorage/sessionStorage. The session is restored on load from the refresh cookie. All refreshes go through `refreshSession()`, which is single-flight in the tab and wrapped in a `navigator.locks` lock across tabs: two concurrent refreshes with the same cookie would trip the API's reuse detection and revoke every session. Never call `/auth/refresh` directly.
- **Web data:** server state via TanStack Query hooks in `src/lib/queries.ts`. Request bodies are validated client-side with the same `@shortlist/shared` schemas the API uses. Response types are hand-written in `src/lib/types.ts` (dates as ISO strings). Verification is never optimistic — the UI shows "verified" only after the server confirms.
- **Web styling:** use the semantic color tokens (`bg-surface`, `text-muted`, `bg-apply-bg`, … from `apps/web/src/index.css`) and the primitives in `src/components/ui.tsx` — never raw Tailwind palette colors (`slate-500`), or dark mode breaks. Icons from `lucide-react`. Job list state belongs in the URL (`useListState`), not component state. To hide a component responsively, wrap it — a `hidden` class on an element whose own classes set `display` (e.g. Button's `inline-flex`) loses.
- **PWA:** the service worker precaches the app shell only; `/api` is excluded from navigation fallback and there is no runtime caching, so per-user data is never served from cache.

## Truthfulness rules (hard constraints)

- `SkillEvidence.isVerified` defaults to `false` and must **never** be accepted from a client request body. Only a dedicated verification action may set it. Keep it out of every create/update schema.
- `isVerified` is set only by `POST /evidence/:id/verify`. Any write that changes what evidence claims resets it with `UNVERIFIED` (`src/common/verification.ts`): editing the evidence, renaming its skill, editing claim fields on its linked WorkExperience/Project (`claimChanged()` + each service's `CLAIM_FIELDS`), or deleting that WorkExperience/Project. Any new write path must do the same.
- Seed data (`packages/db/prisma/seed/career-data.ts`) must pass `findSeedProblems()` in `guards.ts`, and must never set `isVerified`. Seed scripts run on Node's type stripping: use `.ts` import extensions and erasable-only syntax (checked by `tsconfig.seed.json`).
- Any resume/AI generation code reads only `isVerified = true` evidence, and every generated bullet must trace to a user-written `whatIDid`.
- Context/depth placement rules (e.g. PERSONAL/ACADEMIC never becomes an Experience bullet; EXPOSURE older than 2 years is omitted) are in `Agents.md` §6.1 — some combinations are still an open decision; ask before tailoring code assumes one.
- Shortlist never submits, uploads, sends email or fills a form on the user's behalf (`Agents.md` §1.2). It prepares; the user submits.
- "Azure B2C" and "Node.js/Express at CloudCard" are known false claims; if either appears in generated output, it's a bug.

## Conventions

- **ESM throughout** (`"type": "module"`, `nodenext`). Relative imports in `.ts` source end in `.js` — this is required, not a mistake.
- Nest 12 defaults: **Vitest** (with globals) instead of Jest, **oxlint** instead of ESLint, Prettier for formatting. `typescript/no-floating-promises` is an error.
- Worker tests: adapter tests serve recorded real responses from `apps/worker/test/fixtures/` via a stubbed `fetch` — never the network. When an adapter changes, recapture its fixture.
- Web tests: Vitest + jsdom + Testing Library (`apps/web/src/**/*.test.ts(x)`), with `fetch` stubbed via `vi.stubGlobal`.
- Unit tests: `*.spec.ts` next to the source. E2E tests: `apps/api/test/*.e2e-spec.ts` using Supertest against the real database. Use `createTestApp()` from `test/helpers.ts`: it registers users, tracks their IDs, and `close()` deletes only those (files run in parallel, so never bulk-delete by email domain).
- Commit messages and PRs carry no Claude attribution (no `Co-Authored-By: Claude`, no "Generated with Claude Code").
- The user wants to understand each layer — when adding an interview-relevant mechanism (queues, auth, idempotency, validation boundaries), briefly explain why the pattern is used, and prefer a hand-rolled implementation over a library that hides it.
