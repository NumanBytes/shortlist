# syntax=docker/dockerfile:1
#
# One Dockerfile for the monorepo (docs/architecture.md §4, "Deployment"). Two final images:
#   server — the API, the worker AND the migration step: same code, different command
#   web    — Caddy serving the built React app and forwarding /api to the API
# Built by deploy/docker-compose.yml; see deploy/README.md.

FROM node:22-bookworm-slim AS base
# OpenSSL: Prisma's query engine links against it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# The pnpm version pinned in package.json's "packageManager", fetched once at build time.
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
WORKDIR /app

# ── Build everything ──────────────────────────────────────────────────────────
FROM base AS build
# Manifests first: the dependency layer is reused until a package.json or the lockfile
# changes, so editing source doesn't re-download every package.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# shared -> db (prisma generate) -> api -> worker -> web
RUN pnpm build
# Drop dev dependencies (compilers, test tools) from what the server image ships. The
# Prisma CLI stays: it's a runtime dependency of @shortlist/db, for `migrate deploy`.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --prod --frozen-lockfile

# ── Server image: API, worker, migrations ─────────────────────────────────────
FROM base AS server
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
# Never run as root inside the container.
USER node
# The compose file picks the command; the API is the default.
CMD ["node", "apps/api/dist/main.js"]

# ── Web image: Caddy + the built app ──────────────────────────────────────────
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
