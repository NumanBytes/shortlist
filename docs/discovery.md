# Job discovery

Where jobs come from: board adapters, filtering, dedupe, scheduling, and manual intake.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 9. Job discovery

### 9.1 Source tiers

1. **Public company job-board APIs** (Greenhouse, Lever, SmartRecruiters, Workable; later
   Ashby, Recruitee, …) — no ToS issue, best description text. The primary tier.
2. **Remote-job aggregators** with public APIs/feeds (Remote OK, Remotive, Arbeitnow,
   Himalayas, Jobicy, We Work Remotely).
3. **Hosted ATS pages** without a public API (JazzHR, Zoho Recruit, OpenCATS-style, …) —
   one HTML parser per *platform*.
4. **Custom careers sites** — a generic change watcher plus AI extraction (§9.10).
5. **Job-alert emails** in the user's Gmail — the legitimate way to cover LinkedIn,
   Indeed, Glassdoor, Taraki, Wellfound, Rozee.pk, remote.co ([§10](email-alerts.md)).
6. **Manual "Add a job"** — always available (§11).

### 9.2 Source inventory (probed 2026-10-01 from the user's list of 40 URLs)

Each careers URL was fetched and classified by platform. All of it is recorded as
`JobSource` rows in `packages/db/prisma/seed/job-sources.ts` — 48 sources, 13 enabled.

| Status | Sources |
|---|---|
| **Enabled — public ATS APIs** | Motive (`greenhouse:gomotive`), Careem (Greenhouse), Educative, Kwanso (Lever), Septem Systems (SmartRecruiters), Programmers Force (Workable account `hr-force`) |
| **Enabled — aggregators** | Remote OK, Remotive (software-dev), Arbeitnow, Himalayas, Jobicy, We Work Remotely (Full-Stack, Front-End) |
| **Milestone 2 — built 2026-10-13** | VentureDive, NorthBay (JazzHR); ShopDev, Techlogix, Tintash (Zoho Recruit); Intagleo, i2c (OpenCATS); 7Vals (Simplicant) — enabled. SlashNext (Zoho) off: its careers site shows an error page |
| **Milestone 2 — still planned** | UWorx (WebHR) and Cogent Labs (Hirestream): JavaScript apps over private, undocumented APIs; Systemvent (SAP SuccessFactors); Code District (Pinpoint) |
| **Milestone 3 — custom sites, built 2026-10-13** | NetSol, Folio3, Synavos, BrainX, Coeus, Redmath, RipeSeed (now `/careers`), Intech, SSI, Cinnova, Rolustech, Xavor, Nextbridge — enabled (§9.14). Off: CodingCops (no careers page), The Developers Arena (JavaScript app) |
| **Recorded with a note** | TCM (403 to automated requests), Qbatch (careers page 404), Conrad Labs (domain doesn't resolve) |
| **Email alerts ([§10](email-alerts.md))** | LinkedIn, Wellfound, Rozee.pk, remote.co — plus Indeed, Glassdoor, Taraki from the user's inbox |
| **Not a source** | Turing — a vetting marketplace (apply once, get matched), not a job feed |

Kwanso, first assumed to be a custom site, turned out to use Lever. The user's list is
explicitly "a beginning, not the limit" — more companies and portals will be added.

### 9.3 Adapter architecture — one adapter per platform, not per company

`apps/worker/src/discovery/adapters/` holds one adapter per platform; each turns that
platform's response into a common `Posting` (externalId, title, company, location,
workMode, url, postedAt, description or `loadDescription()`). Adding a *company* on an
existing platform is a `JobSource` row; adding a *platform* is one adapter plus one entry
in `ImplementedSourceConfigSchema` — the `AdapterRegistry` type makes the compiler insist
the two stay in sync. Platforms recorded for later (`PLANNED_PROVIDERS`) validate as
config but have no adapter; running one fails once, clearly, with "No adapter for
provider … yet", and the API refuses to enable it.

Platform notes: Greenhouse (`?content=true`, one request per board, HTML is
entity-encoded); Lever (`?mode=json`, includes `descriptionPlain`); SmartRecruiters (list
without descriptions; one detail request each, only for survivors); Workable (the v3 list
via POST + v2 detail — the older widget endpoint returns 0 jobs); Remote OK (first array
element is a legal notice); Remotive (naive UTC timestamps; free API delayed 24h);
Arbeitnow (paged, mostly Germany); Himalayas (cursor-paginated); Jobicy (entity-encoded
titles); We Work Remotely (RSS, titles are "Company: Title").

**Hosted careers pages (Milestone 2, built 2026-10-13).** No API, so the adapter reads the
page the company links to — and its config is just that page's URL, checked against the
platform's host (`pageUrl()` in `job-source.schema.ts`). Probed live on 2026-10-13:
- **JazzHR** (`<company>.applytojob.com/apply`): boards use different templates (a list,
  or a custom table that appears twice), so the parser keys on the job links
  (`/apply/<id>/<slug>`), not layout, and dedupes ids. Each job page embeds a schema.org
  **JobPosting** (JSON-LD) — the description is read from that (`html.ts`), not the layout.
  `jsonLdJobPosting()` accepts every schema.org form (arrays, `@graph`, `@type` as a list), the
  description is entity-decoded once (twice turned escaped text into stripped tags), and a job
  page without the data **fails that posting's description fetch** — counted and logged —
  instead of returning '' and being misreported as "no core-stack keyword" (code review
  2026-10-13; Simplicant the same).
- **Zoho Recruit** (`<company>.zohorecruit.com/jobs/<portal>`): the openings are JSON in a
  hidden `<input id="jobs">`; each job page carries its record, description included, in
  `var jobs = JSON.parse('…')` (a JavaScript string literal, unescaped by `jsString()`). A
  careers site that's gone still answers 200 without the list — a **FAILED** run that says
  so (`PermanentSourceError`), never "no jobs".
- **OpenCATS** (self-hosted, `…/careers/index.php?m=careers&p=showAll`): a table row per
  job; installs name jobs by `ID=<n>` (Intagleo) or `job=<slug>` (i2c). The description is
  `#careerContent`; Intagleo's template wraps part of it in an HTML comment, which is kept.
  i2c's own job links answer "No such position found" (even in a browser session), so its
  jobs have no description and pass stage B only if the title names the stack.
- **Simplicant** (`<company>.simplicant.com`): server-rendered links `/jobs/<id>-<slug>/detail`
  with title and location; a job is listed under "Featured" and its department, so ids are
  deduped. Job pages embed a JobPosting (JSON-LD).
- **Not built — WebHR, Hirestream:** both pages are JavaScript apps that render nothing
  without running their bundle, and fetch jobs from private, undocumented endpoints
  (`api.webhr.co/api/careers/` with RPC-style parameters; Hirestream's `api/v1/…`). An adapter
  would mean reverse-engineering each for one company, and it would break silently when the
  app changes — so they wait for a decision (or the company appears in alert emails).
- `PermanentSourceError` moved to `discovery/errors.ts` so adapters can throw it.

**One validation boundary for every adapter (2026-10-11).** Source responses are
third-party JSON/RSS, typed only by our reading of their docs. Rather than a Zod schema per
response shape, each adapter maps items through `mapPostings()` (`discovery/postings.ts`),
which checks every normalized posting (`PostingCheck`: id, non-empty title and company,
an **http(s)** URL — it becomes the Apply link's `href`). An item that fails, or whose
mapping throws on a missing field, is skipped and counted as `invalid posting` with a
warning; one malformed posting no longer fails the whole source.

### 9.4 The pipeline per source

```
open DiscoveryRun (RUNNING)            ← before any network call
→ adapter: fetch + normalize to Postings
→ stage A filter: title / location / age — listing data only, free
→ descriptions: only for stage-A survivors (loadDescription), 4 at a time
→ stage B filter: a core-stack keyword in title or description
→ dedupe: hash(normalized company + title); bump lastSeenAt on known jobs
→ store new jobs with source attribution
→ close run: SUCCESS | EMPTY | FAILED + jobsFound / jobsMatched / jobsNew
```

Expensive steps always sit behind cheap ones (descriptions that cost a request are
fetched only for postings that already passed the free screen). One posting's detail
request failing is counted and skipped; it doesn't fail the source. Each run returns the
count of rejections per reason, which is how the filter is tuned.

### 9.5 Run lifecycle, failures and retries

- The run row is created as RUNNING before fetching: a crash mid-fetch leaves a visible
  RUNNING row instead of silence ([§1.3](../Agents.md)).
- **EMPTY** (source returned nothing) stays distinct from **SUCCESS with 0 matches**.
- **FAILED** stores the error message; the error is rethrown so the queue retries it.
- **Permanent vs transient:** a missing adapter or invalid config raises
  `PermanentSourceError` → BullMQ `UnrecoverableError` → fails once, no retries.
  Timeouts and 5xx retry (3 attempts, exponential backoff from 60s); **each attempt is its
  own run row**, so retries are visible.

### 9.6 The rule filter (no AI)

Settings are a `DiscoveryPreferences` row per user; defaults
(`DEFAULT_DISCOVERY_PREFERENCES` in shared) are tuned for a ~2-year frontend/full-stack
developer in Lahore:
- *Title include:* developer, engineer, software, frontend, full stack, react, mern,
  javascript, typescript, web, …
- *Title exclude:* far-senior roles (principal, staff, director, head of, manager,
  architect), interns, other stacks (iOS, Android, Flutter, embedded, data/ML, DevOps,
  QA, security, Salesforce, SAP), non-engineering roles, and German-market/student
  postings ("Werkstudent", "Praktikum", "(m/w/d)"). **"Senior" is kept** — whether to
  stretch is the scorer's call, not the filter's.
- *Stack keywords* (stage B): react, next.js, typescript, javascript, node, nestjs,
  express, mern, tailwind, angular, …
- *On-site/hybrid locations:* lahore, pakistan, pk.
- *Remote:* passes only if the location is empty, names a worldwide term (worldwide,
  anywhere, global, international), or names **only** allowed regions
  (`remoteAllowRegions`: remote, Asia, APAC, South Asia, Pakistan, Lahore). "Remote - LATAM"
  fails on "latam". **An allow-list, replacing the original block-list** (2026-10-02): the
  first real run let through roles limited to Poland, Argentina, France, South Africa,
  Nepal… — a block-list can never name every country that can't hire from Pakistan, and
  the filter's job is to err on the side of dropping. An allowed on-site place still wins
  ("USA, Pakistan" passes on "pakistan").
- *No location and unknown work mode:* benefit of the doubt (common on company boards).
- *Posting age (30 days):* **aggregators only** — on a company's own board a listed job is
  open ([§1.3](../Agents.md)).
- *Matching:* case-insensitive, whole-word on non-alphanumeric boundaries — "react"
  matches "React.js developer" but not "reactive"; "next.js" and "c++" work.

**Alert jobs (2026-10-03):** a job read from an email has no description, so stage B
can't run. Instead the **summary stage** passes it if a stack keyword appears in its
title or summary, **or** its title names a software role (`roleTitleTerms`: software,
full stack, frontend, web developer, …). This keeps "Full Stack Engineer" whose summary
names no technology, and drops "Associate Electrical Engineer" — from the first real
Gmail check, where stage A alone let 8 such roles through. Borderline roles (a PHP
full-stack job) pass and are left to scoring. Like every filter setting, the list is a
`DiscoveryPreferences` column with a default in shared.

### 9.7 Deduplication

`dedupeHash = sha256(normalize(company) | normalize(title))`, unique per user. Normalizing
strips accents, punctuation and company suffixes (Inc., Ltd., Pvt., Technologies, …) but
keeps C, C++ and C# distinct. Location is deliberately excluded: sources format it too
differently to match reliably, and the same title at the same company in two cities is
one decision for the user. This is what collapses the same job from different sources
and repeated email alerts into one.

### 9.8 Scheduling and the queue

- Nightly at **02:00 Asia/Karachi** (`DISCOVERY_CRON`, `DISCOVERY_TZ`), via a BullMQ **job
  scheduler stored in Redis** (`upsertJobScheduler`). Upserting is idempotent, so any
  number of worker copies or restarts still produce exactly one run per night — an
  in-process cron would fire once per copy.
- The scheduled `discover-all` job fans out one `discover-source` job per enabled source
  (all users), so a slow or failing source retries alone and never holds up the others.
  Fan-out job IDs derive from the batch ID, so a retried fan-out re-adding the same IDs is
  a no-op. (BullMQ custom job IDs can't contain `:`; we use `__`.)
- **Job ids live in one place (2026-10-11):** the API and the worker both add jobs, so
  every job id, deduplication id and retry option comes from `queueJobOptions` /
  `dedupeId` in `@shortlist/shared` (`discovery-queue.ts`). Before, each app built its own,
  and the nightly fan-out had **no** deduplication id, so "Find new jobs" during the
  nightly run could fetch a source twice in parallel; for model calls, a mismatch would
  mean paying twice.
- **Catch-up on start (2026-10-13):** a scheduler only looks forward, so a worker that
  isn't running at 02:00 (a laptop asleep, a deploy at that minute) silently skips the
  night — in development, the boards went 11 days without a run while Gmail checks
  (every two hours) kept working. On start, `DiscoveryScheduler` checks Postgres for the
  latest board run; if none started in the last 25 hours, it queues a catch-up `discover-all`
  **5 minutes later** (job id per hour, so two workers starting together queue one). The
  catch-up re-checks when it runs and steps aside if a run has started since: an overdue
  nightly job kept in Redis may run at startup too, and both would fetch everything (code
  review 2026-10-13 — "the scheduler only looks forward" had been assumed, not verified). Decided from the database,
  not Redis, so it holds whatever the queue lost; a failed check logs and never stops the worker.
- Worker concurrency: 3 sources in parallel (`WORKER_CONCURRENCY`).
- BullMQ 6 requires a constructed `ioredis` client in ESM (`createRedis`); the worker's
  client waits for Redis to return (`maxRetriesPerRequest: null`).

### 9.9 "Run discovery now"

`POST /discovery/run` queues the user's enabled sources **except any that ran in the last
6 hours** (`MANUAL_RUN_COOLDOWN_HOURS`), so a user pressing the button can't break an
aggregator's request limits. With Redis down, BullMQ either errors immediately or waits
indefinitely for a connection (both observed), so every enqueue from the API is bounded
by a **3-second timeout** and both failures return **503**.

**Updated 2026-10-04: one "Find new jobs" button.** At the user's request the button
is on the Jobs page (New tab) as well as on Sources. It also queues a check of the Gmail
alert label when Gmail is connected (best effort, since the inbox is checked every two
hours anyway), so one tap covers every source. Each source job now carries a
**deduplication id** (`discover-<sourceId>`), so tapping again, or tapping while the worker
is stopped, joins the job already queued instead of piling up duplicates. The cooldown alone
can't prevent that, because `lastRunAt` only moves when a run *finishes*.
`GET /discovery/status` returns `{ enabledSources, lastCheckedAt, running, availableAt,
nextNightlyAt, workerOnline, cooldownHours }`. A RUNNING run older than 30 minutes is
treated as crashed, not still running. The button only queues work; the worker does the
fetching. With no worker running, the UI says so instead of showing a spinner.

### 9.10 Source terms and etiquette

- Remote OK, Remotive and Jobicy require **naming them as the source and linking back to
  the original posting**, with Apply going to the original URL. Every job stores `source`
  and `sourceUrl`; the job card shows "via Remote OK" (or "<Company> careers") and "Open
  posting ↗" uses `rel="noopener"` — not `noreferrer`/`nofollow`, because they ask for
  referral traffic.
- Remotive asks for at most ~4 requests a day; the nightly run makes 1.
- LinkedIn, Indeed, Glassdoor, Wellfound and remote.co are never scraped — email only.

### 9.11 Finding sources versus finding jobs (decided 2026-10-02)

"Search every software house in Lahore and every remote board" is two different
problems, solved differently:

| Layer | What | How often | Cost |
|---|---|---|---|
| **1. Find sources** | Grow the list of companies/boards to watch | Monthly, or on demand | Cents (or free — see below) |
| **2. Portal alerts** | LinkedIn, Rozee, Indeed, Glassdoor, Wellfound search thousands of companies against saved keywords and email the results ([§10](email-alerts.md)) | Continuous | Free |
| **3. Poll known sources** | The platform adapters (§9.3) | Nightly | Free — no AI |
| **4. Custom sites** | Change watcher; Haiku reads only changed pages | Nightly | Fractions of a cent per change |

**Claude web search is never used for nightly job discovery.** Rejected because:
it costs $10 per 1,000 searches plus tokens for every result page (dozens of searches a
night ≈ $10–15/month, over budget); results are non-deterministic and miss companies
silently — the "silent single-source search" failure of [§1.3](../Agents.md); they are dominated by
LinkedIn/Indeed links that can't be fetched; and the portals' own alerts already search
the whole market for free.

**Where web search *is* used — layer 1, sparingly and targeted:**
- **ATS-scoped searches** such as `site:job-boards.greenhouse.io Lahore`,
  `site:jobs.lever.co Pakistan`, `site:apply.workable.com Lahore`,
  `site:jobs.ashbyhq.com Pakistan` — they find companies that post Pakistan jobs on
  platforms we already have adapters for. Each company found becomes a source polled
  free every night thereafter. ~20–30 searches ≈ $0.30–0.60 per run, monthly.
- **The user can run these searches by hand in claude.ai** (Claude Pro includes web
  search) and paste the company list in — taking the cost off the API budget ([§12.3](ai-scoring.md)).
- **Board probing needs no AI and no search:** for any company name (from alerts, the
  user's list, or a directory such as P@SHA's member list), call the platforms' public
  APIs (`boards-api.greenhouse.io/v1/boards/<slug>`, Lever, SmartRecruiters, Workable)
  — free, deterministic. This is the board discovery of §9.12.
- Every newly found source is a **suggestion the user approves**, never added silently.

### 9.12 Planned discovery work

- **Milestone 2:** JazzHR, Zoho Recruit, OpenCATS and Simplicant built 2026-10-13 (9
  companies, 8 enabled). Left: WebHR and Hirestream (private APIs, see §9.3),
  SuccessFactors and Pinpoint.
- **Milestone 3 — custom careers sites (built 2026-10-13, §9.14):** a **generic change watcher** instead of 15
  hand-written scrapers (which would break on every redesign): fetch each page nightly
  and compare with the previous version (free); only when it changed, have Haiku extract
  the listings (~$0.001 per changed page). One adapter for every custom site, and the
  cheap check sits in front of the expensive one.
- **Board discovery** (decided 2026-10-02): when an email alert names a company Shortlist
  doesn't watch, check whether it has a public Greenhouse / Lever / SmartRecruiters /
  Workable board (official public APIs, not scraping). If found, **suggest adding it as a
  source** — from then on its jobs arrive automatically with full descriptions. Alerts
  thereby grow the watched-company list over time.

---

### 9.13 Onboarding and search settings (built 2026-10-13)

Until now a new account searched with defaults tuned for one person (Lahore, frontend titles)
and had no sources unless the seed scripts were run. Now:

- **`/welcome`** — shown once to an account with nothing saved (no search settings, roles,
  skills or sources; `GET /onboarding`), so existing accounts are never sent there. Three
  skippable steps: import a resume ([docs/career-data.md §7.6](career-data.md)), what you're
  looking for, and where to look. Finishing it — even with every step skipped — sets a flag on
  the device (`shortlist:onboarding-done`), so the gate never sends the user back.
- **Search settings** (`GET`/`PUT /discovery/preferences`) — the rule filter's settings (§9.6)
  as a form, also on Profile → "What I'm looking for". Saved whole, not patched: it's one form,
  and a partial update could leave a filter the user never saw. A new user starts from
  `STARTER_DISCOVERY_PREFERENCES` (no city, stack or titles — only near-universal exclusions and
  the "worldwide" remote terms), not from `DEFAULT_DISCOVERY_PREFERENCES`, which stays the
  fallback for accounts that never saved their own. `roleTitleTerms` is rebuilt on each save
  from the starter terms plus the current titles, so alert emails without a description still
  pass on title — and a removed title stops letting them in.
- **Remote boards in one tap** (`POST /discovery/sources/remote-boards`) — the aggregators,
  now listed once in `REMOTE_BOARDS` (shared) and used by both onboarding and the seed;
  idempotent, and never re-enables a board the user switched off.
- Gmail alerts stay a pointer to the Sources page: each user needs the Google setup of
  [docs/email-alerts.md §10.6](email-alerts.md), since the app is self-hosted (decided 2026-10-12).

### 9.14 Custom careers pages — the change watcher (built 2026-10-13)

The `careers_page` provider reads any company's own careers page with one adapter
(`discovery/careers-page/`), as decided 2026-10-02 (§9.12): the cheap check in front of the
expensive one.

1. **Fetch and reduce** (`pageText()`): scripts, styles, menus and footers are dropped, and a
   `<header>` only when it looks like the site's (no heading in it, or a menu / banner role /
   site class) — a job card's `<article><header><h3>…` keeps its title (code review 2026-10-13); every link becomes a short ref (`Shopify Developer [L4]`), so the model can point
   at a job's page without writing a URL. Text is capped at 24,000 characters, and only the
   links that text shows are sent (Intech's page has 331).
2. **Fingerprint** (`fingerprint()`): sha256 of the reduced text and links, ignoring
   phrases that change daily on their own ("Posted 10 months ago").
3. **Unchanged** → the openings stored in `CareersPageSnapshot` are returned. No model call,
   no cost — most nights for most pages.
4. **Changed or never read** → Haiku (`AI_MODELS.extractCareersPage`) lists the openings
   through `CareersPageExtractor` (faked in tests), after `BudgetGuard.checkMonthly`, logged to
   `AiUsage` (`EXTRACT_CAREERS_PAGE`) before its output is used.
5. **Code keeps only what's on the page** (`checkOpenings()`): a title must appear as written;
   a link must be one of the page's refs **and public** (else the posting links to the careers
   page itself);
   `details` — the page's own text about a job — are kept only if quoted. A page the model
   says lists no openings gives none (an EMPTY run).
6. **Descriptions:** the quoted details, or the job's own page (its JSON-LD JobPosting, else
   its reduced text), fetched only for jobs that pass stage A — through `getPublicText()`, which
   resolves the host and refuses private, loopback and link-local addresses at every redirect
   hop (`public-url.ts`). Those links come from a third-party page via the model, so a hostile
   page could otherwise point the worker at its own network, e.g. the cloud metadata service
   (SSRF, code review 2026-10-13). Postings go through `mapPostings()`, like every adapter's.

**Failures stay visible:** a page with almost no text without JavaScript fails the run
("can't be read this way") without a model call. Over budget or out of credit, a changed page
keeps its last reading (logged) and is re-read on a later run — deferred, never dropped; a
page never read yet fails the run with the reason instead of looking empty. Invalid or cut-off
model output fails the run without retry, and the page's fingerprint is remembered
(`failedHash`): while the page is unchanged it isn't sent to the model — or billed — again,
and the run says why; once it changes, it gets one more try.

Cost: a first reading of all 13 pages is roughly 30,000 input tokens (about 3 US cents);
afterwards only pages that changed are read.

Adapters that need more than the page (the database, the model) get it through the context
(`AdapterContext.careersPage`), so the registry stays one plain function per provider.

### 9.15 Adding sources from the app (built 2026-10-14)

Asked for in production: "store the careers sites or jobs pages of companies in a metadata
config and read jobs from there, so links are added or edited in the db, not in code." The
storage already was that — every source is a `JobSource` row whose `config` JSON names the
provider and its address (§9.1, validated by `JobSourceConfigSchema`); what was missing was a
way to add or change one without the seed script.
- **Add** (`POST /discovery/sources`, Sources → "Add a company's jobs page"): a company name
  and a link. `sourceFromLink()` (shared) picks the provider from the link — a Greenhouse,
  Lever, SmartRecruiters or Workable board gets its API adapter (key `provider:board`), a
  JazzHR/Zoho/OpenCats/Simplicant page its page adapter, anything else is a `careers_page`
  for the change watcher (§9.14; key `careers_page:name`, the seed's scheme). A link on a
  known platform that's missing the board is an error, not a careers page. Duplicate keys
  are a 409 naming the existing source. The first run is queued at once (best effort).
- **Edit** (`PATCH /discovery/sources/:id/address`, the pencil on a row or "Edit URL" on a
  failing one): boards as before; a page-based source re-detects from the new link, so a
  company that moved to Greenhouse becomes a board. The key stays.
- **Remove** (`DELETE /discovery/sources/:id`, two taps): company boards and pages only —
  aggregators and email inboxes are paused instead. Jobs it found stay (`jobSourceId` is
  set null); its run history and page snapshot go with it.
- **SSRF.** Any account can now choose a URL the worker fetches, so `public-url.ts` no
  longer trusts source URLs: every worker fetch (`http.ts`) checks that the host resolves
  only to public addresses, at every redirect hop (redirects followed by hand). The API
  also refuses an obviously internal link when it's saved (`sourceFromLink`, no DNS), for a
  clear message; the worker's check is the guard. Worker tests stub DNS
  (`test/setup-dns.ts`) so they stay offline.

## 11. Manual job intake — "Add a job" (planned, decided 2026-10-02)

The universal fallback for everything automatic discovery can't reach: WhatsApp groups,
LinkedIn feed posts, recruiter messages, referrals, unsupported portals. Tier 6 of §9.1.

- **Input:** a link, pasted text, or both. A link to a supported platform → the full
  description is fetched from its public API. Otherwise the pasted text is the
  description; title and company are extracted (editable).
- **Becomes a real `Job`** (source MANUAL): it enters the pipeline (Interested → Applied…),
  is deduplicated against discovered jobs, and is scored like any other.
- **Same truthfulness rules:** verified evidence only, every bullet traceable, gaps shown
  before tailoring.
- **Bypasses the score threshold** — tailoring runs even on a low score, because the user
  asked; the score and gaps are shown first so it's an informed choice.
- **Android share target:** the PWA manifest registers a `share_target`, so the user can
  long-press a WhatsApp message or tap Share on a LinkedIn post → Shortlist, and the job
  opens pre-filled. iOS doesn't support share targets for web apps; there it's
  copy-paste.
- Scam heuristics ([§3.11](scenarios.md)) apply — WhatsApp-sourced jobs are a common vector.
