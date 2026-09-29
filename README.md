# Shortlist

Finds jobs worth your time, tailors a truthful resume for each, and notifies you. You make the final click.

## Layout

    apps/api         NestJS HTTP API
    packages/shared  Zod schemas + types shared by every app
    packages/db      Prisma schema, migrations, and client

Coming next: apps/worker (queues, scheduler), apps/web (React + Vite PWA).

## Setup

    pnpm install
    cp packages/db/.env.example packages/db/.env   # set DATABASE_URL (used by Prisma CLI)
    cp apps/api/.env.example apps/api/.env         # set DATABASE_URL (used by the API at runtime)
    pnpm db:migrate:dev

Seed your career data (register the account through the API first; everything is
created unverified, so review and verify each item afterwards):

    SEED_USER_EMAIL=you@example.com pnpm --filter @shortlist/db db:seed:career --dry-run
    SEED_USER_EMAIL=you@example.com pnpm --filter @shortlist/db db:seed:career

## Run

    pnpm dev:api          # http://localhost:3000/health
    pnpm test
    pnpm typecheck
