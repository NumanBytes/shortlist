# Decision log

Every design decision with its date and where it is described. Newest entries are added here in the same change that makes them.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 16. Decision log

| Date | Decision | Why / notes |
|---|---|---|
| 2026-09 | The human always clicks submit; full automation rejected | ToS bans auto-applying; recruiters detect bots; every claim must be approved ([§1.2](../Agents.md)) |
| 2026-09 | `isVerified` defaults false; generation reads verified evidence only | Azure B2C incident ([§1.3](../Agents.md)) |
| 2026-09 | Name "Shortlist"; English names only | [§2](../Agents.md) |
| 2026-09 | API / worker / web as separate processes; Redis queue-only | [§4](architecture.md) |
| 2026-09 | NestJS, hand-rolled JWT, Zod-only validation, Postgres+Prisma, React+Vite | [§14](architecture.md) |
| 2026-09-30 | Feature-branch + PR workflow; no long-lived develop branch | [§15.1](development.md) |
| 2026-09-30 | No Claude attribution in commits/PRs | User request |
| 2026-09-30 | bcrypt (argon2 removed); passwords ≤72 bytes; emails lowercased | [§8.1](security.md) |
| 2026-09-30 | Refresh rotation with reuse detection; opaque tokens hashed with SHA-256 | [§8.1](security.md) |
| 2026-09-30 | Evidence edits and skill renames un-verify; verify is its own endpoint | [§6.3](../Agents.md) |
| 2026-09-30 | Case-insensitive skill names via raw-SQL index | [§5.2](architecture.md) |
| 2026-09-30 | Role/project claim-field edits and deletes un-verify linked evidence; http(s)-only URLs | [§6.3](../Agents.md), [§8.5](security.md) |
| 2026-09-30 | Career data seeded unverified with guards; dates supplied by the user | [§7](career-data.md) |
| 2026-09-30 | Never use the dev DB as a Prisma shadow database | Shadow-DB reset incident ([§1.3](../Agents.md)) |
| 2026-10-01 | Refresh token only in an httpOnly SameSite=Strict cookie; web and API must share a site | [§8.2](security.md), [§4](architecture.md) |
| 2026-10-01 | Access token in memory only; single-flight + Web Lock refresh | [§8.3](security.md) |
| 2026-10-01 | Tailwind CSS and TanStack Query for the web app | User's choice ([§14](architecture.md)) |
| 2026-10-01 | Adapters per platform, not per company; all 48 sources recorded as data | [§9.2](discovery.md)–9.3 |
| 2026-10-01 | Two-stage rule filter driven by per-user `DiscoveryPreferences` | [§9.6](discovery.md) |
| 2026-10-01 | Posting age enforced on aggregators only | Age-filter incident ([§1.3](../Agents.md)) |
| 2026-10-01 | Dedupe by normalized company+title, location excluded | [§9.7](discovery.md) |
| 2026-10-01 | BullMQ scheduler stored in Redis (not in-process cron); fan-out per source | [§9.8](discovery.md) |
| 2026-10-01 | Manual run cooldown 6h; API enqueue bounded by 3s timeout → 503 | [§9.9](discovery.md) |
| 2026-10-01 | Source attribution + link-back; `rel="noopener"` without `noreferrer` | Aggregator terms ([§9.10](discovery.md)) |
| 2026-10-01 | Wellfound, remote.co, LinkedIn, Indeed via email alerts only; Turing isn't a source | [§9.2](discovery.md), [§10](email-alerts.md) |
| 2026-10-01 | Custom careers sites via change watcher + Haiku extraction (Milestone 3) | [§9.12](discovery.md) |
| 2026-10-02 | Use the user's personal Gmail (no new inbox); OAuth `gmail.readonly`; worker reads only the `Shortlist` label; never sends | [§10.2](email-alerts.md)–10.3 |
| 2026-10-02 | Email alerts move ahead of discovery Milestone 2, after AI scoring | [§10.1](email-alerts.md), [§17](roadmap.md) |
| 2026-10-02 | Partial-info jobs; "paste full description" once, only for Interested jobs | [§10.5](email-alerts.md) |
| 2026-10-02 | Board discovery: suggest watching companies found in alerts that have public boards | [§9.12](discovery.md) |
| 2026-10-02 | "Add a job" (paste text/link) + Android share target; bypasses score threshold | [§11](discovery.md) |
| 2026-10-02 | Resume library: variants matched by requirement overlap (not title), base variants per niche, stale on evidence change; `TailoredResume` → variants + application record | [§13.2](resume.md)–13.4 |
| 2026-10-02 | Application kit: drafted email (user sends), screening answers, outreach drafts | [§13.5](resume.md) |
| 2026-10-02 | Scam-posting red flags; "possibly closed" jobs aren't tailored | [§3.9](scenarios.md), [§3.11](scenarios.md) |
| 2026-10-02 | Every design decision is recorded in this document | User request |
| 2026-10-02 | Separate *finding sources* (monthly, targeted ATS-scoped web search + free board probing) from *finding jobs* (nightly, no AI) | [§9.11](discovery.md) |
| 2026-10-02 | Claude web search is never used for nightly job discovery | Cost, non-determinism, silent misses ([§9.11](discovery.md)) |
| 2026-10-02 | Budget re-estimated at current prices: ≈ $2–3/month; initial $5 credit | [§12.2](ai-scoring.md) |
| 2026-10-02 | Budget guard: Console spend limit + nightly AI-call caps, per-call cost log, spend shown in app | [§12.3](ai-scoring.md) |
| 2026-10-02 | Claude Pro is for development and manual work, not for powering the worker | [§12.4](ai-scoring.md) |
| 2026-10-02 | The model maps requirements to verified skills; deterministic code scores (no model-produced scores) | [§12.1](ai-scoring.md) |
| 2026-10-02 | Exact vs related matches: related earns half credit and stays a gap — never claimed | [§12.1](ai-scoring.md) |
| 2026-10-02 | Hand-written JSON schema for structured output (SDK converter dropped enums) + Zod validation | [§12.1](ai-scoring.md) |
| 2026-10-02 | Out-of-credit → DEFERRED; invalid output → FAILED without retry; analysed jobs never re-billed | [§12.1](ai-scoring.md) |
| 2026-10-02 | No prompt caching (below Haiku's 4,096-token minimum) and no Batch API yet (saving too small for the complexity) | [§12.1](ai-scoring.md) |
| 2026-10-02 | Budget guard defaults: $4.50/month, 40 analyses/24h; deferred jobs retried nightly | [§12.3](ai-scoring.md) |
| 2026-10-02 | Analysis deduplicated per job across all enqueue paths; re-analysis only after a newly verified skill | [§12.1](ai-scoring.md) (code review) |
| 2026-10-02 | "Best match" ranks every scored job (two queries), not only the newest 200 | Code review |
| 2026-10-02 | Career data: "API Integration" (Ruby → GraphQL) named by the user; GraphQL, Git, REST APIs, npm commercial; prompting commercial WORKING; pnpm personal; Next.js corrected to EXPOSURE; Shortlist stack added as EXPOSURE ("learning") | [§7.1](career-data.md) — user-confirmed, all unverified until reviewed |
| 2026-10-02 | Seed data first, verify, THEN score — scoring before verifying new skills would pay for every job twice | [§12.1](ai-scoring.md) re-analysis rule |
| 2026-10-02 | First real scoring run: 30 jobs, $0.18 | [§17.1](roadmap.md) |
| 2026-10-02 | Exact skill-name matches decided in code; alternatives extracted as one requirement; remote regions by allow-list | [§9.6](discovery.md), [§12.1](ai-scoring.md) — from the first real run |
| 2026-10-02 | UI redesign: semantic tokens + automatic dark mode, bottom tab bar on phones, score-ring rows, split list/detail, URL list state, SKIPs folded | [§8.4](web-design.md) |
| 2026-10-02 | Resume tailoring before email alerts | User's choice ([§17.2](roadmap.md)) |
| 2026-10-02 | COMMERCIAL + WORKING → Skills section + Experience bullets worded as what was actually done | User's choice ([§6.1](../Agents.md)) |
| 2026-10-02 | Profile (resume header fields) and Education tables; personal data in the DB only | [§5.2](architecture.md) |
| 2026-10-02 | Projects can belong to a role; the link is a claim field | [§5.2](architecture.md), [§6.3](../Agents.md) |
| 2026-10-02 | Evidence context and depth editable in the UI; the edit un-verifies | [§6.3](../Agents.md) |
| 2026-10-02 | Seed is a one-time bootstrap; afterwards the database is canonical | [§7.4](career-data.md) |
| 2026-10-02 | Tailoring built: Sonnet words bullets citing E-refs; code checks each bullet (placement, belonging, Azure/Node, numbers, uncited technologies, building verbs) and drops failures with a reason | [§13.1](resume.md) |
| 2026-10-02 | Tailoring only on the user's request, from an Interested, scored job | [§13.1](resume.md) |
| 2026-10-02 | Exposure-only skills go in a code-labelled "Learning" group | [§13.1](resume.md) |
| 2026-10-02 | PDF via the browser's print to PDF on an A4 stylesheet, in the user's CV layout; no PDF library | [§13.1](resume.md) |
| 2026-10-05 | Motion spec implemented: View Transitions push + shared ring (manual `startViewTransition`, waits for route commit), edge-swipe back (installed app only), sheet slide-out + drag-to-dismiss, row swipe with Undo return, toast exit; reduced-motion fades | [§8.4.2](web-design.md) |
| 2026-10-05 | Roles/projects editing, Edit URL (`parseBoardAddress`), cancel tailoring (dedup id lookup; 409 once running), ··· menus incl. copy resume as text | [§8.4.2](web-design.md) |
| 2026-10-04 | Design fidelity pass (side-by-side with each board) + phase 3 screens; System/Light/Dark appearance (pre-paint, per device); single-source retry, today's spend, jobs this week | [§8.4.1](web-design.md) — user doubted fidelity, asked for a theme switch |
| 2026-10-04 | E2E tests use Redis database 15, never 0 | [§15.3](development.md) — a running dev worker consumed the jobs e2e tests queued |
| 2026-10-11 | App icon and in-app mark: "the slice" (three bars on one diagonal cut, the green one past it), one geometry for favicon, home screen and header; PNGs rendered from SVG by `icons/render.sh`; separate full-bleed maskable icon | [§8.4.3](web-design.md) — user found the checkmark too basic; chosen from 7 drawn options |
| 2026-10-11 | Docs split: `Agents.md` keeps why/scope/truthfulness/working agreements plus a map; each area gets a `docs/*.md` file; section numbers kept stable across files; decisions go in the topic file + this log | [Agents.md](../Agents.md) — 2,079 lines was too long to read; one file mixed reference and history |
| 2026-10-11 | Code review fixes: prune expired refresh tokens on issue; analysis DONE is a compare-and-set on `rawJD`; one `mapPostings` validation boundary (http(s) URLs); queue/dedupe ids shared via `@shortlist/shared` (nightly fan-out gains a dedupe id); `EmailMessage.parserFailed` flag; atomic OAuth-state consume; GCM tag pinned to 16 bytes | [§8.1](security.md), [§9.3](discovery.md), [§9.8](discovery.md), [§10.3](email-alerts.md), [§10.4](email-alerts.md), [§12.1](ai-scoring.md) |
| 2026-10-11 | Icon follow-ups: every PNG rendered from `favicon.svg` alone (checked load, all-or-nothing); install sheet uses the Logo; Caddy `no-cache` on icons | [§8.4.3](web-design.md) |
| 2026-10-12 | Code grouped by feature: web `features/<area>/` (page + its components + tests), `components/` only for shared pieces, `layout/`, `lib/hooks/`; tests stay beside their file (no `__tests__/`); `packages/shared` runs its own Vitest tests; worker's BullMQ Redis connection registered at the root (`src/redis.ts`) | [§15.3](development.md), [§15.5](development.md) — user found the flat `components/` folder hard to navigate |
| 2026-10-12 | CI on GitHub Actions: `check` (format, lint, typecheck, unit tests, build), `integration` (e2e + worker integration on Postgres 18 / Redis services, after `migrate deploy`), `docker` (both images) | [§15.6](development.md) — checks only ran when remembered |
| 2026-10-12 | One root oxlint config, type-aware in every package (`no-floating-promises`, `no-explicit-any` errors); one root Prettier config (120 columns), one reformat commit ignored by `git blame` | [§15.6](development.md) — 107 API/worker files didn't match their own Prettier config; web had no type-aware lint |
| 2026-10-12 | Dependabot weekly (grouped minor/patch); nested advisories pinned with pnpm `overrides` (`deepmerge-ts` via Prisma, `source-map-js`); unused `@nestjs/mau` and `vite-tsconfig-paths` removed | [§15.6](development.md) |
| 2026-10-12 | Dependabot ignores Node image majors; Node upgrades go to even (LTS) releases with `.nvmrc` and the Dockerfile together | [§15.6](development.md) — its first PR (#31) proposed Node 25, a non-LTS release |
| 2026-10-12 | `@types/node` pinned to `^22` (matches the runtime; was 24); Dependabot skips its majors. Prisma CLI + client grouped, Prisma majors skipped (planned upgrades); `vitest` + `@vitest/*` grouped | [§15.6](development.md) — #34 bumped only `@prisma/client` to 7 and broke `prisma generate`; #36 proposed types for Node 26; #35 bumped `vitest` without its coverage plugin |
| 2026-10-12 | Error boundaries: per screen in `AppShell` (reset by path) and around the whole app; fallback offers Reload and Go to Jobs | [§8.4.4](web-design.md) — a render error blanked the installed app |
| 2026-10-04 | Mobile design implemented in the existing PWA (tokens, Geist, native-`<dialog>` sheets, pushed screens without tab bar, status sheet, `GET /jobs/counts`); fake progress steps, the sample resume and "Forgot password" not copied | [§8.4.1](web-design.md) — user's Claude Design boards |
| 2026-10-09 | Off-site backups: `offsite` Compose service (rclone image) copies the newest dump to Google Drive at 04:00, 30 days kept; scope `drive.file`; fails loudly on a missing/stale dump; optional dead man's switch ping | [§4](architecture.md) — server and hosting account can both be lost |
| 2026-10-08 | Host: AWS EC2 t4g.small (Graviton, Mumbai) on the 6-month free plan, then a budget VPS; guide has both as step 1A/1B; private repo cloned with a read-only deploy key; off-AWS backups next | [§4](architecture.md) — Oracle Always Free kept failing ("Out of capacity"); user wants AWS experience |
| 2026-10-04 | Deploy on one VPS with Docker Compose (Caddy for HTTPS, Postgres 18, Redis, API, worker, migrate, nightly backup); DuckDNS hostname; empty env values = unset | [§4](architecture.md) — user's choice over free tiers (Upstash quota vs BullMQ polling; sleeping hosts can't run the worker) |
| 2026-10-04 | Tailoring prompt: ≤18 words, one topic, no company name, scope stated positively, no minimum (it caused padding); skill names resolved only to offered skills; `preview:resume` CLI | [§13.1](resume.md) — bullets averaged 20 words vs the CV's 12 |
| 2026-10-04 | Login/register rate limits: Redis fixed-window counters (Lua), failed logins per account + attempts per IP + sign-ups per IP; 429 + Retry-After; fail open; `TRUST_PROXY_HOPS` | [§8.1](security.md) — roadmap step 8 |
| 2026-10-04 | Resume review opens clean (as printed); per-bullet sources are an opt-in, clearly labelled review note | [§13.1](resume.md) — read as duplicated bullets |
| 2026-10-04 | Resume page matched to the user's CV by measurement: Letter, 1in margins, 11pt Arial, "●" bullets (Experience/Projects) and "•" (Skills) with hanging indents; markers in a flex row to keep PDF text order | [§13.1](resume.md), user request |
| 2026-10-02 | "Save as PDF" only after approval; approve is its own endpoint and refused when stale | [§13.1](resume.md) |
| 2026-10-02 | Resume staleness derived at read time from cited evidence, never stored | [§13.3](resume.md) |
| 2026-10-03 | Gmail connection: authorization code + PKCE; single-use hashed state bound to the browser by a SameSite=Lax nonce cookie (login-CSRF defense); read-only scope verified on return | [§10.3](email-alerts.md) |
| 2026-10-03 | Gmail refresh token encrypted with AES-256-GCM, user id as AAD; access tokens never stored; disconnect revokes at Google | [§10.3](email-alerts.md) |
| 2026-10-03 | Node-only shared code (crypto, Google) behind `@shortlist/shared/node`, never bundled into the web app | [§10.3](email-alerts.md) |
| 2026-10-03 | Inbox checked every two hours + "Check now"; messages recorded once (metadata only); unparsed senders listed | [§10.4](email-alerts.md) |
| 2026-10-03 | Parsers are written against captured real emails (git-ignored); committed fixtures are scrubbed | [§10.4](email-alerts.md) |
| 2026-10-03 | Alert emails → jobs: code parsers only where volume justifies one (Indeed now), Haiku for every other sender; code keeps a model-read job only if its title and company appear in the email and its link ref exists | [§10.4](email-alerts.md), user-approved |
| 2026-10-03 | A code parser that finds nothing hands the email to the model and the Sources page warns the layout may have changed | [§10.4](email-alerts.md) |
| 2026-10-03 | Over-budget email extraction is DEFERRED and re-read by id next check; obvious non-alerts skipped by subject | [§10.4](email-alerts.md) |
| 2026-10-03 | Hand-rolled MIME reader; bodies parsed in memory, never stored; scrubbed fixtures via `scrub:email` | [§10.4](email-alerts.md) |
| 2026-10-03 | Partial jobs (`isPartial`, `salary`): rough score from the summary; paste full description once Interested; tailoring waits for it; a board with the description completes it | [§10.5](email-alerts.md) |
| 2026-10-03 | Alert jobs pass a summary stage: stack keyword in title/summary or a software-role title (`roleTitleTerms`) | [§9.6](discovery.md) — first real check let 8 non-software roles through |
| 2026-10-03 | Email sources excluded from the nightly fan-out, "Run now" and the board list; shown on the Gmail card | [§10.4](email-alerts.md) |
| 2026-10-03 | Code review fixes: whole-number check; `generatedAt` = evidence read time; existing resume stays reachable during/after a failed re-tailor; "Tailor again" on a current resume needs confirmation | [§13.1](resume.md), [§13.3](resume.md) |
| 2026-10-04 | Worker heartbeat key with a TTL in Redis; API reports `workerOnline` wherever work waits on the worker (not BullMQ `getWorkers()`: needs `CLIENT LIST`) | [§4](architecture.md) — tailoring sat queued 10+ min with no worker running |
| 2026-10-04 | Tailoring shows elapsed time, says when no worker runs, and polling backs off then stops after 15 min with "Check again" | [§13.1](resume.md) |
| 2026-10-04 | No navigation blocking while tailoring (work runs in the worker); app-wide "Tailoring resume" bar instead; the Jobs tab returns to the last jobs URL | [§8.4](web-design.md), user request |
| 2026-10-04 | "Find new jobs" on the Jobs page and Sources: queues boards + Gmail check; per-source dedup id; `GET /discovery/status` | [§9.9](discovery.md), user request |
| 2026-10-04 | "Found 2d ago" is the only time on a job row (posting age only on the detail page); jobs filterable by source (`?sourceId=`), linked from Sources and the Gmail card | [§8.4](web-design.md), user request |
| 2026-10-04 | Add skill (with its first evidence) and Add evidence in the Evidence screen; always unverified | [§6.3](../Agents.md), user request |
| 2026-10-02 | `TailoredResume` replaced by `ResumeVariant` + `JobResume`; reuse threshold is a setting (0.85) | [§5.2](architecture.md), [§13.2](resume.md), [§13.4](resume.md) |
| 2026-10-02 | CV reconciled: title Software Engineer, Docker PRODUCTION + CI/CD WORKING, CV-only claims added unverified, context-less CV skills recorded PERSONAL/WORKING | User's answers ([§7.5](career-data.md)) |
| 2026-10-13 | Analysis output: `sameAs`/`relatedTo` capped at 100 refs (was 10) — caps are sanity bounds, never set where a valid answer can exceed them | [§12.1](ai-scoring.md) — a production job failed scoring with "expected array to have <=10 items" |
| 2026-10-13 | Jobs list defaults to **by day** (newest day first, best match within each day); toggle to best match across days; flat "Newest" dropped; SKIPs fold in both orders | [§8.4](web-design.md) — user: new jobs must appear at the top, then high matches |
| 2026-10-13 | Job source named on the row: "via Kwanso careers" / "via Remote OK" / "via LinkedIn alert" (replaces "via company site") | [§8.4](web-design.md) — user couldn't tell jobs from their own company list apart |
| 2026-10-13 | Worker start runs a catch-up discovery if no board run started in 25 h (checked in Postgres, one job id per hour) | [§9.8](discovery.md) — a worker down at 02:00 skipped the night; dev went 11 days without a board run |
| 2026-10-13 | Pinned projects: `Project.isPinned` ("Always on my resume") — not a claim; tailoring must include them; if the model omits one, `assembleResume()` falls back to the user's own verified words (still checked) | [§13.7](resume.md) — user saw projects swap between tailoring runs |
| 2026-10-13 | Resume reuse needs coverage ≥ the setting **and** focus (share of the variant's profile the job asks for) ≥ 0.6; card reads "Covers N% of this job's requirements", not "N% match" | [§13.2](resume.md) — a 2-requirement job was offered the 18-requirement MERN resume as "100% match" |
| 2026-10-13 | Known false claims moved from code to data: `NeverClaim` (term + ANYWHERE / PAID_WORK), edited on Profile; migration carries Azure / Node.js / Express over for CloudCard users; terms also listed in the tailoring prompt | [§13.8](resume.md), [§7.2](career-data.md) — user: the app must work for any user, not only its builder |
| 2026-10-13 | Placement: PERSONAL + PRODUCTION → Projects and Skills, never Experience. ACADEMIC + PRODUCTION and PERSONAL + MAINTENANCE stay open | [§6.1](../Agents.md) — user's answer; Shortlist's production items had been placed nowhere, so it never reached a resume |
| 2026-10-13 | Resume import: PDF text read in the browser (pdf.js, lazy, not precached); worker reads it with Sonnet; code keeps only quotes (`checkCareerExtraction()`); all unverified, additive; text cleared after | [§7.6](career-data.md) — user chose PDF upload; browser-side over server parsing so the API takes no files and does no slow work |
| 2026-10-13 | Onboarding at `/welcome` for accounts with nothing saved; search settings editable (`PUT /discovery/preferences`, whole form) starting from neutral `STARTER_DISCOVERY_PREFERENCES`; remote boards in one tap from shared `REMOTE_BOARDS` | [§9.13](discovery.md) — user: the app must serve any user who installs it, while staying self-hosted |
| 2026-10-13 | Milestone 2: JazzHR, Zoho Recruit, OpenCATS adapters; config is the careers page URL checked per platform; descriptions from embedded JSON-LD JobPosting where present; a vanished Zoho site is a FAILED run; migration enables the 7 working sources (SlashNext off) and fixes Tintash's URL | [§9.3](discovery.md) — user: jobs from their own company list "at every cost" |
