import type { AlertEmail, EmailParser, EmailPosting, ParseResult } from '../alert-email.js';
import { workModeOf } from '../alert-email.js';

// Indeed job alerts (donotreply@jobalert.indeed.com). Written against real alerts captured
// 2026-10-03 (Agents.md §10.4). Both the daily alert and the "your job alert is now active"
// confirmation list jobs in the same plain-text layout, one block per job:
//
//   Full Stack Developer                       ← title
//   WSL Consultants - Lahore                   ← "company - location"
//   From Rs 70,000 a month                     ← salary (optional)
//   Easily apply                               ← badge (optional)
//   WSL Consultants … is hiring an …           ← summary (optional)
//   Just posted                                ← age
//   https://pk.indeed.com/rc/clk/dl?jk=…       ← link: Indeed's job key in daily alerts,
//                                                 a click-tracking link in confirmations

const URL_LINE = /^https?:\/\/\S+$/;
const AGE = /^(just posted|today|active today|(\d+)\+? days? ago|active (\d+)\+? days? ago)$/i;
const SALARY = /(\bRs\.?\s?[\d,]|\bPKR\b|[$€£]\s?[\d,]|\ba (month|year|week|day)\b|\ban hour\b|per (month|annum|year|hour))/i;
const BADGE = /^(easily apply|urgently hiring|hiring multiple candidates|new|responsive employer)$/i;
const DAY_MS = 24 * 3600 * 1000;

export const indeedParser: EmailParser = {
  portal: 'indeed',
  matches: (sender) => /@jobalert\.indeed\.com$/i.test(sender),
  parse(email: AlertEmail): ParseResult {
    const postings: EmailPosting[] = [];
    for (const block of email.text.split(/\n\s*\n/)) {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const posting = parseBlock(lines, email.receivedAt);
      if (posting) postings.push(posting);
    }
    if (postings.length === 0 && /first daily job alert|when jobs become available/i.test(email.text)) {
      return { kind: 'not_alert', reason: 'alert confirmation with no jobs yet' };
    }
    return { kind: 'jobs', postings };
  },
};

function parseBlock(lines: string[], receivedAt: Date): EmailPosting | null {
  // A job block ends with its link and has at least a title and "company - location".
  if (lines.length < 3 || !URL_LINE.test(lines.at(-1)!)) return null;
  const [title, companyLine] = lines;
  const split = companyLine!.lastIndexOf(' - ');
  if (split <= 0 || /^https?:/i.test(title!)) return null;
  const company = companyLine!.slice(0, split).trim();
  const location = companyLine!.slice(split + 3).trim() || null;

  let salary: string | null = null;
  let age: string | null = null;
  const rest: string[] = [];
  for (const line of lines.slice(2, -1)) {
    if (!salary && SALARY.test(line) && line.length < 80) salary = line;
    else if (!age && AGE.test(line)) age = line;
    else if (!BADGE.test(line)) rest.push(line);
  }

  const link = lines.at(-1)!;
  const jk = /[?&]jk=([0-9a-f]{8,32})\b/i.exec(link)?.[1] ?? null;
  // With a job key, link to the posting itself, without the tracking parameters.
  const url = jk ? `${new URL(link).origin}/viewjob?jk=${jk}` : link;

  return {
    title: title!,
    company,
    location,
    workMode: workModeOf(location),
    url,
    externalId: jk,
    salary,
    snippet: rest.join(' ').replace(/\*/g, '').trim() || null,
    postedAt: age ? postedAtFrom(age, receivedAt) : null,
  };
}

function postedAtFrom(age: string, receivedAt: Date): Date {
  const m = AGE.exec(age);
  const days = Number(m?.[2] ?? m?.[3] ?? 0);
  return new Date(receivedAt.getTime() - days * DAY_MS);
}
