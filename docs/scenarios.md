# Real-world scenarios

How Shortlist behaves in the situations it was designed around.

> Part of the Shortlist docs. Start with [Agents.md](../Agents.md): the product rules and a
> map of every file. Section numbers are shared across files.

## 3. Real-world scenarios — how Shortlist behaves

The principle behind every answer: **Shortlist prepares, the user submits** ([§1.2](../Agents.md)).
Every automated flow ends the same way — a notification "Resume ready for X", the user
reviews it in the app, applies on the original site, and taps "I applied."

**3.1 A LinkedIn feed post by an HR person, with an email or an application link.**
Shortlist can't see the LinkedIn feed (no API, scraping is forbidden, and feed posts
don't trigger alert emails). The user brings it in with **Add a job** ([§11](discovery.md)) — paste the
text, or on Android share the post straight into Shortlist.
- If the post links to a supported job platform (e.g. a Workable link), Shortlist fetches
  the full job description from that platform's public API.
- If the post says "send your CV to hr@…", Shortlist produces the tailored PDF **and a
  drafted email** (subject, short body, PDF attached). One tap opens it in the user's own
  mail app; the user presses Send. Shortlist never sends it.

**3.2 LinkedIn jobs: "Easy Apply" versus "Apply" (company site).**
These arrive as LinkedIn job-alert emails ([§10](email-alerts.md)), which usually carry title, company,
location and a link — not the full description — so the job is marked **partial info**.
- *External "Apply":* if the same job is also on the company's own board (watched by
  Shortlist), the full description is filled in automatically from there ([§10.5](email-alerts.md)).
- *Easy Apply:* automating it is exactly what LinkedIn bans, so Shortlist never touches
  it. It provides the **application kit**: the tailored PDF plus drafted answers to
  common screening questions (e.g. "Years of React experience?" — computed from verified
  role dates). The user clicks Easy Apply, uploads the PDF, pastes answers, submits.

**3.3 A relevant job on Indeed, Glassdoor, Taraki or a similar portal.**
Their alert emails land in the user's Gmail and are picked up from the `Shortlist`
label ([§10](email-alerts.md)). Shortlist will not fetch the portal page behind the link (scraping). The
job gets a rough score from the alert alone; if the user marks it **Interested**, a
**"Paste full description"** action lets them copy the description in once (~10
seconds), which unlocks a full score and tailoring. The user uploads the resume on the
portal themselves.

**3.4 A job on a company's own website.**
For companies on a supported platform (Greenhouse, Lever, SmartRecruiters, Workable
today; hosted ATS pages and custom sites later — [§9.2](discovery.md)), this is fully automatic:
discovered nightly → requirements extracted → scored against verified evidence → if the
score clears the threshold, a resume is tailored (or reused from the library, [§13.2](resume.md)) in
the user's CV layout, every bullet linked to the evidence behind it → PDF rendered →
**push notification** "Resume ready: Full Stack Engineer @ Kwanso — review and submit."
In the app the user sees the resume, the evidence behind each bullet, and the gaps;
approves; downloads; applies on the company site; taps **I applied**. Shortlist never
submits.

**3.5 The same job arrives from several places** (LinkedIn alert + company board +
Rozee). Deduplicated into one job by a hash of normalized company + title ([§9.7](discovery.md)). The
richest description wins; later, the card shows where else it was seen.

**3.6 Many alerts for the same job.** Repeated alerts collapse into the same job (same
hash) — the description is pasted at most once per job, and only for jobs the user
marks Interested ([§10.5](email-alerts.md)).

**3.7 The job needs a skill the user doesn't have** (e.g. AWS). Shown as a gap, rated
blocking or learnable. Tailoring **never** adds it to the resume. An outreach draft may
honestly say the user is learning it. This is the Azure safeguard in action.

**3.8 Screening questions or a cover letter are required.** Drafted from verified
evidence only; any "years of experience" figure is computed from verified role dates,
never estimated.

**3.9 The posting has closed.** Every run updates `Job.lastSeenAt`; a job no longer
listed is marked "possibly closed" and is not tailored (no AI spend on dead postings).

**3.10 A reposted job the user already applied to.** Deduplication matches it; the card
shows "You applied on <date>."

**3.11 A scam posting** (asks for a fee, recruiter only on WhatsApp/Telegram, unrealistic
salary, "HR" using a personal Gmail). The AI extraction step looks for these red flags
and marks the job *suspected scam*. Especially relevant to WhatsApp-sourced jobs.

**3.12 A recruiter messages the user directly with a description.** Add a job ([§11](discovery.md)):
paste it → scored → resume tailored → reply drafted.

**3.13 Several roles at one company.** Grouped by company so the user picks the best fit
rather than applying to all (recruiters notice mass-applying).

**3.14 Applied a week ago, no response.** A follow-up reminder with a drafted, polite
follow-up message.

**3.15 Rejection or interview emails arrive in the same inbox.** Later: since Shortlist
reads the user's alert label, it could *suggest* status changes ("Looks like Kwanso
replied — mark Interviewing?"). It suggests; it never changes status on its own.

**3.16 Applying from the phone.** The tailored PDF downloads to the phone's files, ready
to upload (the LinkedIn app's Easy Apply accepts uploads).

**3.17 A job posted in a WhatsApp group.** Add a job ([§11](discovery.md)); on Android, long-press the
message → Share → Shortlist. Scam heuristics apply (3.11).

**3.18 A job description close to one already applied for** (different title, same
requirements). The resume library reuses the existing, already-reviewed resume at zero
AI cost instead of generating a new one ([§13.2](resume.md)).
