# Shortlist

Finds jobs worth your time, tailors a truthful resume for each, and notifies you. You make the final click.

## Layout

apps/api         NestJS HTTP API
packages/shared  Zod schemas + types shared by every app

Coming next: apps/worker (queues, scheduler), apps/web (React + Vite PWA), packages/db (Prisma).

## Run

    pnpm install
    pnpm dev:api          # http://localhost:3000/health
    pnpm test
