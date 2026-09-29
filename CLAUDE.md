# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `Agents.md` first.** It is the full project context: product scope, the reasoning behind each architecture and tech decision, the truthfulness rules, and the planned build order. Where it states a rule, follow it even if a more conventional pattern exists. Its §4/§8 build-state notes can lag behind the code — trust `packages/db/prisma/schema.prisma` and the migrations folder over the document.

## Commands

pnpm workspace (pnpm 12, Node >= 22). Run from the repo root unless noted.

```bash
pnpm install
pnpm dev:api            # builds shared, generates Prisma client, starts Nest in watch mode (:3000/health)
pnpm build              # shared -> prisma generate -> api
pnpm typecheck          # tsc --noEmit across all packages
pnpm test               # unit tests (*.spec.ts) in every package — does NOT run e2e

pnpm db:generate        # regenerate Prisma client after editing schema.prisma
pnpm db:migrate:dev     # create + apply a migration (needs DATABASE_URL in packages/db/.env)
SEED_USER_EMAIL=you@x.com pnpm --filter @shortlist/db db:seed:career [--dry-run]
                        # seed Agents.md §6 career data into an existing account, all unverified
pnpm --filter @shortlist/db test   # seed truthfulness guards (node:test)

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
apps/worker       (planned) NestJS with no HTTP server — BullMQ consumer running the discovery/AI pipeline
apps/web          (planned) React + Vite PWA
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
- Constraints Prisma can't express go in hand-written SQL migrations (`chk_evidence_single_source` on `SkillEvidence`; the case-insensitive `Skill_userId_lower_name_key` index). Create them with `prisma migrate dev --create-only`, then edit the SQL. Keep them if you regenerate migrations.
- **Never point `--shadow-database-url` (or any `migrate diff`/`migrate reset`) at the dev database** — Prisma wipes the shadow database.
- **Ownership:** every query filters by the caller's `userId` (evidence goes through `skill: { userId }`). Another user's resource is a 404, never a 403.

## Truthfulness rules (hard constraints)

- `SkillEvidence.isVerified` defaults to `false` and must **never** be accepted from a client request body. Only a dedicated verification action may set it. Keep it out of every create/update schema.
- `isVerified` is set only by `POST /evidence/:id/verify`. Any write that changes what evidence claims resets it with `UNVERIFIED` (`src/common/verification.ts`): editing the evidence, renaming its skill, editing claim fields on its linked WorkExperience/Project (`claimChanged()` + each service's `CLAIM_FIELDS`), or deleting that WorkExperience/Project. Any new write path must do the same.
- Seed data (`packages/db/prisma/seed/career-data.ts`) must pass `findSeedProblems()` in `guards.ts`, and must never set `isVerified`. Seed scripts run on Node's type stripping: use `.ts` import extensions and erasable-only syntax (checked by `tsconfig.seed.json`).
- Any resume/AI generation code reads only `isVerified = true` evidence, and every generated bullet must trace to a user-written `whatIDid`.
- Context/depth placement rules (e.g. PERSONAL/ACADEMIC never becomes an Experience bullet; EXPOSURE older than 2 years is omitted) are in `Agents.md` §6.
- "Azure B2C" and "Node.js/Express at CloudCard" are known false claims; if either appears in generated output, it's a bug.

## Conventions

- **ESM throughout** (`"type": "module"`, `nodenext`). Relative imports in `.ts` source end in `.js` — this is required, not a mistake.
- Nest 12 defaults: **Vitest** (with globals) instead of Jest, **oxlint** instead of ESLint, Prettier for formatting. `typescript/no-floating-promises` is an error.
- Unit tests: `*.spec.ts` next to the source. E2E tests: `apps/api/test/*.e2e-spec.ts` using Supertest against the real database. Use `createTestApp()` from `test/helpers.ts`: it registers users, tracks their IDs, and `close()` deletes only those (files run in parallel, so never bulk-delete by email domain).
- Commit messages and PRs carry no Claude attribution (no `Co-Authored-By: Claude`, no "Generated with Claude Code").
- The user wants to understand each layer — when adding an interview-relevant mechanism (queues, auth, idempotency, validation boundaries), briefly explain why the pattern is used, and prefer a hand-rolled implementation over a library that hides it.
