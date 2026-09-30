# Shortlist

Finds jobs worth your time, tailors a truthful resume for each, and notifies you. You make the final click.

## Layout

    apps/api         NestJS HTTP API
    apps/web         React + Vite PWA (Tailwind, TanStack Query)
    apps/worker      Job discovery: BullMQ worker + nightly scheduler (needs Redis)
    packages/shared  Zod schemas + types shared by every app
    packages/db      Prisma schema, migrations, and client


## Setup

    pnpm install
    cp packages/db/.env.example packages/db/.env   # set DATABASE_URL (used by Prisma CLI)
    cp apps/api/.env.example apps/api/.env         # set DATABASE_URL (used by the API at runtime)
    pnpm db:migrate:dev

Seed your career data (register the account through the API first; everything is
created unverified, so review and verify each item afterwards):

    SEED_USER_EMAIL=you@example.com pnpm --filter @shortlist/db db:seed:career --dry-run
    SEED_USER_EMAIL=you@example.com pnpm --filter @shortlist/db db:seed:career

Seed the job sources to watch (company boards + remote-job aggregators):

    SEED_USER_EMAIL=you@example.com pnpm --filter @shortlist/db db:seed:sources

## Run

    pnpm dev:api          # http://localhost:3000/health
    pnpm dev:web          # http://localhost:5173 (proxies /api to the API)
    pnpm dev:worker       # discovery worker; runs nightly at 02:00 Lahore time
    pnpm discover         # run discovery now (with the worker running)
    pnpm test
    pnpm typecheck
