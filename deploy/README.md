# Deploying Shortlist on one server

Everything runs on a single rented Linux server (a VPS) with Docker Compose
(Agents.md §4, "Deployment"). This guide assumes no prior server experience.

```
phone ──HTTPS──► Caddy ─┬─ the web app (static files)
                        └─ /api/* ──► API ──► Postgres
                                       │
                                       └──► Redis (queue) ──► Worker ──► job boards, Gmail, Claude
```

| Service    | What it is                                                                 |
|------------|----------------------------------------------------------------------------|
| `caddy`    | The only thing open to the internet. HTTPS (automatic), serves the app, forwards `/api`. |
| `api`      | The NestJS API. Only reachable through Caddy.                              |
| `worker`   | Runs non-stop: nightly job search, Gmail checks, scoring, tailoring.       |
| `postgres` | The database — all your data. Stored on a Docker volume.                   |
| `redis`    | The job queue between the API and the worker.                              |
| `migrate`  | Runs once on every start: updates the database schema, then exits.         |
| `backup`   | Dumps the database every night at 03:30 (Pakistan time) into `deploy/backups/`. |

## 1. Rent the server

Any provider with Ubuntu works (Hetzner, DigitalOcean, Vultr…). Pick:

- **Ubuntu 24.04**, the smallest plan with **2 GB RAM** (about $4–6/month).
- Add your **SSH key** when creating it (on your laptop: `cat ~/.ssh/id_ed25519.pub`;
  create one with `ssh-keygen -t ed25519` if that file doesn't exist).

Note the server's **IPv4 address**.

## 2. Get a free hostname (DuckDNS)

1. Sign in at <https://www.duckdns.org> (with Google or GitHub).
2. Create a subdomain, e.g. `numan-shortlist` → `numan-shortlist.duckdns.org`.
3. Set its IP to your server's IPv4 address and save.

HTTPS needs a hostname, and a phone only installs the app over HTTPS.

## 3. Prepare the server

```bash
ssh root@YOUR_SERVER_IP

# Updates, Docker, and a firewall that allows only SSH and web traffic
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# 2 GB of swap: building the images needs more memory than a small server has
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Get the code and configure it

```bash
git clone https://github.com/NumanBytes/shortlist.git
cd shortlist/deploy
cp .env.example .env
nano .env        # fill it in — instructions are in the file
```

Generate the secrets on the server:

```bash
openssl rand -base64 24 | tr -d '/+='   # POSTGRES_PASSWORD
openssl rand -base64 48                 # JWT_ACCESS_SECRET
```

`TOKEN_ENCRYPTION_KEY`: use the **same value as in `apps/api/.env` on your laptop** if
you'll bring your local data over (step 6) — your connected Gmail token was encrypted
with it.

**Google (Gmail alerts):** in Google Cloud Console → APIs & Services → Credentials → your
OAuth client, add the authorized redirect URI
`https://numan-shortlist.duckdns.org/api/v1/gmail/callback` (your hostname).

## 5. Start it

```bash
docker compose up -d --build
docker compose ps          # all "running" (and "migrate" exited 0)
docker compose logs -f api worker caddy   # Ctrl+C to stop watching
```

The first build takes several minutes. Then open `https://numan-shortlist.duckdns.org`.

## 6. Bring your local data over (optional)

Your laptop's database has your verified evidence, jobs and resumes. To move it:

```bash
# On your laptop: dump the local database
pg_dump --no-owner --no-privileges "postgresql://cloud:PASSWORD@localhost:5432/shortlist" | gzip > shortlist.sql.gz
scp shortlist.sql.gz root@YOUR_SERVER_IP:~/shortlist/deploy/

# On the server: stop the app, load the dump into the empty database, start again
cd ~/shortlist/deploy
docker compose stop api worker
docker compose exec -T postgres psql -U shortlist -d shortlist -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c shortlist.sql.gz | docker compose exec -T postgres psql -U shortlist -d shortlist
docker compose up -d
```

Skip this to start fresh: register a new account and seed it (step 7).

## 7. Seeding a fresh account (only if you skipped step 6)

```bash
docker compose run --rm -w /app/packages/db -e SEED_USER_EMAIL=you@example.com migrate \
  node --experimental-strip-types --no-warnings prisma/seed/seed-sources.ts
```

## 8. Install it on your phone

Open the address in Chrome (Android) → menu → **Install app**, or Safari (iPhone) →
Share → **Add to Home Screen**.

## Updating after new code is merged

```bash
cd ~/shortlist && git pull && cd deploy && docker compose up -d --build
```

Migrations run automatically before the new API and worker start.

## Backups

Nightly dumps land in `~/shortlist/deploy/backups/` (14 days kept). They protect against
mistakes, **not** against losing the server — copy them somewhere else now and then:

```bash
# On your laptop
scp root@YOUR_SERVER_IP:'~/shortlist/deploy/backups/*' ~/shortlist-backups/
```

Restore one: same as step 6, with that file.

## Useful commands

| Task | Command (in `~/shortlist/deploy`) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f worker` |
| Restart one service | `docker compose restart api` |
| Run a database backup now | `docker compose exec backup /bin/sh /backup.sh` |
| Open the database | `docker compose exec postgres psql -U shortlist` |
| Find new jobs now (no app) | `docker compose exec worker node apps/worker/dist/cli/discover-now.js` |
