# Development workflow

How the repo is worked on: conventions, testing, migrations.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

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
- **Shared:** `packages/shared` tests its own pure code (scoring, resume placement and
  overlap, board addresses, OAuth helpers and `SecretBox`) with Vitest. A test lives in the
  package whose code it checks; the worker keeps the tests that run its prompt builder
  together with `assembleResume()`, since they cite the refs the prompt hands out.
- **Web:** Vitest + jsdom + Testing Library, `fetch` stubbed.
- **Tests sit next to the file they test** (`JobRow.tsx` + `JobRow.test.tsx`) in every
  package — never a separate `__tests__/` tree. Moving or deleting a file takes its test
  along, and an untested file is visible at a glance (2026-10-12).
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
  reset` against data you care about ([§1.3](../Agents.md)).

### 15.5 Code layout (2026-10-12)

Group code by feature; keep only what several features share in common folders.

- **Web (`apps/web/src/`):** `features/<area>/` holds an area's page, the components only
  it uses, and their tests — `auth`, `jobs` (with `job-detail/`), `evidence` (the review
  screen), `profile`, `resume`, `sources`. `components/` holds only what more than one area
  uses (`ui.tsx`, `Toast`, `Logo`, `PushLink`, `MoreMenu`, `ScoreRing`, `VerdictBadge`);
  `layout/` the app frame (`AppShell`, `InstallPrompt`); `lib/` the API client, queries,
  types and helpers, with React hooks in `lib/hooks/`; `test/` the test helpers. A
  component that a second area starts using moves to `components/`. A feature may import
  another's component (job detail shows `resume/ResumeSection`).
- **API and worker:** one Nest module folder per feature (`jobs/`, `gmail/`, `discovery/`,
  …). Wiring every feature needs lives at the root: the worker's BullMQ Redis connection is
  registered in `worker.module.ts` (`createRedis()` in `src/redis.ts`), not inside one
  feature module that the others silently depend on.
- **Why:** the flat `components/` folder had grown to ~30 files mixing app-wide building
  blocks with pieces used by one screen, and `pages/` split each page from its parts
  (`JobDetailPage.tsx` beside `job-detail/`). By feature, everything a change touches is
  in one folder. Rejected: moving tests into `__tests__/` (see §15.3).

### 15.6 CI, lint, formatting and dependencies (2026-10-12)

Checks used to run only when someone ran them locally; nothing stopped a broken change
from reaching `main`.
- **CI (`.github/workflows/ci.yml`)** runs on every pull request and every push to
  `main`, in three parallel jobs:
  - `check`: formatting, lint, typecheck, unit tests and a production build;
  - `integration`: API e2e and worker integration tests against Postgres 18 and Redis
    service containers, after `migrate deploy` on the empty database (which also proves
    every migration applies from scratch);
  - `docker`: builds the `server` and `web` images the deploy uses.
  The repo is private on a free plan, which can't make checks *required* before merging;
  until then, don't merge a PR with a red check.
- **One lint config** (`.oxlintrc.json` at the root; each package extends it). Every
  package lints with type information, so `no-floating-promises` covers the web app too —
  it found two `navigate()` calls whose promise was dropped. `no-explicit-any` is an error.
- **One formatter config** (`.prettierrc.json`: single quotes, trailing commas, 120
  columns, chosen as closest to the existing code). `pnpm format` writes, `pnpm
  format:check` is what CI runs. Prettier skips applied migrations (checksummed),
  recorded fixtures (compared byte for byte) and Markdown (hand-wrapped prose). The
  one-time reformat commit is listed in `.git-blame-ignore-revs`, so `git blame` skips it.
- **Dependencies:** lint and format tools are installed once at the root. Dependabot
  (`.github/dependabot.yml`) opens weekly PRs — minor and patch updates grouped, majors
  one by one — for npm packages, GitHub Actions and the Docker base images. A vulnerable
  package nested inside a dependency that hasn't updated yet is pinned with a pnpm
  `overrides` entry in `pnpm-workspace.yaml`, with the advisory id and when to drop it.

