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
  tall as its content; the source is named so the user's own company list reads
  differently from a portal — "via Kwanso careers", "via Remote OK", "via LinkedIn alert"
  (`sourceName()`; 2026-10-13, replacing "via company site", which didn't say *which* site);
  moving a job out of the list shows a toast with **Undo**; verdict filter chips with counts; with no filter,
  **SKIP jobs fold into "Show N weaker matches"** (never hidden for good).
  **Default order: by day (2026-10-13, user's request):** jobs grouped under "Today",
  "Yesterday", "Fri 9 Oct"… by when Shortlist found them (the phone's local day), newest
  day first and the best match first inside each day — jobs arrive in a nightly batch, so the
  latest batch is what's new. The toggle switches to "Best match" across all days; the old
  flat "Newest" order was dropped (by day already leads with the newest). Detail is its own route (`/jobs/:id`): **full screen on phones, a side panel
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

### 8.4.4 When a screen crashes (2026-10-12)

A component that throws while rendering unmounts the whole React tree; in an installed
PWA that is a blank screen with no address bar and no way back but force-quitting.
- **Two error boundaries** (`layout/ErrorBoundary.tsx`). One wraps each screen inside
  `AppShell`, so the navigation survives a broken screen; its `resetKey` is the path, so
  leaving through a tab clears the error without a reload. A second wraps the whole app
  in `main.tsx` for errors outside a screen (sign-in, the providers).
- **The fallback** says what happened and offers *Reload* (most likely cause after a
  deploy: an old screen meeting the new API) and *Go to Jobs*, a plain link with a full
  page load, so it works even if the router is what broke.
- Data errors are not this: failed requests already show inline errors through TanStack
  Query. The boundary only catches bugs that throw during render.


### 8.5 UI audit against standard scales (2026-10-14)

The user asked for a senior-designer pass over every screen, block and element, measured
against a standard scale, with fixes to follow later. **Measured against:** WCAG 2.2 AA
(1.4.3 text contrast 4.5:1, 3:1 for ≥24px or ≥18.66px bold; 1.4.11 non-text contrast 3:1;
2.2.1 timing; 2.5.8 target size ≥24px), Apple HIG / Material touch targets (44pt / 48dp),
the HIG and Material type scales, and a 4px spacing grid. Contrast was computed from the
tokens in `index.css`. **Method:** a source review of every screen, sheet and primitive,
then a screenshot pass (same day; results under "Screenshot pass" below). The screenshots
came from a throwaway stack: Postgres and Redis in Docker, the API on :3001 and Vite on :5174,
filled with made-up data. Headless Chrome was driven over the DevTools protocol at 390×844
and 1280×800, in light and dark, covering sheets, a toast and a brand-new account.

**Already strong (keep):** 44px targets almost everywhere, native `<dialog>` sheets,
reduced-motion handling, semantic tokens with dark mode, error boundaries, honest empty and
error states, list state in the URL.

Severity: **P1** fails an accessibility criterion or breaks a task; **P2** noticeable
friction or inconsistency; **P3** polish.

**Design system (all screens)**

| ID | Sev | Problem | Fix |
|---|---|---|---|
| G1 | P1 | Primary button: white on `accent` #059669 is **3.77:1** (15–16px semibold needs 4.5:1). Every primary action fails in light mode. | Button fill `#047857` (5.48:1) in light, or a separate `--accent-strong` for fills with text. |
| G2 | P1 | `subtle` text is **3.10:1** on surface, **2.86:1** on bg (dark 4.09:1): paste-form placeholder, "Scoring again costs…", Gmail "Last:" lines. | Darken `subtle` to ≥4.5:1, or use `muted`. |
| G3 | P1 | iOS Safari zooms into any field under 16px: Evidence sheet selects and month (15px), resume-import textarea (13px), paste-description textarea (14px), budget input (15px), notification selects (15px). | Every form control `text-base`. A lint/grep check for `text-[1[0-5]px]` on inputs. |
| G4 | P1 | Non-text contrast: input borders **1.25:1** (dark 1.35:1); the **off switch track is the border colour, 1.25:1**, so an off switch nearly disappears. | An `--input-border` token ≥3:1 for inputs, selects and the off switch. Card borders may stay decorative. |
| G5 | P2 | Score ring: strokes 2.2–2.5:1 on white, track `surface-2` **1.12:1**. The fill amount is hard to read (the number carries it). `--ring-track` exists but nothing uses it. | Use `ring-track` with a darker value; darker stroke variants for light mode. |
| G6 | P2 | Toast with **Undo** disappears after 5s and never pauses (2.2.1). | Pause on hover, focus and touch; 8s when it has an action. |
| G7 | P1 | **Bottom overlays collide.** Toast and tailoring pill both sit 72px up. On job detail and resume review (no tab bar, a ~80px fixed action bar) they cover the action bar. Evidence's "Add skill" button at 76px sits under them. | One bottom-offset variable set by the screen (tab bar or action bar height); the toast stacks above the pill; the action button moves up while a toast shows. |
| G8 | P2 | Sheets: no visible close on desktop (the grab handle is phone-only), so menus and Account close only by Escape or backdrop. Headers vary (4+ patterns: hidden title plus a visible copy, "Cancel · title", "title · Done", none). | `Sheet` renders the visible title and a close button (sm+); content stops repeating it. |
| G9 | P2 | **Two type scales mixed:** HIG sizes (11/13/15/17) beside Tailwind's (12/14/16/20/24) plus 26/28/30, 12 sizes in all. The same role (body, secondary) is 13, 14, 15 or 16px depending on the screen. | Define named steps (caption 12, footnote 13, body 15, headline 17, title 22, large title 30) as utilities; replace arbitrary `text-[Npx]`. |
| G10 | P3 | Corner radii: 8 values (6/8/9/10/12/14/16/28). | Four tokens: sm 8, md 12, lg 16, sheet 28. |
| G11 | P2 | Four "selected" styles: segmented (raised white), chips (inverted black), nav and status sheet (accent tint). Black is also used for the Evidence action button and the toast, so the primary colour is ambiguous. | Selection = accent tint everywhere; black only for the toast and pill. |
| G12 | P2 | **Developer text shown to users:** Evidence empty state prints a `pnpm` seed command; Sources empty prints `pnpm --filter … db:seed:sources`; Gmail lists env var names and a doc section; Notifications mentions VAPID keys and `deploy/.env.example`. Contradicts "serves any user". | User words plus a real action (Import resume, Add skill, Follow remote boards); admin details behind a "For the server admin" disclosure. |
| G13 | P3 | Auto-saved settings give no confirmation (notification switches, budget stepper, reuse slider, source switches). | An inline "Saved ✓" or toast; debounce the stepper (today every tap is a request). |
| G14 | P2 | Removing a **never-claim term**, a truthfulness safeguard, is one tap with no confirm or undo. | Undo toast. |

**Navigation and structure**

| ID | Sev | Problem | Fix |
|---|---|---|---|
| N1 | P2 | Profile is reached only from the avatar; its back link always goes to Jobs, even when opened from Evidence or Sources; no tab is active there. | Back = history back with a Jobs fallback (or Profile becomes a fourth tab). |
| N2 | P2 | Profile is one 9-group scroll mixing resume content (Experience, Projects, Education) with settings (search, notifications, never-claim, budget, account). | Split: "Career" (what resumes are built from) and "Settings" (a separate route or a segmented switch). |
| N3 | P1 | **Onboarding step 3 "Set up on Sources" bounces back to step 1** when nothing was saved yet: the gate redirects while `prefs + roles + skills + sources === 0` and the done flag is unset. | Set the done flag (or exempt `/sources`) before leaving onboarding. |
| N4 | P2 | Onboarding step 1's way forward is a ghost "Next"; there's no Back between steps, and progress is only "Step n of 3". | Same primary/skip pair on each step, a back link, a 3-dot progress bar. |
| I1 | P2 | Install prompt is a modal 4s after first load (iOS), interrupting onboarding; on iOS "Not now" and "Got it" do the same thing. | Offer it after a meaningful moment (second visit, or after opening a job), as a dismissible banner; one button on iOS. |

**Screens**

| ID | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| J1 | P2 | Jobs | Pipeline control: 4–5 equal segments with counts; on a 390px phone "Interested 12" truncates, and with a source filter each segment is ~68px. | Scrollable tabs, or counts as small badges. |
| J2 | P2 | Jobs | "Weaker matches" at 80% opacity drops secondary text to **3.92:1**. | No opacity; a section label says what they are. |
| J3 | P2 | Jobs | Unscored ring: dashed `surface-2` border at 1.12:1, which reads as an empty gap. | Visible dashed ring plus the existing "Scoring…" badge. |
| J4 | P3 | Jobs | Sort is one button cycling two states, and its label shows the current state, not the action. | Two-option control "By day / Best match". |
| D1 | P2 | Job detail | No posting link: the action bar leaves an empty half beside the status button. | Status button spans both columns. |
| D2 | P2 | Job detail | Description: long text in grey `muted` at 14px inside its own 60vh scroller (scroll inside scroll on phones); no "Show less". | `fg` at 15px, no inner scroll, a "Show less". |
| D3 | P3 | Job detail | Gap severity: Moderate and Minor share one neutral badge. | Moderate = stretch tone. |
| D4 | P3 | Job detail | Risks: a red icon over amber bullets. | One tone. |
| R1 | P1 | Resume review | On a phone the 816px page is scaled to ~45% (≈5px text). The screen exists to read every bullet, so that means pinch-zooming per bullet, and bullet tap targets fall to ~8px (2.5.8 needs 24px). | Phones get a **Read** view (bullets reflowed at 15px, each a full-width tappable row) beside **Page preview**; print stays the page. |
| R2 | P2 | Resume review | "···" → "Tailor again" only opens the job, the same as "Open the job". | Open the tailor-again confirm, or remove it. |
| R3 | P3 | Resume | Status words vary: "Draft — review it" / "DRAFT" / "Resume ready to review"; "Approved" / "APPROVED". | One vocabulary and case. |
| E1 | P2 | Evidence | "Add skill" is black while every other primary action is green (see G11, G7). | Accent fill, offset from the bottom stack. |
| S1 | P3 | Sources | "Healthy" lists paused sources too. | "Watching" and "Paused" groups. |
| S2 | P3 | Sources | Gmail result banner adds a top margin at the card's top edge when connected. | Margin only below the header. |
| A1 | P3 | Sign in | Field heights differ in one form: Name 48px, Email and Password 52px. | One height. |
| A2 | P2 | Register | Password rules appear only after a failed submit. | Hint under the field before typing. |
| P1 | P3 | Profile | Notification devices are listed as raw user-agent strings. | "Chrome on Android" style names. |

**Screenshot pass (2026-10-14).** What the screenshots changed:
- **Confirmed on screen:**
  - G1, G8 (a desktop sheet has no close button), G12 (also "worker" wording on the
    unscored-job card and the Jobs warning);
  - N1, N2, D2 (grey description scrolling inside its card), R3, S1 (paused Initech under
    "Healthy"), A1, A2;
  - **N3 reproduced:** a new account on step 3 tapping "Set up on Sources" lands on
    "Step 1 of 3";
  - **R1:** resume text renders at about 6px on a phone, and a bullet's tap target is about
    8px tall;
  - **G7:** the toast overlaps the top of the job action bar, and the "Add skill" button
    covers the last skill group's count and chevron even with no toast showing.
- **Adjusted:**
  - G4: the off switch is readable on white; input borders and the status sheet's radio
    circles are what fade out.
  - J1 → P3: the four segments fit at 390px with one-digit counts; they truncate only with
    two-digit counts or the extra "All" segment.
  - J3 → P3: the dashed unscored ring is faint but visible.

New findings:

| ID | Sev | Screen | Problem | Fix |
|---|---|---|---|---|
| N5 | P2 | Onboarding | The main tab bar (with the Evidence badge) shows during onboarding, so a user can wander out mid-flow. Competing primaries: step 3 has two green buttons (Follow remote boards, Done); on step 1 the disabled Import is a large faded green button above a ghost "Next". | Hide the tab bar on `/welcome`; one primary per step. |
| J5 | P2 | Jobs | The verdict chip row is cut off ("Skip" clipped) on phones and in the desktop list column; the sideways scroll has no cue, and a mouse can't easily scroll it. | Wrap the chips on wide screens; a fade edge on phones. |
| J6 | P3 | Jobs | Folded weaker matches lose their day: today's SKIP jobs appear below the oldest day. The toggle reads "Hide  2  weaker matches" (double gaps). | Fold per day, or label the group "Weaker matches, all days"; fix the spacing. |
| D5 | P3 | Job detail | "Alert summary" shows "Read more" even when the text is one line. | Show it only when the text is clamped. |
| D6 | P3 | Job detail | A bad job link shows the raw "Validation failed (uuid is expected)". | "This job doesn't exist or was removed." |
| R4 | P3 | Resume review | Bullet sheet "Edit evidence" opens the top of Evidence, not that item. On desktop the hint still says "Tap any bullet". | Link to the item (open its group and edit sheet); say "Click" on pointer devices. |
| S3 | P3 | Sources | An aggregator row reads "Remote OK · Remote OK" (its name is its provider). "Edit URL" in grey ghost style looks disabled. | Skip the provider when it equals the name; style "Edit URL" as a secondary button. |
| P2 | P3 | Profile | Rows truncate important sentences ("Add the VAPID keys to the server's settings t…"). | Let subtitles wrap to 2 lines; see G12 for the wording. |

**Fix order (when implemented):**
1. **Accessibility and broken flows:** G1–G4, G7, N3, R1, N5.
2. **System consistency:** type and radius tokens (G9, G10), the `Sheet` header (G8), selection style (G11), G5.
3. **Screen items:** the rest.

Each phase ends with the headless-browser pass at 390 / 768 / 1280px in light and dark.

**Phase 1 built (2026-10-14).** Each fix was checked against the Docker audit stack at
390px and 1280px, in light and dark.
- **Contrast tokens (G1, G2, G4):**
  - `accent-strong` (#047857 light, 5.5:1 under white text) fills every surface that carries
    text: primary buttons, the green swipe layer, the "Add skill" button. The brand
    `accent` stays for rings, switches, icons and progress bars, where 3:1 is enough, so
    the logo and app icon keep their green.
  - `subtle` darkened to #656d7f (4.6–5.2:1; dark #8590a3, 5.5:1).
  - `input-border` (#848d9e, 3.3:1; dark #667287, 3.7:1) edges every input, select and
    textarea (through `INPUT`), the status sheet's radio rings, the budget stepper and the
    off switch. Card borders stay the lighter `border`: they are decoration.
  - `on-danger` makes the Evidence tab badge's text dark in dark mode (white on #f87171 was
    2.8:1, now 7.1:1).
- **16px form fields (G3):** the sub-16px overrides on `INPUT` call sites are gone, and the
  paste-description textarea uses `INPUT`, so iOS Safari no longer zooms on focus.
- **Bottom stack (G7):** `useBottomInset()` (`lib/hooks/`) is a callback ref that publishes
  a fixed layer's height as `--bottom-bar` / `--bottom-pill` / `--bottom-toast` on `<html>`.
  - Layers count only while `position: fixed`, so the action bars that sit in the page flow
    on wide screens publish 0.
  - `bottomAbove(...)` gives the layers above their `bottom`: bar → tailoring pill → toast
    → Evidence's "Add skill". Without a bar it still clears the home indicator.
  - Measured rather than fixed numbers, because the bars differ in height (the resume's
    Approve bar carries a line of help text) and change with the safe area.
- **Onboarding (N3, N5):** "Set up on Sources" sets the onboarding-done flag before
  leaving, because the gate sent a user with nothing saved straight back to step 1; checked
  with a fresh account, which now lands on Sources. The tab bar is hidden on `/welcome`, and
  "Follow remote boards" is tinted so "Done" is the step's one primary action.
- **Resume review on phones (R1):** a **Read | Page** switch, Read by default.
  - Read (`ResumeReadView`) reflows the same content at 15px, each bullet a full-width
    44px+ row that opens its evidence sheet.
  - Page is the scaled document as before; wider screens always show the page.
  - The document stays mounted (hidden on phones in Read) and `print:block`, so printing is
    unchanged whichever view is showing. A PDF printed from the phone's Read view was
    checked: one Letter page, the CV layout, no Read-view content.

