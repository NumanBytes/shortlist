# AI analysis and scoring

Extracting requirements with a model and scoring them in code.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 12. AI pipeline — extraction and match scoring (built 2026-10-02)

### 12.1 The model reads; the code decides

**Decision:** Claude never produces the score. Haiku reads the posting and maps each
requirement to the user's verified skills; deterministic code
(`packages/shared/src/scoring.ts`) turns that mapping into the score, verdict, gaps,
strengths and risks. Rejected alternative: asking the model for a 0–100 score. Why:
- **Explainable** — every point traces to a requirement and a piece of evidence.
- **Deterministic** — the same inputs always give the same score; LLM scores drift.
- **Can't add skills** — the model may only point at skills from the list it is given
  (as short refs `S1…Sn`); unknown refs are dropped in code. The Azure safeguard is
  structural, not a prompt instruction.
- **Re-scoring is free** — when evidence changes, jobs are re-scored from the stored
  mapping with no model call.
- **Testable** — the scoring rules are plain unit-tested functions.

```
discovery stores NEW jobs ──► analysis queue: analyze-job (one per job)
nightly 03:00 Asia/Karachi ──► analysis-sweep: re-score DONE jobs (free), re-queue
                               PENDING/DEFERRED jobs up to what's left of the daily cap

analyze-job:
  1. budget guard (§12.3) — over budget/cap → DEFERRED (no call)
  2. no verified evidence → DEFERRED (no call)
  3. prompt: VERIFIED skills only (name + category, as refs) + the posting in
     <job_posting> tags, marked as untrusted data (prompt-injection hygiene)
  4. Haiku 4.5, structured output (hand-written JSON schema)
  5. log tokens + cost to AiUsage — always, even if the output is then rejected
  6. Zod-validate; drop unknown refs; score in code; store requirements/match/gaps → DONE
```

- **Every model answer is parsed the same way** (`parseModelOutput`, shared by analysis,
  tailoring and email extraction): did it finish, is it JSON, does it match the schema —
  a failure says where it failed.
- **The save is a compare-and-set on the text the model read (2026-10-11).** If the user
  pastes the full description while an analysis of the summary is running, the paste's
  own enqueue is folded into the running job by deduplication, and the run used to write
  DONE over the paste — leaving the job scored on the summary. Now the DONE write only
  applies if `rawJD` is unchanged; otherwise nothing is stored and the job is analysed
  again with the new text (both calls are billed, so both are logged).
- **Re-scoring loads the user's evidence once** per user, not once per job.

**What the model returns per requirement:** canonical skill name, importance
(REQUIRED / PREFERRED / BONUS), `isCore` (central to the role), years if stated,
`sameAs` (exact or direct-equivalent skills: React.js = React) and `relatedTo`
(transferable but **not** the same: PostgreSQL for MySQL, Express for NestJS). Plus the
posting's seniority, overall years, and red flags (scam signals). It is told not to
judge experience — only same / related / absent. Evidence text (`whatIDid`) is not sent.

**Exact names are decided in code:** after the model's mapping, a requirement whose
normalized name equals a verified skill's name (case, punctuation, a trailing ".js",
plural "s" — "Prompt Engineering" = "Prompt engineering", "React.js" = "React") is that
skill (`promoteExactNameMatches`). In the first real run the model filed the user's exact
"Prompt engineering" as merely *related*. Applied on analysis and on re-scoring.

**Alternatives are one requirement:** "AWS, GCP or Azure" becomes a single requirement
"AWS / GCP / Azure" (prompt rule). In the first real run Kwanso's five cloud options
became five separate gaps, pulling a fitting role below the SKIP line.

**Scoring rules** (`scoring.ts`):
- Evidence strength by context × depth: COMMERCIAL production 1.0, maintenance/working
  0.6, exposure 0.3; PERSONAL production 0.7, working 0.5; ACADEMIC ≤ 0.4. Stale (> 2
  years) evidence × 0.6, and stale EXPOSURE counts 0 ([§6.1](../Agents.md)).
- Requirement weight: REQUIRED 3, PREFERRED 1.5, BONUS 0.5; core × 1.5.
- A `sameAs` match earns its best evidence strength; a `relatedTo` match earns **half**
  and the requirement still appears as a gap ("related experience: …") — never claimed.
- `overallScore` = weighted satisfaction %; `commercialScore` counts COMMERCIAL evidence only.
- Gaps: missing core REQUIRED → BLOCKING (softened to MODERATE by related experience);
  missing REQUIRED → MODERATE; missing PREFERRED/BONUS → MINOR.
- Verdict: **SKIP** if score < 45, ≥ 2 blocking gaps, or no requirements; **APPLY** if
  score ≥ 70 with no blocking gap, no red flag, and the posting's years not more than
  2 above the user's commercial years; otherwise **STRETCH**.
- Commercial years are computed from role dates (overlaps not double-counted).

**Implementation choices:**
- **Hand-written JSON schema** for structured output: the SDK's Zod converter turned
  enums into descriptions (not enforced by the API). A test keeps it in sync with the
  Zod schema, which still validates every response before storage.
- **Errors by type:** 429/5xx/network → retried by the SDK (×2) and the queue (×3,
  backoff); 400/401/403/404 → FAILED, not retried; **out of credit → DEFERRED** (runs
  after a top-up); invalid/truncated (`max_tokens`)/refused output → FAILED, not retried
  (it would likely fail again and cost again).
- **Never billed twice concurrently:** every enqueue path (discovery, nightly sweep, API
  "Retry") uses BullMQ `deduplication` keyed by job ID, so while an analysis is waiting,
  in retry backoff or running, further adds join it. The BullMQ job ID still includes
  the batch, so a job deferred today can be queued again tomorrow. (Found in code review:
  the sweep and "Retry" could otherwise start a second billed call for the same job.)
- **Re-analysis only when it can change the answer:** each analysis records the
  verified skills the model saw (`Job.analyzedSkillIds`). The nightly sweep re-scores
  from the stored mapping when evidence is un-verified or edited (free), but when the
  user has *verified a new skill* the model never saw, the stored mapping can't contain
  it — the job goes back to PENDING for one fresh, budget-guarded analysis, its old
  score visible meanwhile. "Retry" on an analysed job is allowed only in that case
  (409 otherwise), so a click can't re-bill an unchanged analysis.
- **Discovery isn't failed by analysis plumbing:** if queuing new jobs for analysis
  fails, the discovery run still succeeds (retrying would re-fetch and find nothing
  "new"); the nightly sweep picks the jobs up.
- **Job IDs never contain ":"** — scheduler-fired batch IDs (`repeat:<id>:<millis>`) are
  sanitized; BullMQ tolerating exactly two colons is a quirk, not a contract.
- **Separate `analysis` queue** with concurrency 2 (`ANALYSIS_CONCURRENCY`), so model
  calls never compete with discovery and rate-limit pressure stays low.
- **No prompt caching:** Haiku 4.5 caches only prefixes ≥ 4,096 tokens; ours is ~2–3K,
  so a cache marker would do nothing. Revisit if the prompt grows or the model changes.
- **No Batch API yet:** at ~10 jobs/night it would save ~$1/month while adding a
  submit-and-poll state machine; manual "Add a job" needs immediate results anyway.
  Revisit if volume grows.

**First live call (2026-10-02):** Septem Systems' *Full Stack Software Engineer (MERN)*
on a test profile — mapped React/TS/JS/MongoDB/Express/Node exactly, NestJS → related
Express/Node, MySQL → related PostgreSQL; an unverified "Azure B2C" skill never reached
the model. 2,790 input + 667 output tokens = **$0.006**. Scored 42 (SKIP): personal-only
MERN counts at half strength, and generic PREFERRED items (Git, REST APIs, testing…)
were absent from the test profile. **Lesson: a score can only be as complete as the
user's verified evidence.** Weight calibration is an open decision ([§17.3](roadmap.md)), to be done
on the user's real scored jobs rather than one sample.

### 12.2 Budget (prices checked 2026-10-02 on the official pricing page)

| | Standard | Batch API (50% off) |
|---|---|---|
| Claude Haiku 4.5 — extraction, scoring | $1 in / $5 out per MTok | $0.50 / $2.50 |
| Claude Sonnet 5.5 — tailoring | $2 in / $10 out per MTok | $1 / $5 |
| Cache reads (the career database — identical every call) | 0.1× input price | stacks with batch |
| Web search (server tool) | $10 per 1,000 searches + result tokens | — |
| Web fetch (server tool) | tokens only | — |

**Estimate at real volume.** Live discovery stores ~25 jobs on a first run, and only
*new* jobs are scored after that (dedupe), so ~5–15 per night.
- Scoring: measured **~$0.006 per job** (≈ 2.8K input + 0.7K output tokens, no batch,
  no cache — §12.1) → at ~10 new jobs/night **≈ $1.80/month**.
- Tailoring: ~$0.015–0.03 per resume; with the resume library reusing approved variants,
  ~30 new resumes/month → **~$1/month**.
- Source discovery via API web search: ~$0.50 per monthly run (or $0 if done by hand in
  claude.ai).
- **Total ≈ $3–4/month.** The user's initial $5 of credits lasts a bit over a month at
  that rate; the budget guard (§12.3) caps it either way. (The original
  plan's ~$11/month assumed 30 jobs/day reaching AI; real deduplicated volume is far
  lower.)
- Infrastructure when deployed: free tiers for Neon, Upstash, Vercel; ~$5–7/month for an
  always-on worker host; domain ~$12/year.

### 12.3 Budget guard (built 2026-10-02)

So a bug or a sudden flood of "new" jobs can't drain the credits in one night:
1. **A monthly spend limit set in the Anthropic Console** (account-level hard stop) —
   set by the user.
2. **In the worker** (`BudgetGuard`), checked before every model call, from the
   `AiUsage` log (so it counts billed calls whose output was rejected, too):
   month-to-date spend vs `monthlyBudgetUsd` (default **$4.50**) and analyses in the
   last 24h vs `maxAnalysesPerDay` (default **40**). Over either → the job is
   **DEFERRED** with the reason shown on its card, and the nightly sweep retries it —
   never silently dropped. Settings are an `AiSettings` row per user (defaults in
   shared), editable on the Sources page; month-to-date spend is shown there
   (`GET /ai/usage`). With 2 parallel calls a burst can overshoot a cap by at most 2.

### 12.4 Claude Pro subscription versus the API (2026-10-02)

The user has a Claude Pro subscription. It is **not** used to power Shortlist: Pro covers
the user's own use of Claude (claude.ai, apps, Claude Code — used to *build* Shortlist),
while the worker's nightly calls need an API key billed from Console credits. Routing the
worker through the Pro login (e.g. scripting Claude Code as a backend) was rejected — it
isn't what the subscription is for, likely breaches its terms, and is fragile (usage
limits, interactive sessions). **Pro is used for:** development; manual source discovery
with web search ([§9.11](discovery.md)); prototyping the scoring/tailoring prompts on real job
descriptions before spending API credits; one-off career work (rewording evidence before
verifying, interview prep from gaps, special cover letters). Rule of thumb: anything
automated runs on the API; anything the user does by hand can use Pro.
