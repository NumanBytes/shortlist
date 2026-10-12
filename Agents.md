# Shortlist — Project Documentation

Shortlist finds jobs worth your time, tailors a truthful resume for each, and leaves the
final click to you. This file holds what everyone working on it must know — why it
exists, what's in scope, the truthfulness rules, how we work — and a map of the rest.
The other files explain each part in depth: how it works, why it was built that way,
and the alternatives that were rejected.

**Rules for using these documents**

- Read this file before generating code, and the topic file for the area you're changing.
  Where they state a rule, follow it even if a more "standard" pattern would normally
  apply — the rules encode specific, hard-learned constraints (several from real
  incidents, §1.3), not style.
- **Every design decision is recorded in the same change that makes it:** in the topic
  file it belongs to, *and* as a row in the decision log ([docs/decisions.md](docs/decisions.md)).
  Decisions that live only in a chat or a PR description are lost.
- For exact data shapes, trust the code (`packages/db/prisma/schema.prisma`,
  `packages/shared/src/*.schema.ts`) over any copy in the docs. The docs explain *why*.
- Section numbers are shared across all files, so "§10.4" means the same section
  everywhere; references in code comments name the file (`docs/email-alerts.md §10.4`).

## Map

| Section | File | What's there |
|---|---|---|
| §1 Why this exists · §2 Product scope | this file | The problem, "the human clicks submit", the incidents behind the rules |
| §3 Real-world scenarios | [docs/scenarios.md](docs/scenarios.md) | How Shortlist behaves in each situation it was designed for |
| §4 Runtime architecture · §5 Data model · §14 Technology | [docs/architecture.md](docs/architecture.md) | API / worker / web, queues, deployment and hosting, the schema's design, stack choices |
| §6 Truthfulness rules | this file | Non-negotiable: verified evidence only, what un-verifies it, placement |
| §7 Career database | [docs/career-data.md](docs/career-data.md) | The one-time seed and the CV reconciliation |
| §8 Authentication and security | [docs/security.md](docs/security.md) | Hand-rolled JWT, refresh cookie, rate limits, other security decisions |
| §8.4 Web UI design | [docs/web-design.md](docs/web-design.md) | Design system, mobile design, interactions and motion, the app icon, error screens |
| §9 Job discovery · §11 Manual intake | [docs/discovery.md](docs/discovery.md) | Board adapters, filtering, dedupe, scheduling; "Add a job" (planned) |
| §10 Email job alerts | [docs/email-alerts.md](docs/email-alerts.md) | Gmail read-only OAuth, parsers and the model fallback, partial jobs |
| §12 AI analysis and scoring | [docs/ai-scoring.md](docs/ai-scoring.md) | The model maps requirements; code scores; budget guard |
| §13 Resume tailoring | [docs/resume.md](docs/resume.md) | Tailoring rules, the resume library, approval, printing, application kit |
| §15 Development workflow | [docs/development.md](docs/development.md) | Conventions, testing, migrations, code layout, CI and tooling |
| §16 Decision log | [docs/decisions.md](docs/decisions.md) | Every decision, dated, with where it's described |
| §17 Build state and roadmap | [docs/roadmap.md](docs/roadmap.md) | What's built, what's next, open decisions |
| §18 Working agreements | this file | How the builder and assistants work together |

---

## 1. Why this exists

### 1.1 The problem

The builder, Numan, is a frontend developer (~2 years) at CloudCard Inc. in Lahore,
Pakistan, job-hunting alongside his current role. The manual grind is the problem:
tracking applications in memory, tailoring resumes by hand for every posting, no
visibility into what is working. Every existing productivity tool for this gets
abandoned, because the cost of *not* using it is zero.

### 1.2 The product philosophy: the human clicks submit

**Shortlist is not "an AI that applies to jobs for you."** It does the tedious 80% —
discovery, job-description parsing, match scoring, resume tailoring, outreach drafts —
and hands the person a ready-to-submit application. **The human always makes the final
click.** This is a deliberate scope decision, not a limitation:

- LinkedIn's and Indeed's Terms of Service explicitly ban automated applying; bot
  detection risks account suspension.
- Recruiters can recognise bot-written applications and messages.
- Most importantly, every claim that leaves the system must have been seen and approved
  by the person it describes (see the Azure incident below).

Full automation was considered and explicitly rejected. Consequences that run through
the whole design: Shortlist never clicks Apply, never uploads a file to a third-party
site, never sends an email or message, and never fills a form. It prepares; the user
submits; the user tells Shortlist they did ("I applied").

### 1.3 Incidents that shaped the design

These are real events. Each one produced a rule that the code enforces.

**The Azure B2C incident — the single most important fact in these documents.**
While manually tailoring a resume for a real application (MERN Stack Engineer @ Devsorb,
Lahore), an AI assistant inserted **"Azure B2C"** as a claimed skill, pulled from a
stale, unverified note. Numan has never worked with Azure — CloudCard's B2C layer is an
in-house **Ruby** service. The false claim went out on a real, submitted application.
→ This is why `SkillEvidence.isVerified` exists and defaults to `false`, why no
generation code may read unverified evidence, why every resume bullet must trace to the
user's own words, and why any edit that changes what a claim says un-verifies it (§6).

**The silent single-source search.** A job search that relied on one source silently
returned nothing, and the result was read as "the job doesn't exist" — when in fact the
search tool itself had failed. → Every discovery run is recorded as a `DiscoveryRun` row
opened in `RUNNING` state *before* fetching, and an empty or failed source is always
shown as such, never folded into "no jobs today" ([§9.5](docs/discovery.md)).

**The posting-age filter that hid open jobs (2026-10-01, first live discovery run).**
A 30-day posting-age rule dropped all 10 of Septem Systems' postings — including a
*Full Stack Software Engineer (MERN)* role in Lahore — and 99 of Motive's 160. On a
company's own job board, a listed job *is* open; long-running openings keep their
original publish date. → Posting age is enforced on aggregator sources only ([§9.6](docs/discovery.md)).

**The shadow-database reset (2026-09-30, development).** While checking a migration,
the dev database was passed to Prisma as `--shadow-database-url`; Prisma resets shadow
databases, so the dev database was wiped (it happened to be empty). → Never point a
shadow URL, `migrate diff` with a shadow, or `migrate reset` at the dev database; generate
migration SQL by diffing the live schema read-only ([§15.4](docs/development.md)).

### 1.4 Success criteria (stated by the builder)

- Output quality must match or beat what he would write himself by hand.
- ~60–70% reduction in per-application manual effort.
- Mobile-first: a push notification saying "resume ready — just review and submit."
- Architected as a real multi-user product (proper auth, no shortcuts), even though only
  he uses it for now. It may be sold later — this affects naming/trademark caution and
  some third-party setup (e.g. Google OAuth verification, [§10.3](docs/email-alerts.md)), not architecture.

---

## 2. Product scope

**Name:** Shortlist. The double meaning is deliberate: it gives you a shortlist of jobs
every morning, and its purpose is getting *you* shortlisted. Target domain:
`getshortlist.com` (or a `get-`/`use-` variant; `shortlist.com` is taken). Repo and
codebase name: `shortlist`. Package scope: `@shortlist/*`. Product-facing names are
English only (Urdu-derived names, e.g. "Manzil", were considered and rejected for this
product; Manzil is the name of a separate side project).

**One-liner:** Finds jobs worth your time, tailors a truthful resume for each, and
notifies you. You make the final click.

### In scope

- Multi-source job discovery: public company job-board APIs, remote-job aggregators,
  job-alert emails from the user's own inbox, hosted ATS pages, custom careers sites,
  and manual entry ([§9](docs/discovery.md)–[§11](docs/discovery.md)).
- Job-description parsing into structured requirements ([§12](docs/ai-scoring.md)).
- Match scoring against the verified career database, with gaps ([§12](docs/ai-scoring.md)).
- Resume tailoring rendered into the user's own CV layout, plus a reusable resume
  library ([§13](docs/resume.md)).
- An application kit per job: tailored PDF, drafted email for "send your CV to"
  postings, drafted answers to screening questions, outreach drafts ([§13.5](docs/resume.md)).
- Push notification when a resume is ready ([§13.6](docs/resume.md)).
- Application pipeline tracking (New → Interested → Applied → … → Offer/Rejected).
- Delivery as an installable PWA (not a native app).

### Explicitly out of scope

- Any automatic submission: no auto-apply, no Easy Apply automation, no form filling, no
  sending email on the user's behalf.
- Scraping LinkedIn, Indeed, Glassdoor, Wellfound or remote.co pages (ToS). Their jobs
  arrive through the user's job-alert emails instead ([§10](docs/email-alerts.md)).
- Reading a LinkedIn feed (no API; scraping forbidden). Feed posts come in through
  manual "Add a job" ([§11](docs/discovery.md)).

---

## 6. Truthfulness rules (non-negotiable)

This is domain logic, not a suggestion. Any code that generates resume content must obey
these rules exactly.

### 6.1 Placement rules — where evidence may appear on a resume

| Context + Depth | Where it may appear |
|---|---|
| COMMERCIAL + PRODUCTION | Experience bullets, Skills section, Summary |
| COMMERCIAL + MAINTENANCE | Experience bullets, worded as maintenance (upgraded/fixed, not built) |
| PERSONAL/ACADEMIC + WORKING | Skills and Projects sections only — never an Experience bullet |
| COMMERCIAL + WORKING | Skills section, and Experience bullets worded as what was actually done ("deployed through existing CI/CD pipelines", "small changes in Ruby") — never as having built or owned it (decided by the user 2026-10-02) |
| PERSONAL/ACADEMIC + EXPOSURE | Skills section only if `lastUsed` < 2 years ago; otherwise omitted entirely |
| PERSONAL + PRODUCTION | Projects and Skills sections — never an Experience bullet, since it wasn't paid work (decided by the user 2026-10-13: a shipped personal project like Shortlist is an achievement) |

**Still open (ask before tailoring code assumes one):** COMMERCIAL + EXPOSURE,
PERSONAL + MAINTENANCE and ACADEMIC + PRODUCTION / MAINTENANCE.

### 6.2 Hard rules for every AI generation step

1. Read only `SkillEvidence` rows where `isVerified = true`. Unverified evidence must be
   invisible to any generation prompt.
2. Every generated resume bullet must be traceable to a specific `whatIDid` the user
   wrote (stored as evidence IDs per bullet). Never synthesize a claim the user did not
   author.
3. Never add a skill the job asks for that the verified evidence doesn't support — it
   becomes a gap, never a claim.
4. If "Azure B2C", or Node.js/Express presented as CloudCard experience, appears in any
   generated output, it is a bug ([§7.2](docs/career-data.md)). More generally, nothing on the
   user's never-claim list may appear in its scope ([§13.8](docs/resume.md)) — the list is
   the user's data, so these checks hold for any user, not only this one.

### 6.3 How verification is enforced in code

- `isVerified` is **never** accepted in a request body: create/update schemas don't
  contain it and are `.strict()`, so sending it is a 400, not silently ignored.
- `POST /evidence/:id/verify` is the **only** path that sets it (idempotent; keeps the
  original `verifiedAt`); `POST /evidence/:id/unverify` undoes it. Verification is its
  own endpoint so no request body can ever carry it.
- **Any write that changes what a claim says resets verification** (`UNVERIFIED` in
  `apps/api/src/common/verification.ts`):
  - editing the evidence itself;
  - **renaming its skill** — otherwise evidence verified for "React" would vouch for
    whatever the skill is renamed to, the exact shape of the Azure incident (changing
    only the category keeps verification);
  - editing a claim field of the linked role (company, title, start/end, current) or
    project (name, description, shipped, start/end, the role it belongs to) — compared by value, so a form
    resubmitting unchanged values doesn't un-verify; cosmetic fields (location, URLs)
    don't count;
  - deleting the linked role/project — the evidence survives (FK is SET NULL) but is
    un-verified, because it was confirmed in that context.
  - **Any new write path must do the same.**
- Ownership: every query is scoped to the caller; another user's resource is a 404,
  never a 403 (a 403 would confirm the ID exists). Evidence ownership goes through its
  skill (`skill: { userId }`).
- Verification in the web UI is never optimistic — "Verified" shows only after the server
  confirms.
- The Evidence screen's **Edit** (formerly "Reword") changes the wording, *where*
  (context) and *how deeply* (depth) of an item, sending only the fields that changed;
  saving says up front that it un-verifies the item. Context and depth are claims as much
  as the wording is — "PERSONAL" vs "COMMERCIAL" is the difference between a Projects
  line and an Experience bullet.
- **Add a skill / add evidence (2026-10-04).** The Evidence screen has an **Add skill**
  form: a skill name and kind plus its first piece of evidence (what you did, where, how
  deeply, last used, optional role or project). A skill with no evidence can't be used for
  anything, so the two are added together. The evidence is validated *before* the skill is
  created, so a mistake doesn't leave an empty skill. Naming a skill you already have
  (case-insensitive) adds the evidence to it rather than failing on the duplicate. Each
  skill also has **Add evidence**. Both use the existing `POST /skills` and
  `POST /evidence`. New evidence is unverified, and the screen switches to "To review",
  where it appears.
- Seed data must pass `findSeedProblems()` (`packages/db/prisma/seed/guards.ts`) and never
  sets `isVerified` ([§7](docs/career-data.md)).
- Resume variants are **stale** when any evidence they use is deleted, un-verified or
  changed since they were generated — derived when read, so no write path has to flag
  them; a stale resume can't be approved, reused or saved as a PDF ([§13.3](docs/resume.md)).
- Every resume bullet stores the evidence IDs it was built from and passes the code
  checks in [§13.1](docs/resume.md) before it is stored.

---

## 18. Working agreements

- The builder wants genuine understanding of every layer, not just working code — explain
  *why* a pattern is used alongside the code, especially anything that maps to a
  system-design interview concept (queues, validation boundaries, idempotency, failure
  visibility, auth).
- Prefer hand-rolled implementations of interview-relevant mechanisms over libraries
  that hide them, even when the library would be faster to ship.
- Decisions that belong to the user (preferences, personal facts, product direction) are
  asked, not guessed — e.g. evidence dates, UI library, which inbox to use.
- Record every design decision in the docs and the decision log (see the rules at the top).
- Product-facing names in English; the docs and all code/comments in plain, direct
  English.
