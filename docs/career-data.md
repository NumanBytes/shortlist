# Career data

The career database: the one-time seed and how it was reconciled with the CV.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 7. The career database (seed reference)

### 7.1 The data

`packages/db/prisma/seed/career-data.ts` encodes this as data; everything is seeded
**unverified** for the user to review, reword and verify.

**COMMERCIAL — CloudCard Inc., Lahore (May 2024–present; title Software Engineer, per
the user's CV — the seed's "Frontend Developer" was corrected 2026-10-02):**
HTML5, CSS, Tailwind CSS, JavaScript, TypeScript, React, Material UI, Ant Design (all
PRODUCTION); React and Angular version upgrades across apps (MAINTENANCE, not primary
development); Ruby, a little (WORKING); PostgreSQL / SQL — migrations, new tables and
columns, joins, stored procedures, query optimizations (PRODUCTION; wording from the
CV); role-based access control via DB configuration (PRODUCTION); full
**API Integration** — writing Ruby functions and classes in the in-house B2C layer
(between the frontend and the core Java backend) that call backend API endpoints, expose
them as **GraphQL** APIs, and consume them in the frontend (PRODUCTION; named and
described by the user 2026-10-02 — GraphQL added as its own commercial skill from that
description); SonarQube error remediation (PRODUCTION); Docker and Docker Compose — the user wrote the
Dockerfiles and compose setups (PRODUCTION, corrected 2026-10-02) but deployed through
CI/CD pipelines they didn't build or own (CI/CD: WORKING); microservices — worked within,
not owned (WORKING).
**Everyday tools (user-confirmed 2026-10-02):** Git, REST APIs, npm (PRODUCTION);
prompt engineering — daily use of AI assistants (WORKING: real, but not "built a feature
that shipped").

**PERSONAL / SELF-TAUGHT:** MERN (MongoDB, Express.js, Node.js) — small learning projects
in 2024, picked back up in 2026 (WORKING, never commercial). pnpm, incl. workspaces
(WORKING, Shortlist project). **Learning (EXPOSURE, user-stated 2026-10-02):** Next.js
(Manzil — *corrected from WORKING*), NextAuth, and the Shortlist stack — NestJS, Prisma,
Redis, BullMQ, Zod, TanStack Query, Vite, Vitest — worded as "learning while building
Shortlist; not yet able to build with it independently", because much of Shortlist's
code is written with an AI assistant while the user learns each layer. These move to
WORKING only when the user says they can build with them alone.

**ACADEMIC:** Python, Flask, Django, Java, C++, .NET — coursework, last used 2023
(EXPOSURE; already stale under the 2-year rule, kept in the database but never shown).

Dates known only to the year use July 1 of that year. The user supplied the university
and MERN dates (2026-10-01) rather than letting them be guessed, and on 2026-10-02 the
context (CloudCard vs personal) and depth of every newly added skill. Projects:
CloudCard (role), Manzil and Shortlist (personal, not shipped).

### 7.2 Known false claims that must never resurface

- **"Azure B2C"** — false. CloudCard's B2C layer is in-house Ruby ([§1.3](../Agents.md)).
- **Node.js / Express.js as CloudCard experience** — false. The only Node/Express
  experience is the self-taught MERN work. Building Shortlist's backend in NestJS is
  meant to turn this into real, verifiable evidence — **which the user must add in their
  own words** once they can explain each part; it is deliberately not seeded.

Since 2026-10-13 these are enforced as the user's **never-claim list**
([docs/resume.md §13.8](resume.md)), not by code that names them.

### 7.3 Seed guards and behaviour

`findSeedProblems()` refuses to write anything if the data mentions Azure (in a skill
name or evidence text), marks Node.js/Express.js/MongoDB as COMMERCIAL, carries
`isVerified`/`verifiedAt`, has commercial evidence without a role, links to an unknown
role/project, links both, duplicates a skill or a context/depth pair, or has a future
`lastUsed`. The seed attaches to an existing account (`SEED_USER_EMAIL`; it never touches
passwords), runs in one transaction, supports `--dry-run`, and is additive: evidence is
skipped if its skill already has evidence with the same context+depth, so rewording an
item never causes the original to be re-added and verifications are never overwritten.
It is deliberately *not* wired into Prisma's automatic seed hook (a `migrate reset` would
run it against a wiped database where the account doesn't exist).

### 7.4 After bootstrap the database is canonical (decided 2026-10-02)

The seed is a **one-time bootstrap**, not the source of truth. Once the user has edited,
reworded or verified evidence in the app, the database is canonical and the seed file is
not kept in sync — re-running it is harmless (it's additive) but it would not reflect the
user's own edits. New career facts go in through the app (or a reviewed one-off data
change applying the same un-verify rules), never by extending `career-data.ts`, which
would also have to carry personal data that must stay out of the repo.

### 7.5 Reconciling the CV with the database (2026-10-02)

The user's CV (`numan software engineer.pdf`, kept outside the repo) was compared with the
database. Every discrepancy was put to the user, and nothing was resolved by guessing:

- **Title:** the CV says *Software Engineer*; the role was changed and its 24 linked items
  un-verified (a claim change).
- **Docker / Docker Compose:** "I wrote Docker/compose setup and files but didn't own
  the pipelines" → PRODUCTION for Docker/Compose (reworded), new **CI/CD** COMMERCIAL
  WORKING ("deployed through existing pipelines; did not build or own them").
- **CV-only claims, added as unverified for the user to review** (user's choice): SQL
  reworded (joins, stored procedures, query optimizations); **Performance optimization**
  (lazy loading, dependency upgrades, cleanup); **Angular** development (PRODUCTION —
  the seed only had upgrades); the two CloudCard projects from the CV, **Digital Banking
  Platform (Web & Mobile)** and **Bank Portal (Enterprise Banking System)**, linked to
  the role, each CV bullet becoming evidence under Responsive Design, REST APIs,
  Component architecture or Role-based access control; Manzil's description.
- **CV skills with no stated context** (Redux, Context API, RxJS, Bootstrap, MySQL,
  Postman, GitHub, Cursor, WebStorm, DBeaver, Vercel): recorded cautiously as
  PERSONAL / WORKING with a placeholder `whatIDid` that tells the user to fix it with
  **Edit** (where, how deeply, own words) before verifying. Understating is safe;
  overstating is the Azure incident.
- **Contact details and education** (phone, LinkedIn, GitHub, location, BS IT at the
  University of the Punjab 2019–2023) went into the Profile — database only.

Result: 63 evidence items, 19 verified, 44 to review. Tailoring only ever sees the
verified ones.

### 7.6 Importing a resume (built 2026-10-13)

The seed (§7.1–7.3) only ever served one person. "Import from my resume" (Profile, and the
first onboarding step, [docs/discovery.md §9.13](discovery.md)) lets any user start from their own CV.

- **The PDF is read in the browser** with pdf.js (`apps/web/src/lib/pdf-text.ts`, loaded only
  when used and kept out of the offline app shell). Only the text is sent, and it's shown in an
  editable box first, which is also the fallback for scanned PDFs (paste the text). Chosen over
  server-side parsing: no file-upload endpoint, the API does no slow work, and the file never
  leaves the device.
- **`POST /career-import`** (text, 200–30,000 chars) stores a `CareerImport` row and queues a job
  on the `career` queue; one import at a time per user (409). `GET /career-import/latest` is
  polled while it runs and never returns the text.
- **The worker** (`apps/worker/src/career/`) asks Sonnet (`AI_MODELS.importResume`) through
  `ResumeReader` (faked in tests) for roles, projects, items and listed skills. The call is
  budget-checked (`BudgetGuard.checkMonthly`) and logged to `AiUsage` (`IMPORT_RESUME`) before its
  output is used.
- **Code decides what's kept** (`checkCareerExtraction()`, shared): a role's title and company,
  a project's name and a skill's name must appear in the resume; **every `whatIDid` must be a
  quote from the resume**, compared after normalizing only case, whitespace, bullet glyphs, curly
  quotes and dashes (a PDF's text layer differs from the model's copy in exactly those). That keeps
  §6.2 true: every bullet still traces to words the user wrote. **A quote must be a whole
  sentence or bullet** (`isWholeQuote()`, code review 2026-10-13): a fragment can say the
  opposite of its sentence ("lead the migration" inside "Did not lead the migration"). It must
  start where a sentence, bullet or line item starts and end where one ends; a line break
  inside it is fine (PDFs wrap bullets), and one before it counts only if the quote starts
  with a capital or digit (a wrapped line continues in lower case). Work under a role is COMMERCIAL;
  work claimed as paid with no role becomes PERSONAL; a never-claim term (§13.8) in its scope is
  dropped. Everything refused is listed with the reason ("left out").
- **Writes are additive and unverified:** an existing role (same company and title), project
  (name) or skill (name, any case) is reused, an identical item is skipped, nothing existing is
  edited, and `isVerified` is never set. Skills named only in a skills list become skills with no
  evidence, for the user to describe in their own words.
- **The text is cleared** when the import is done or failed; counts and the left-out list
  remain. A **deferred** import (budget, credit, no API key) keeps its text so "Try again"
  (`POST /career-import/:id/retry`) can run it — deferred, never dropped; a newer import
  replaces it and clears that text.
- **One pending import per user**, enforced by a partial unique index
  (`CareerImport_one_pending_per_user`), not a read-then-insert check — two racing requests
  both got in, and the second's job was dropped by a per-user queue dedupe id, leaving it
  pending forever (code review 2026-10-13). Dedupe ids are now per import, and a pending
  import older than 30 minutes is marked failed when the next one starts.
- Storing runs in one transaction with a 60 s timeout (Prisma's 5 s default was too tight); if
  it still fails, the import is marked FAILED rather than retried, since a retry would pay for
  the model call again.

