# Resume tailoring

Tailoring, the resume library, approval and printing, and the application kit.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 13. Resume tailoring, the resume library, and the application kit

### 13.1 Tailoring (built 2026-10-02)

**The model words; code decides what may be claimed** — the same split as scoring ([§12.1](ai-scoring.md)).

- **Trigger:** only the user, from a job they marked Interested ("Tailor a resume",
  ≈ $0.03). "Tailor again" on a resume that is still current asks for a second click
  (it costs money and replaces a reviewed resume); an out-of-date one re-tailors directly.
  While a new attempt runs, fails or is deferred, the job's existing resume stays
  reachable on its card (code review, 2026-10-03).
  Nothing tailors automatically, so no score threshold is needed yet. The job
  must be scored: tailoring works from the analysis's requirement list.
- **Model:** Sonnet (`AI_MODELS.tailorResume`) — writing is where quality shows. Budget
  guard: the monthly cap only (the daily cap is for nightly analysis). Same rules as
  analysis: every call logged to `AiUsage` (`TAILOR_RESUME`) before its output is used,
  out-of-credit/over-budget → DEFERRED, invalid output → FAILED with no retry, a
  transient error that exhausts its retries → FAILED (never "Tailoring…" forever).
  Own queue (`resume`, concurrency 1), deduplicated per job so a double-click can't pay twice.
- **Never an endless spinner (2026-10-04).** This was found when the user saw "Tailoring…"
  for over ten minutes while the page kept polling, even across reloads. The cause was
  that no worker was running. Nothing was charged, because the model was never called. Now:
  `GET /jobs/:id/resume` returns `queuedAt` and `workerOnline` while PENDING. The card
  shows the elapsed time ("0:42 · usually under a minute — you can leave this page").
  With no worker it says so, and that nothing has been charged. After 2 minutes it says
  it's taking longer than usual. After 15 minutes it stops polling, says something is stuck
  and offers "Check again". Polling backs off: every 3s for the first minute, then 10s,
  then 15s while no worker runs, then not at all (`tailorPollInterval()`). A real run is one
  Sonnet call, typically 30–90s.
- **What the model sees:** verified evidence only, each item as an `E`-ref listed under
  the role/project it may appear in (placement rules, `placementFor()` in
  `packages/shared/src/resume.ts`); skills as `S`-refs with their strongest level, those
  known only at exposure marked "learning"; roles `R`, projects `P`; the requirement list;
  the description (≤ 8,000 chars) as untrusted data. It returns bullets (optional bold
  label + one sentence + the refs it relies on) and skill groups — refs only.
- **What code checks, per bullet** (`checkBullet()`); a failing bullet is removed and
  shown to the user with the reason, never printed:
  1. it cites at least one item, all of them known and verified;
  2. each cited item is allowed in that section **and** belongs there (a role's own items
     or its projects' items for Experience; that project's items for Projects) — personal
     work can't become an Experience bullet;
  3. no term on the user's **never-claim list** in its scope (§13.8) — for this user, no
     "Azure" anywhere and no Node.js/Express in paid work ([§7.2](career-data.md));
  4. no number that isn't in the cited items' own words (no invented metrics). Numbers are
     compared **whole**: digits inside a word ("B2C", "HTML5", "2019") are not numbers.
     Found in code review (2026-10-03): a substring match let "2 years across 19 services"
     pass because the evidence said "B2C … since 2019", and refused "HTML5";
  5. no technology named that it doesn't cite — a name counts as covered if it's a cited
     item's skill, the posting's name for it (from the analysis's exact matches), or
     named in the cited items' own text; "APIs" inside a covered "REST APIs" doesn't count;
     short names ("Go") match case-sensitively so "go live" isn't a claim;
  6. building verbs (built, developed, designed, led, owned…) only if a cited item is
     PRODUCTION or the user's own words use that verb — "working" and "maintenance" can't
     be inflated.
  Limits: 6 bullets per role, 3 per project. Every role is listed (a resume doesn't hide
  jobs); a project with no surviving bullet is left out.
- **Skills section:** only skills placeable in Skills ([§6.1](../Agents.md)). A skill whose verified
  evidence is all EXPOSURE goes in a **"Learning"** group that code labels, whatever the
  model did — listing NestJS beside React would overstate it (decided 2026-10-02).
- **Layout:** the user's own CV (centred name and contact line; Experience with bold
  bullet labels; grouped Skills; Projects; Education) — no summary, because their CV has
  none. Header and education come from the Profile ([§5.2](architecture.md)). Role-linked projects appear
  under Projects, as on the CV.
- **Bullet wording matched to the CV (2026-10-04).** The first real runs' Experience
  bullets averaged 20 words (up to 35), against 12 in the user's CV. They repeated the
  company name already in the heading, merged unrelated items into run-on sentences, and
  stated what the candidate *didn't* do ("without owning the services"). That last habit
  came from the prompt's "keep qualifiers" rule. The prompt now asks for at most 18 words
  (never more than 22), one topic per bullet, no company or role name, and the scope
  stated positively with the candidate's own limiting words ("existing pipelines"). It
  sets **no minimum length**: a "10 to 18 words" draft made the model pad a five-word
  fact with work the evidence didn't describe. A short true bullet beats a padded one.
  Result on the same job: an average of 12.9 words, longest 19, nothing padded.
  - The same run once returned skill **names** instead of `S` refs, which failed the whole
    paid resume at validation. `assembleResume()` now also accepts a skill's exact name
    (case-insensitive), but only for a skill that was offered with an `S` ref. Any other
    name is dropped like an unknown ref, so nothing new can be listed.
  - Validation failures now name the field ("skillGroups.0.skills.4"), not just "too big".
  - **`preview:resume <jobId>`** (worker CLI) runs a real tailoring and prints the bullets
    with word counts *without saving* them (`ResumeService.preview()`, which shares
    `draft()` with `tailor()`). Spend is logged to `AiUsage` as usual, and the model's raw
    answer is printed when validation fails. It's for tuning the prompt on real output.
- **Typography matched to the CV (2026-10-04).** The user found that the Experience and
  Projects bullets didn't look like their CV (`numan software engineer.pdf`, a Google Docs
  export). The page is rebuilt from measurements of that PDF: **US Letter, 1in margins**,
  Arial 11pt on a 15.5pt line, name 18pt, contact lines 12pt. Experience and Projects use
  a large **"●"** and Skills a small **"•"**, both 18pt from the margin with the text at
  36pt, so wrapped lines align with the text. A blank line separates sections and
  projects. The printed PDF was checked against the original with `pdftotext -bbox`
  (positions within 1pt). The markers are a **fixed-width column in a flex row**, not
  absolutely positioned: Chrome writes positioned content to the PDF out of reading order
  (all headings first, then the bullet text), which would garble the text an applicant
  tracking system reads.
- **PDF:** the browser's print → "Save as PDF" on a Letter print stylesheet (app chrome and
  toasts hidden; the page title becomes the file name). No PDF library and no server-side
  rendering: the text stays selectable for applicant tracking systems, and the paper
  stays white in dark mode (`paper`/`ink` tokens).
- **The review page shows the resume as it will print (2026-10-04).** The per-bullet
  sources used to be on by default, in a light-grey box in the resume's own font. The user
  read them as every bullet duplicated in smaller type, "a bugged resume". Now the page
  opens clean, and **Show sources** turns them on as clearly marked review notes (an
  accent edge, the app's UI font, a "From your evidence" label). They are never printed.
- **Review and approval:** the review page shows, under every bullet, the evidence it was
  built from, plus the bullets the checks removed. **"Save as PDF" appears only after the
  user approves**, and approval is refused for an out-of-date resume (409). Approve is its
  own endpoint (`POST /resumes/:id/approve`), like verify, and never optimistic. A draft
  printed anyway (Ctrl+P) carries a "DRAFT — NOT YET APPROVED" banner. The code checks are
  a net; the user's reading is the final gate.

### 13.2 The resume library (decided 2026-10-02)

The user's idea: keep a store of resumes per niche (React, Next.js, Node, frontend,
backend, MERN, full-stack…) and reuse one when several job descriptions are effectively
the same, instead of generating a new resume each time. **Adopted, with one change:
match by requirements, not by job title.** Titles are unreliable — "Software Engineer"
at Kwanso is MERN while at Motive it may be Go, and "Frontend Engineer" and "React
Developer" often ask for the same things.

- **Every tailored resume is stored as a variant** with the requirement profile it was
  built for (e.g. {React, TypeScript, Node, MongoDB}).
- **For each new job, plain code (no AI) compares its extracted requirements against
  every APPROVED, up-to-date variant** (`resumeOverlap()`: share of the job's normalized
  requirement names, alternatives split, that the variant was built for). If the overlap is high (~85%, tunable) **and** the job has no REQUIRED
  skill the variant doesn't cover → **reuse it at zero AI cost** ("Reusing your MERN Full
  Stack resume — 92% match", with "tailor fresh anyway"). Otherwise tailor a new one and
  store it as a new variant.
- **Built 2026-10-02:** reuse is offered on the job's Resume card (up to 3 offers, with
  the jobs each was used for); the threshold is a setting
  (`AiSettings.resumeReuseMinOverlap`, default 0.85). Only approved resumes are offered or
  accepted (409 otherwise) — reuse skips review, so the reused resume must already have had one.
- **Two-way check (2026-10-13):** coverage alone was one-sided. In production, a "React
  Developer (TypeScript)" posting whose analysis found only React and TypeScript was 100%
  covered by the approved MERN resume (built for 18 requirements) and offered as a "100%
  match", then reused. An offer now also needs **focus** — the share of the variant's own
  profile the new job asks for — of at least `MIN_REUSE_FOCUS` (0.6), so reuse means "the
  same kind of job". The card says "Covers 92% of this job's requirements" instead of
  "92% match", which read like the score ring's number.
- **Base variants (not built yet):** the user can create and pin a base resume per niche, each generated
  and reviewed once; most jobs then map to one of them.
- **Why it's worth it:** the API saving is real but small (a Sonnet tailoring run costs
  cents; ~$3/month at expected volume). **The bigger saving is review time** — every new
  resume must be read and approved before it goes out, while a reused, already-approved
  variant needs no second review.

### 13.3 Staleness (built 2026-10-02: derived, never stored)

A resume is **out of date** when any evidence it relies on (`evidenceIds`: every cited
item plus the items behind each listed skill) has been deleted, un-verified, or changed
after the resume was generated (`updatedAt > generatedAt`). `generatedAt` is the moment
the worker **read** the evidence, not when it saved the result: stamping it after the
≈30s model call hid an edit + re-verify made during the call (code review, 2026-10-03).
Staleness is **computed when read**, not flagged on write: every claim change —
rewording, a skill rename, a role edit —
already touches the evidence row (un-verifying it), so no current or future write path has
to remember to mark resumes. Re-verifying an item after an edit doesn't make an old resume
current again: its wording came from the old text. An out-of-date resume can't be
approved, reused or saved as a PDF from the app until it is tailored again. Verifying a
*new* item doesn't make a resume stale — it's still true, just less complete.

### 13.4 Schema (built 2026-10-02)

`TailoredResume` (one per `JobMatch`, 0 rows) was dropped and replaced by `ResumeVariant`
and `JobResume` ([§5.2](architecture.md)). Many jobs can share one variant, and "what did I send Kwanso?" is
answered by the job's `JobResume`.

### 13.5 The application kit (planned)

Per job, ready for the user to submit themselves: the tailored (or reused) PDF; for
"send your CV to <email>" postings, a drafted email opened in the user's own mail app
(`mailto:` with subject/body; the user attaches/sends); drafted answers to common
screening questions (years of experience computed from verified dates); outreach and
follow-up drafts.

### 13.6 Notifications (planned)

When a resume is ready (tailored or reused), a Web Push notification: "Resume ready:
<title> @ <company> — review and submit." Opening it shows the resume, the evidence
behind each bullet, and the gaps.

### 13.7 Pinned projects (built 2026-10-13)

**The problem (user report, 2026-10-11):** each tailoring run chose projects afresh ("skip
projects with nothing relevant"), so one draft for a frontend job kept only Manzil and
the re-tailor ten minutes later kept the two banking projects and dropped Manzil. The user's
view, adopted: projects are achievements, not keywords — the resume shouldn't lose them
depending on the posting.

- **`Project.isPinned`** — set with "Always on my resume" in the project's sheet on Profile.
  It is **not a claim** (it says nothing about what was done), so it is not in the
  project's `CLAIM_FIELDS` and never un-verifies evidence (an e2e test covers it).
- **Tailoring:** the prompt marks pinned projects `PINNED` and asks for every one, choosing
  that project's items that matter most for the job. Unpinned projects still appear only
  when relevant.
- **Code guarantees it, not the model:** if the model leaves a pinned project out, or the
  checks remove all its bullets, `assembleResume()` falls back to the user's own verified
  `whatIDid` for that project's placeable items (strongest depth first, up to 3) — each still
  run through `checkBullet()`, so a fallback can't claim more than the user wrote. If none
  can appear (e.g. only exposure-level items), the resume notes it under removed items
  instead of failing.
- Pinning changes nothing already generated: tailor again to apply it.
- **Still open — why Shortlist never appears:** its PERSONAL + PRODUCTION items are placed
  nowhere until the user decides that combination ([§6.1](../Agents.md), roadmap §17.3), so
  only its working-level items can be bullets.

### 13.8 The never-claim list (built 2026-10-13)

The known false claims ([§7.2](career-data.md)) were hardcoded in `checkBullet()` in shared
code: "Azure" refused anywhere, Node.js/Express refused in paid work. That made one
person's facts a rule for every user — someone who really used Azure would have had true
bullets removed. They are now the user's data.

- **`NeverClaim` rows** (`term`, `scope` ANYWHERE | PAID_WORK, optional `note`), managed under
  "Never on my resume" on Profile (`GET/POST/DELETE /never-claim`). One entry per term and
  scope, compared case-insensitively. Only the user changes the list; nothing generated
  writes to it.
- **Matching** (`mentionsTerm()`): a whole term, case-insensitive for names of 4+
  characters, also without dots and without a trailing ".js" — "Node.js" catches "Node",
  "NodeJS" and "Node.js". PAID_WORK applies to Experience and to projects done in a role.
- **Refused whatever a bullet cites**, like before. The prompt also lists the terms, so the
  model rarely writes bullets the check would throw away.
- **No gap in protection:** the migration (`20261013010000_never_claim`) inserts the three
  former hardcoded entries (Azure / ANYWHERE; Node.js and Express / PAID_WORK) for every user
  with a CloudCard role, so the deployed instance keeps the same checks from its first
  tailoring after the upgrade. The rule against naming an uncited technology still applies
  on top: even with an empty list, "Azure" in a bullet is refused unless a cited item names it.
- The seed guards (§7.3) still refuse Azure and commercial Node/Express in the seed file:
  that file is this user's one-time bootstrap, not a rule for others.

