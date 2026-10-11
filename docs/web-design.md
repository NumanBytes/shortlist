# Web UI design

The design system, the mobile design, interactions, and the app icon.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

### 8.4 Web UI design system (2026-10-02)

Redesigned after reviewing every screen with the user's real scored jobs (before: ~2½
jobs per phone screen, the score a small corner badge, three rows of controls above the
first job, inline details pushing the list down, no overview, no dark mode).
- **Semantic color tokens** (`apps/web/src/index.css`: `bg`, `surface`, `fg`, `muted`,
  `accent`, `apply`/`stretch`/`skip`, `danger`, …) mapped into Tailwind with
  `@theme inline`. Components use only these names, never raw palette colors, so **dark
  mode is automatic** (`prefers-color-scheme`) and a rebrand is one file.
- **Shared primitives** (`components/ui.tsx`): Button, IconButton (accessible name
  required), Badge (tones), Card, Skeleton, Switch (`role="switch"`), Segmented
  (`<fieldset>` + hidden legend), TextField, EmptyState. Icons: lucide-react
  (tree-shaken).
- **Navigation:** a bottom tab bar on phones (thumb reach, safe-area aware) and top
  navigation on desktop; Evidence shows a "to review" count; sign-out lives in an
  account menu (closes on outside tap and Escape).
- **Jobs:** the **score ring** leads every row; the source and icon actions (open
  posting, interested, skip — 40px tap targets) sit in a footer row, so a row is only as
  tall as its content; company-board jobs say "company site" rather than repeating the
  company; moving a job out of the list shows a toast with **Undo**; verdict filter chips with counts; with no filter and
  best-match order, **SKIP jobs fold into "Show N weaker matches"** (never hidden for
  good). Detail is its own route (`/jobs/:id`): **full screen on phones, a side panel
  beside the list on desktop**; score card → why it fits → gaps → risks → description
  (collapsed). **List state lives in the URL** (`?tab=&verdict=&sort=`), so back
  navigation restores it.
- **The Jobs tab returns to where you were (2026-10-04).** Previously the tab always
  linked to `/`, so if you left a job while its resume was tailoring, tapping Jobs dropped
  you at the top of the list. Now, from another page, it links back to the last jobs URL
  you were on (that job, with its list state); tapping it while already in Jobs goes to the
  list and keeps its tab and filters, which is how a tab bar normally behaves.
- **Leaving a page never stops work, so nothing blocks navigation (2026-10-04).** The user
  asked to "protect routes" while tailoring. Tailoring runs in the worker, so leaving the
  page can't break or cancel it, and blocking navigation would add friction without
  protecting anything. Instead, a slim **"Tailoring resume · <job> · 0:42"** bar under the
  header (`GET /resumes/active`) is shown on every page except that job's own page, and
  links back to the job.
- **Found time on every row (2026-10-04):** "Found 2d ago" (`discoveredAt`) leads the row
  footer, so it survives truncation on a phone, and it's the **only** time on the card (the
  user's choice). The aggregator posting age moved off the card. It is still shown on the
  job's detail page, aggregators only ([§9.6](discovery.md)). The footer keeps the source name, which the
  aggregators' terms require.
- **"Find new jobs" (2026-10-04)** heads the New tab and the Sources page (one component,
  `FindNewJobs`): "Last checked 2d ago" (latest `lastRunAt` among enabled board sources),
  the nightly run's time (read from the BullMQ scheduler in Redis), a live "Checking 3
  sources…" while runs are RUNNING, a warning when no worker is running, and when the
  cooldown lets sources be checked again. The button calls the existing
  `POST /discovery/run` ([§9.9](discovery.md)).
- **Jobs by source (2026-10-04):** a source's "24 jobs" on the Sources page, and "View
  jobs" for an alert portal on the Gmail card, open `/?source=<id>&tab=all`. The list is
  filtered by `GET /jobs?sourceId=`, an **All** pipeline tab appears only in this view
  (the count covers every stage), and a dismissible "Only jobs from Indeed alerts" bar
  clears the filter.
- **Honest display:** a company board's publish date is not shown (a listed job is open,
  [§9.6](discovery.md)) — only aggregator posting ages; locations are normalized ("pk" → "PK"); a work-
  mode badge is dropped when the location already says it.
- **Sources:** AI spend as stat tiles; sources needing attention (FAILED/EMPTY) listed
  first; healthy rows carry no badge; real switches.
- Every screen was verified in a headless browser at phone (390px), tablet (768px) and
  desktop (1280–1440px) sizes, in light and dark, including interactive states (menus,
  editing, errors, toasts), against a copy of the user's real data. A second audit pass
  caught: `m-0` on `<fieldset>` wiping the parent's `space-y` gap (controls touching
  content), tall rows from stacked icons, repeated company names, a menu that didn't
  close, and no feedback when a job left the list.

### 8.4.1 Mobile design from Claude Design (2026-10-04)

The user generated a mobile design in Claude Design from a prompt describing Shortlist's
real screens, data and tokens, and asked for it to be implemented. That's 14 boards: jobs
list and its states, job detail, status sheet, resume-card states, resume review, Evidence,
Add skill, Sources, Profile, Sign in, patterns (sheets, toast, install prompt), a
component sheet and a motion spec. It is implemented in the existing React + Tailwind PWA:
**no native app and no rewrite**. Phones get the design; wider screens keep a top bar and
the list/detail split.
- **Tokens:**
  - The existing names are kept (so every screen inherits the look), with the design's
    values.
  - Added: `accent-fg` / `accent-soft` / `on-accent` (the primary button is now the green
    accent, not near-black), `scrim`, `glass` (frosted bars), `toast-accent` and
    `shadow-card`.
  - Font: **Geist**, bundled from `@fontsource-variable/geist`, not a CDN, so the installed
    app works offline.
  - Motion: 150–250ms with one easing curve; reduced motion turns movement into fades.
- **Primitives** (`ui.tsx`): 44px touch targets; `Button` gains `tinted` and `lg`;
  `buttonStyles()` styles a real link as a button; plus `Chip`, `SectionLabel`, and
  **`Sheet`**. The sheet is built on the native `<dialog>`, whose `showModal()` gives focus
  trapping, Escape to close and an inert background for free. It's a bottom sheet on phones
  and a centred dialog on wider screens.
- **Shell:**
  - Large 30px page titles with the account avatar beside them on phones.
  - The account menu became an account sheet.
  - A frosted tab bar, which is **hidden on pushed screens** (a job and its resume), where
    the screen has its own back link and bottom action bar.
  - The tailoring indicator became the design's dark floating pill above the tab bar.
- **Jobs list:** tab counts from a new `GET /jobs/counts` (per status, optional `sourceId`).
  The freshness card reads "Check for new jobs", and shows "Available again in 3h" during
  the cooldown when there's no Gmail to check. Verdict chips with dots; "N matches · Best
  match" sort toggle; empty state with "See Interested"; an error state with Try again.
- **Job detail:**
  - Score hero; "Why it fits" maps each requirement to a verified-skill chip; Gaps end
    with "Have experience here? Add evidence"; Risks; the description collapsed under
    "Read more".
  - A sticky bar with **status ▾ + Open posting**. Status changes moved into a **status
    sheet** (Shortlist / Pipeline / Closed, plus "Move back to New"), which replaced the
    separate Interested, I applied and Skip buttons and the stage dropdown.
- **Resume card:** the design's states (reuse offer, tailor, tailoring, stalled, ready,
  approved, out of date, failed, deferred with a link to the budget). Re-tailoring a
  current resume asks in the design's confirm sheet.

**Deliberately not copied from the design:**
- The design's sample resume (a Summary section, different layout, and an "Azure AD B2C"
  bullet, a known false claim, [§7.2](career-data.md)). The document stays matched to the user's CV
  ([§13.1](resume.md)).
- **Step-by-step tailoring progress** ("Picked 9 items → Writing bullets → Checks"): the
  worker reports no steps, so it would be fake. Instead there's an elapsed timer and an
  indeterminate bar.
- **"Forgot password?":** there's no email sending.
- **Posting age on job rows:** the user's choice (only the found time).
- **New features the design implies:** editing a failing source's URL, cancelling a
  tailoring run, adding or editing roles and projects on Profile, and swipe gestures.
  These are left for later, as separate work.

Verified in a headless browser at 390×844 in light and dark, against a **copy** of the
user's database on separate ports. Chrome is driven directly over the DevTools protocol;
no Playwright is installed.

**Phase 3 and a fidelity pass (2026-10-04).** The user doubted that the screens followed
the boards exactly. Each implemented screen was then rendered **side by side with its
board at the same size**, and every difference was listed and fixed:
- **Fixes to phases 1–2:**
  - two-line card footer ("via …" over "Found …");
  - "82 / of 100" in the hero ring;
  - a factual fit line, "4 of 5 required skills backed by verified evidence", computed
    from the requirements;
  - a status button that no longer truncates;
  - a green "Done" and "Applied" (not "I applied") in the status sheet.
- **Phase 3:**
  - **Evidence:** a progress card and collapsible skill groups, with groups needing review
    first; a collapsed group shows "N to review".
  - **One evidence sheet** for adding a skill with its first evidence, adding evidence and
    editing. Context and Depth are segmented controls with a plain-language hint. Edits
    send only what changed and warn that they un-verify; new evidence is always
    unverified. The design has no **Kind** field, but every skill needs a category, so a
    compact Kind picker sits beside the name.
  - **Resume review:** the page is shown at its real width, scaled to fit the phone, and
    printing undoes the scaling. **Tapping a bullet opens a sheet with the evidence behind
    it** (the user's words, context, depth, verified, date); this replaced the "Show
    sources" switch. "Removed by checks" is listed with reasons, there's a sticky Approve
    bar (Save as PDF once approved), and a faint DRAFT watermark. A printed check caught a
    regression: an inline-block button's baseline is its *last* line, which dropped every
    "●" to its bullet's last line in the PDF. The bullet button is now `block`, and
    positions were re-measured against the CV (within 1pt).
  - **Sources:** an AI-spend tile with a "Budget" link to Profile, a **Today** tile (new
    `last24hUsd` on `/ai/usage`), a **Jobs this week** tile (new `jobsThisWeek` on
    `/discovery/status`), and "Needs attention" with a **Retry for that one source**
    (new `POST /discovery/sources/:id/run`, same cooldown, 409 with the time it can run
    again). Then the Healthy list and the Gmail card ("Connected as …", On, Check now /
    Disconnect). Finding new jobs lives on the Jobs page only.
  - **Profile:** a back link, Edit (opens the contact sheet), an identity header, and
    Experience / Projects / Education (education opens an edit sheet, and there's "Add
    education"). The budget moved here: a monthly-cap stepper (the middle is editable and
    an emptied field never becomes $0) and the resume-reuse slider. Account: Gmail and Sign
    out.
  - **Sign in:** the mark and promise up top; a Sign in / Register switch; a password
    show/hide toggle.
  - **Install prompt:** on Chrome/Android it keeps `beforeinstallprompt` and installs from
    a button; on iPhone Safari it shows the two taps. Never shown inside the installed app,
    and "Not now" is remembered on the device.
- **Appearance (the user asked for it; the design has no control):** **System / Light /
  Dark** in the account sheet. The dark tokens apply under
  `prefers-color-scheme: dark` *unless* `<html data-theme="light">`, or always under
  `data-theme="dark"`. The choice is stored per device in `localStorage` and applied by
  an inline script in `index.html` **before the first paint** (no flash), and the
  status-bar colour follows it.
- **Done next (2026-10-05)**; see "Interactions and motion" below.

### 8.4.2 Interactions and motion (2026-10-05)

The design's remaining features, and every animation in its motion spec ("subtle and
fast: 150–250ms", easing `cubic-bezier(.2,.8,.2,1)`, exits `ease-in`):
- **Push (row → detail, detail → resume review):** the new screen slides in from the right
  in 240ms while the old one moves 30% left and dims to 70%; back reverses it in 200ms.
  The score ring is a **shared element** that grows from 44 to 88px. This uses the **View
  Transitions API**, with these choices:
  - **No react-router `viewTransition` option.** It only works with the data router, and
    this app uses `<BrowserRouter>`. `PushLink` / `pushNavigate()` call
    `document.startViewTransition` directly.
  - **The callback waits for the route to commit.** Its promise resolves from a layout
    effect (`<RouteCommitted>`), because react-router applies navigation as a
    low-priority update that `flushSync` can't force. Without this the browser snapshotted
    the *list* as the new screen.
  - **Only the tapped card's ring carries the transition name** (`nameSharedRing`). When
    every ring had one, the untapped rings stayed put while the list slid away.
  - **The job is prefetched for up to 250ms before pushing**, so the detail ring is there
    to grow into.
  - Phones only; wide screens show list and detail side by side.
  - Browsers without the API just navigate.
  - These were verified by probing the running animations (one `root` push, one
    `ring-<id>` group, both old and new) and by a capture at 1/10 speed.
- **Edge-swipe back** (40% of the width, or a flick that has also travelled 15%). It is
  enabled **only in the installed app**, because a browser tab has its own edge swipe and
  two gestures on one edge would fight.
- **Bottom sheet:**
  - in 240ms, out 180ms ease-in (the sheet stays rendered while it slides), and the
    backdrop fades;
  - **drag the handle down to dismiss** (past 30% of its height, or a flick that has
    travelled at least 40px);
  - focus moves to the sheet itself, not its first button, because a ring there looked
    like a selection on a phone.
- **Swipe a job row** (`useSwipeRow`):
  - the row follows the finger over a green "Interested" or grey "Skip" layer; only a
    mostly-horizontal drag counts, with `touch-action: pan-y pinch-zoom`;
  - past 35% the icon grows to 1.15× with a light haptic (`navigator.vibrate`, which
    Android supports and iOS ignores);
  - released past that, the row exits in 180ms, the gap closes in 200ms, and *then* the
    status is saved and the Undo toast shows; the ★/✕ buttons play the same exit;
  - **Undo slides the row back** from the side it left (200ms).
  - New: right → Interested, left → Skip. Interested: left → back to New. Skipped: right
    → back to New.
- **Toast:** rises 12px and fades in (200ms), stays 5s, then drops out (200ms). **The
  tailoring pill** rises 8px.
- **Reduced motion:** movement becomes 150ms fades, view transitions become a crossfade,
  spinners stay, and skeleton pulses stop.

The features:
- **Roles and projects are editable on Profile** (add, edit, delete; `CareerForms.tsx`).
  Forms validate with the shared schemas and send only changed fields. A claim change says
  it will un-verify linked evidence, and deleting asks first and says what happens.
- **"Edit URL"** on a failing company board: `PATCH /discovery/sources/:id/address`.
  `parseBoardAddress()` (shared) accepts the board's link or bare name for Greenhouse,
  Lever, SmartRecruiters and Workable, refuses links to another platform, stores only the
  board name, and clears the cooldown so Retry works at once. Aggregators have fixed
  addresses. Sources now return `board`.
- **Cancel a tailoring run:** `POST /jobs/:id/resume/cancel`. A run still waiting (or in
  retry backoff) is removed from the queue, found via its deduplication id, so nothing is
  charged. One the worker has started returns 409, because its Claude call is in flight.
  The job's previous resume is kept.
- **"···" menus.** The design shows them but not their contents, so these were chosen to
  be useful and already supported:
  - **Job:** copy the posting link, score again, skip / move back to New.
  - **Resume review:** **copy as plain text** (for application forms that want pasted
    text, in the printed order, without removed bullets), tailor again, open the job.

### 8.4.3 App icon and mark (2026-10-11)

The first icon was a plain checkmark (favicon, home screen) and the in-app header used a
different, stock `ListChecks` glyph, so the app had two marks and neither said anything
about Shortlist. Seven directions were drawn on a Claude Design canvas at real sizes
(16px tab to home screen, light and dark); the user chose **"the slice"**.
- **The mark:** three list bars whose right ends sit on one diagonal cut line; only the
  middle bar, in green, runs past it. "Many in, one picked", with the angled ends as the
  brand detail. Plain bars, so it stays legible at 16px (the ring and monogram options
  didn't).
- **One geometry everywhere** (64-unit grid): `apps/web/public/favicon.svg` is the
  single source. The app icon is green on navy (`#0f172a`), with the grey bars as solid
  colours: translucent white bars showed seams where the shapes are anti-aliased. In the
  app, `Logo.tsx` (header, sign-in, install sheet) draws the same paths with tokens — an
  `accent` tile, `on-accent` bars, the outer two at 50% — so dark mode follows; on a
  single flat tile with no overlapping shapes, opacity shows no seams.
- **PNGs are generated, not hand-made:** `apps/web/icons/render.sh` rasterizes
  `favicon.svg` with headless Chrome (no image library). Every variant comes from that one
  file: `apple-touch-icon.png` is drawn full-bleed in the tile colour (read from the SVG)
  because iOS rounds the corners itself and shows transparency as black; the maskable
  icon is full-bleed with the mark scaled to 85%, inside the safe zone (centre circle, 40%
  radius), because Android crops maskable icons to its own shape. The script checks that
  Chrome actually loaded the SVG (Chrome exits 0 on a blank page) and replaces the PNGs
  only when every render succeeded.
- **Caching:** icons keep their file names when the mark changes, so Caddy sends them with
  `no-cache` (a cheap 304 while unchanged); browsers otherwise cache favicons for a long
  time.
