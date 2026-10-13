# Deploying Shortlist on one server

Everything runs on a single rented Linux server (a VPS) with Docker Compose
(docs/architecture.md §4, "Deployment"). This guide assumes no prior server experience.

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

Two ways, same result: an Ubuntu LTS server with **2 GB RAM or more**, a fixed public IPv4
address, and your SSH key. Everything after step 1 works on either (docs/architecture.md §4).

- **1A. AWS EC2 `t4g.small`**: free on AWS's free plan (credits for 6 months), and
  practice with AWS itself. Plan the move to 1B before the plan ends ("Moving to another
  server").
- **1B. A budget VPS**: a few dollars a month, no deadline.

Where they differ later, the guide says so. **YOUR_USER** below is `ubuntu` on AWS and
`root` on a VPS.

### 1A. AWS EC2

**Account safety first** (as the root user, once):
1. Account menu (top-right) → **Security credentials** → **Assign MFA device** →
   Authenticator app. The root user can spend money; a password alone isn't enough.
2. Account menu → **Account** → **IAM user and role access to Billing information** →
   Edit → **Activate**. Without it, even an admin IAM user can't see billing.
3. **IAM → User groups → Create group** `Admins` with the **AdministratorAccess** policy.
   **Users → Create user** `numan-admin`: console access, "I want to create an IAM user",
   custom password, added to `Admins`. Permissions go on the group, not the user, so a
   second person would just join the group. No access keys: the console doesn't need them.
4. **IAM → Dashboard → Account alias** (e.g. `numan-shortlist`), bookmark the sign-in link
   it shows, sign out, and sign in as `numan-admin`. Add MFA to this user too. Use root
   only for billing and account settings from now on.
5. **Billing and Cost Management → Budgets → Create budget → Zero spend budget** with your
   email: you hear about the first real charge immediately.

**Region:** top-right menu → **Asia Pacific (Mumbai) `ap-south-1`**, the nearest region to
Pakistan that's on by default. The console only shows the current region's resources: if
your server "disappears", check the region first.

**SSH key:** on your laptop, `cat ~/.ssh/id_ed25519.pub` (create one with
`ssh-keygen -t ed25519` if it doesn't exist). **EC2 → Key pairs → Actions → Import key
pair**, name it `laptop`, paste the key.

**EC2 → Instances → Launch instances:**

| Field | Value |
|---|---|
| Name | `shortlist` |
| AMI | **Ubuntu Server 26.04 LTS** (or 24.04 LTS), architecture **64-bit (Arm)** |
| Instance type | **t4g.small** (2 vCPU, 2 GB) |
| Key pair | `laptop` |
| Network settings → Edit | New security group `shortlist-web`, inbound rules below |
| Storage | **30 GiB gp3** (the default 8 GiB fills up with Docker images) |

| Type | Port | Source | Why |
|---|---|---|---|
| SSH | 22 | **My IP** | Only your laptop can log in |
| HTTP | 80 | Anywhere (0.0.0.0/0) | Let's Encrypt checks it to issue the certificate; Caddy redirects the rest to HTTPS |
| HTTPS | 443 | Anywhere (0.0.0.0/0) | The app |

t4g servers use AWS's Graviton (**ARM**) processors, so the AMI must be the Arm one. Every
image Shortlist uses is published for ARM and the images are built on the server, so
nothing else changes. The security group is AWS's firewall in front of the server. If your
home IP changes and SSH stops connecting, edit the SSH rule and choose **My IP** again.

**Fixed address:** an instance's public IP changes whenever it stops and starts. **EC2 →
Elastic IPs → Allocate**, then **Actions → Associate** with `shortlist`. That address is
**YOUR_SERVER_IP**. (A public IPv4 costs about $3.60/month on AWS; the credits cover it.
An Elastic IP left unattached is still billed, so release it if you delete the server.)

### 1B. A budget VPS

Pick a **KVM** plan (not OpenVZ: Docker needs KVM) with **2 GB RAM or more**, **Ubuntu
24.04/26.04 LTS**, in **Europe** (the closest to Pakistan most budget providers offer).
Monthly: Contabo Cloud VPS 10 (8 GB, about €5) or a Netcup G12 VPS (2 GB, no minimum term).
Yearly: RackNerd's 2 GB deals (about $18–36/year). The welcome email has the **IPv4
address** (YOUR_SERVER_IP) and a **root password**, which step 3a replaces with your key.

## 2. Get a free hostname (DuckDNS)

1. Sign in at <https://www.duckdns.org> (with Google or GitHub).
2. Create a subdomain, e.g. `numan-shortlist` → `numan-shortlist.duckdns.org`.
3. Set its IP to your server's IPv4 address and save.

HTTPS needs a hostname, and a phone only installs the app over HTTPS.

## 3. Prepare the server

### 3a. SSH keys only (VPS only — AWS servers already accept keys only)

The VPS accepts the root **password** from the email. Bots try passwords on every public
server all day, so log in with your key and turn password logins off.

On your laptop:

```bash
ssh-copy-id root@YOUR_SERVER_IP     # asks for the emailed root password, once
ssh root@YOUR_SERVER_IP             # must log in WITHOUT asking for a password
```

On the server:

```bash
passwd   # replace the emailed root password

# Files in sshd_config.d are read in name order and the first value wins, so "00-" beats
# any provider file that turns passwords back on.
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' \
  > /etc/ssh/sshd_config.d/00-keys-only.conf
sshd -t && systemctl restart ssh
```

**Before closing this window,** run `ssh root@YOUR_SERVER_IP` from a second terminal. It
must still log you in. If it doesn't, fix it from the window that's still open (or the
provider's web console).

### 3b. Updates, Docker, swap (both)

```bash
ssh YOUR_USER@YOUR_SERVER_IP

sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # run docker without sudo (from the next login)

# 2 GB of swap: building the images needs more memory than a small server has.
# Skipped if the server already has swap.
if [ -z "$(swapon --show)" ]; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
```

**VPS only** (AWS's security group already does this): a firewall that lets in only SSH
and web traffic.

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```

Log out (`exit`) and back in, then check:

```bash
docker run --rm hello-world   # "Hello from Docker!" without sudo
free -h                       # "Swap:" about 2G or more
```

Postgres and Redis publish no ports, so nothing but Caddy is reachable from outside.

## 4. Get the code and configure it

The repository is private, so the server gets its own **deploy key**: an SSH key that can
only *read* this one repository. If the server were ever compromised, the attacker gets
read access to Shortlist's code, not your GitHub account.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/shortlist_deploy -N '' -C shortlist-server
printf 'Host github.com\n  IdentityFile ~/.ssh/shortlist_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
cat ~/.ssh/shortlist_deploy.pub
```

On GitHub: the repository → **Settings → Deploy keys → Add deploy key**, title
`shortlist-server`, paste the key, leave **Allow write access unticked**. Then:

```bash
git clone git@github.com:NumanBytes/shortlist.git   # type "yes" to trust github.com
cd shortlist/deploy
cp .env.example .env
nano .env        # fill it in — instructions are in the file
```

Generate the two secrets straight into `.env` (nothing to copy, nothing to lose), **before
the first start**: Postgres stores its password when it creates the database, and editing
`.env` later doesn't change it.

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
grep -E '^(POSTGRES_PASSWORD|JWT_ACCESS_SECRET)=' .env | cut -c1-30   # both filled
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

The first build takes several minutes (longer on a small server; the swap from step 3 is
what lets it finish). Then open `https://numan-shortlist.duckdns.org`.

## 6. Bring your local data over (optional)

Your laptop's database has your verified evidence, jobs and resumes. To move it:

```bash
# On your laptop: dump the local database
pg_dump --no-owner --no-privileges "postgresql://cloud:PASSWORD@localhost:5432/shortlist" | gzip > shortlist.sql.gz
scp shortlist.sql.gz YOUR_USER@YOUR_SERVER_IP:~/shortlist/deploy/

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

Chrome may mark the site **"Dangerous"** right after you sign in, while the certificate
shows as valid. That's its password protection: a password it has saved for another site
(e.g. `localhost`) was typed on a new, unknown site, and free DuckDNS subdomains have a
poor reputation because phishers use them too. Click **Site is legitimate**. If a full red
"Deceptive site ahead" page ever appears instead, the address itself has been flagged:
check it at <https://transparencyreport.google.com/safe-browsing/search> and request a
review.

## Push notifications (optional)

Generate a VAPID key pair once (on your laptop: `pnpm --filter @shortlist/worker build &&
pnpm --filter @shortlist/worker vapid:keys`), put the three lines in `deploy/.env`, and restart
with `docker compose up -d`. Then on the phone: Profile → Notifications → Turn on → Send a test
(docs/notifications.md §19). Keep the same pair afterwards — a new one makes every device turn
notifications on again.

## Updating after new code is merged

```bash
cd ~/shortlist && git pull && cd deploy && docker compose up -d --build
```

Migrations run automatically before the new API and worker start.

## Backups

Two layers:

| | Where | When | Kept | Protects against |
|---|---|---|---|---|
| Nightly dump | `~/shortlist/deploy/backups/` on the server | 03:30 | 14 days | Mistakes: a bad migration, a deleted row |
| Off-site copy | Google Drive, folder `shortlist-backups` | 04:00 | 30 days | Losing the server or the whole hosting account |

At worst you lose the day since the last 04:00 copy. Restore either one: same as step 6,
with that file (download it from Google Drive first).

### Off-site copies (Google Drive): one-time setup, about 15 minutes

The `offsite` service uses **rclone** (a command-line tool for cloud storage). It needs
permission to write to your Google Drive once. The server has no browser, so the
Google sign-in happens on your laptop and you paste the result back.

1. **On your laptop:** `sudo apt install rclone`.
2. **On the server**, in `~/shortlist/deploy`:
   ```bash
   docker compose run --rm --entrypoint rclone offsite config
   ```
   Answer:
   - `n` (new remote), name: **`gdrive`**
   - Storage: type **`drive`**
   - `client_id` and `client_secret`: press **Enter** (rclone's own)
   - `scope`: type **`drive.file`**. rclone can then only see files it created itself,
     not the rest of your Drive. Least privilege: a leaked token can't read your documents.
   - `service_account_file`: Enter. Edit advanced config: `n`
   - **Use web browser to automatically authenticate?** `n` (the server has none). It
     prints a command like `rclone authorize "drive" "eyJ…"`.
3. **On your laptop**, run that exact command. A browser opens: sign in to Google and
   allow access. The laptop terminal prints a long token (`eyJ…` or `{…}`): copy all of it.
4. **Back on the server**, paste it at the `config_token>` prompt. Shared Drive: `n`.
   Keep this remote: `y`. Then `q` to quit.
5. Start the service and test it now instead of waiting for 04:00:
   ```bash
   docker compose up -d offsite
   docker compose exec offsite /bin/sh /offsite-backup.sh
   ```
   Expect `offsite: copied shortlist-…sql.gz to gdrive:shortlist-backups`, and a
   `shortlist-backups` folder with that file at <https://drive.google.com>.

The token is stored in `deploy/rclone/rclone.conf`. It's git-ignored; treat it like a
password. If you remove access in your Google account, rerun step 2.

### Get an email when a copy fails (optional, 5 minutes)

The script fails loudly in the logs, but nobody reads logs at 04:00. A **dead man's
switch** turns silence into an alert: the script checks in after every run, and a free
service emails you when a check-in fails *or never arrives* (the server's down, the
service stopped). Only an outside service can notice that nothing happened.

1. Sign up at <https://healthchecks.io> (free), **Add Check**: period **1 day**, grace
   **2 hours**. Copy its ping URL (`https://hc-ping.com/…`).
2. On the server: add `OFFSITE_PING_URL=https://hc-ping.com/…` to `.env`, then
   `docker compose up -d offsite` and run the test command from step 5. The check turns
   green.

## Useful commands

| Task | Command (in `~/shortlist/deploy`) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f worker` |
| Restart one service | `docker compose restart api` |
| Run a database backup now | `docker compose exec backup /bin/sh /backup.sh` |
| Copy the newest backup to Google Drive now | `docker compose exec offsite /bin/sh /offsite-backup.sh` |
| Last off-site copy result | `docker compose logs --tail 5 offsite` |
| Open the database | `docker compose exec postgres psql -U shortlist` |
| Find new jobs now (no app) | `docker compose exec worker node apps/worker/dist/cli/discover-now.js` |

## Moving to another server

Nothing in Shortlist is tied to one provider, so moving (AWS's free plan ending, a better
deal) is this guide again:

1. On the old server: `docker compose exec backup /bin/sh /backup.sh`, then
   `docker compose exec offsite /bin/sh /offsite-backup.sh`. The newest dump is now in
   Google Drive: download it.
2. On the new server: steps 3–5, with the **same `TOKEN_ENCRYPTION_KEY`** (your Gmail
   connection was encrypted with it). Copy `deploy/rclone/rclone.conf` across too (or
   redo "Off-site copies") so the Google Drive copies continue.
3. Step 6 with that backup file.
4. Point the DuckDNS hostname at the new IP. Caddy gets a new certificate by itself, and
   the Google redirect URI stays the same because the hostname does.
5. Check the app on your phone, then cancel the old server (on AWS: terminate the
   instance **and release the Elastic IP**, which is billed while unattached).
