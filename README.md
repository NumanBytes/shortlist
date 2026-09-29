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

## Run

    pnpm dev:api          # http://localhost:3000/health
    pnpm test
    pnpm typecheck
