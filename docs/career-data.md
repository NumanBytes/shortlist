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
