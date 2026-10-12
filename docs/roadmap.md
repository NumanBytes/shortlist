# Build state and roadmap

What is built, what comes next, and the open decisions.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 17. Build state and roadmap

### 17.1 Built and verified (as of 2026-10-02)

- **Monorepo:** `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`.
- **Auth** ([§8](security.md)): register, login, refresh, logout, `GET /auth/me`; refresh cookie; CORS
  allowlist; web token handling with single-flight + Web Lock.
- **Career truth CRUD** ([§6](../Agents.md)): skills, evidence (+ verify/unverify), work experience,
  projects — every verification-reset rule enforced and tested.
- **Career seed** ([§7](career-data.md)): 1 role, 1 project, 28 skills, 29 evidence items, all unverified;
  seeded into the user's account. CV reconciliation ([§7.5](career-data.md)): 63 items, 44 to review.
- **Resume tailoring** ([§13](resume.md)): Sonnet bullets checked by code, Resume card on Interested
  jobs, review page with sources, approval, reuse of approved resumes, derived staleness,
  "Save as PDF" (US Letter, matched to the user's CV) in the user's CV layout. Tested with a fake model; no real run yet.
- **Profile & education** ([§5.2](architecture.md)): `/profile`, `/education`, web Profile page; projects
  linkable to a role; evidence context/depth editable.
- **Discovery Milestone 1** ([§9](discovery.md)): worker, 10 adapters, two-stage filter, dedupe, run
  lifecycle, nightly Redis scheduler, 48 sources recorded (13 enabled). First live run:
  1,321 postings → 25–28 stored, including Septem's MERN role and Kwanso's Full Stack /
  MERN roles in Lahore.
- **Web app:** sign in/register; Jobs (New / Interested / Applied / Skipped, attribution,
  "Open posting", pipeline stages); Evidence review (verify / unverify / edit wording, context and depth); Profile & education;
  Sources (health, counts, errors, on/off, "Run discovery now"). Installable PWA.
- **API for jobs and discovery:** `/jobs`, `/jobs/:id`, `/discovery/sources`,
  `/discovery/run`.
- **UX pass (2026-10-04):** worker heartbeat, honest tailoring progress, app-wide
  tailoring bar, Jobs tab memory, "Find new jobs" with freshness, found time per job, jobs
  by source, Add skill / Add evidence.
- Tests: unit, e2e/integration and web tests across all packages; typecheck and lint
  clean. Migrations applied to a **local** Postgres (Neon not yet set up).

### 17.2 Roadmap (in order)

**Daily-use fixes (2026-10-13, from the user's production use; branch `fix/daily-use-improvements`):**
built — scoring no longer fails on broad requirements ([§12.1](ai-scoring.md)); Jobs grouped by day
and sources named ([§8.4](web-design.md)); catch-up discovery on worker start ([§9.8](discovery.md));
pinned projects ([§13.7](resume.md)); two-way resume reuse ([§13.2](resume.md)); the never-claim
list ([§13.8](resume.md)); PERSONAL + PRODUCTION placement ([§6.1](../Agents.md)); resume import
([§7.6](career-data.md)); onboarding and search settings ([§9.13](discovery.md)). **Next, in order:**
Discovery Milestones 2 and 3 on their own branch (item 6 below), then **push notifications** on a
separate branch (daily digest, instant strong-match and resume-ready pushes, broken-source alerts —
designed with the user 2026-10-12).

1. **User:** review the 44 unverified items from the CV reconciliation ([§7.5](career-data.md)) in the
   Evidence screen — fix the placeholder ones with Edit before verifying. Everything AI
   reads only verified evidence.
2. ~~**One real tailoring run**, then tune~~ — done 2026-10-04: real runs on the user's
   MERN job; layout matched to the CV and bullet wording tuned ([§13.1](resume.md)).
3. **Email job alerts** ([§10](email-alerts.md)): built 2026-10-03 — Gmail connected, Indeed parser, model
   fallback for every other portal, partial jobs and "paste full description". **Next:**
   a LinkedIn code parser once its alert volume and layout are confirmed; board discovery
   from alert-only companies ([§9.12](discovery.md)).
4. **"Add a job"** ([§11](discovery.md), incl. the Android share target). (AI scoring + budget guard:
   built — [§12](ai-scoring.md).)
5. **Resume extras** ([§13](resume.md)): base variants per niche and a library page, removing a single
   bullet, the application kit ([§13.5](resume.md)) and push notifications ([§13.6](resume.md)).
6. **Discovery Milestone 2** (hosted ATS pages), **source discovery** ([§9.11](discovery.md): board
   probing + monthly ATS-scoped search), then **Milestone 3** (custom sites via change
   watcher).
7. **Deploy** ([§4](architecture.md)): one VPS with Docker Compose. **Prepared and tested locally
   2026-10-04** (`deploy/`). **Live 2026-10-09** on AWS EC2 t4g.small with a DuckDNS
   hostname and the user's production data; a budget VPS follows within 6 months ([§4](architecture.md)).
   Off-site backups to Google Drive added 2026-10-09 ([§4](architecture.md)).
8. ~~Rate-limit `/auth/login` and `/auth/register`~~ — built 2026-10-04 ([§8.1](security.md)).

### 17.3 Open decisions

- **Scoring weight calibration** ([§12.1](ai-scoring.md)): PREFERRED/BONUS weights and the 45/70 verdict
  thresholds — tune on the user's real scored jobs, not a single sample.
- **Career data completeness:** Git, REST APIs, npm, pnpm, prompting added
  (2026-10-02). Testing (Jest/Vitest in paid work) not stated — the user decides.
- Whether prompt engineering at CloudCard is WORKING (seeded) or PRODUCTION — the user can raise it.
- Placement rules for COMMERCIAL + EXPOSURE, PERSONAL + MAINTENANCE and ACADEMIC +
  PRODUCTION / MAINTENANCE ([§6.1](../Agents.md)). COMMERCIAL + WORKING decided 2026-10-02;
  PERSONAL + PRODUCTION decided 2026-10-13 (Projects and Skills).
- The score threshold that gates tailoring ([§12.1](ai-scoring.md)) and the resume-reuse overlap threshold
  ([§13.2](resume.md)) — both runtime settings; initial values to be set when built.
- Skill aliases ("React" vs "React.js") — needs a canonical-name mapping ([§5.2](architecture.md)).
- UI for renaming skills and editing roles/projects (API endpoints exist; Profile and
  Education have UI since 2026-10-02; adding skills and evidence has UI since 2026-10-04).
