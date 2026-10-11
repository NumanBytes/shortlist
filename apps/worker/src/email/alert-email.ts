import { senderAddress } from '@shortlist/shared/node';
import { decodeEntities, htmlToText } from '../discovery/text.js';
import type { WorkMode } from '../discovery/types.js';
import { parseMail } from './mime.js';

// One labelled email as the parsers see it. Built in memory and discarded — never stored.
export interface AlertEmail {
  sender: string | null;
  subject: string;
  receivedAt: Date;
  text: string; // the text/plain part, or the HTML converted to text
  links: EmailLink[]; // every distinct http(s) link, in order of appearance
}

export interface EmailLink {
  url: string;
  text: string; // the anchor's visible text, or the line before a bare URL
}

// One job read out of an alert.
export interface EmailPosting {
  title: string;
  company: string;
  location: string | null;
  workMode: WorkMode | null;
  url: string; // the posting (or the portal's own link to it) — "Open posting" goes here
  externalId: string | null; // the portal's job id when the link has one (Indeed's jk)
  salary: string | null;
  snippet: string | null; // the alert's one-line summary, if it has one
  postedAt: Date | null;
}

export type ParseResult = { kind: 'jobs'; postings: EmailPosting[] } | { kind: 'not_alert'; reason: string };

// A code parser for one portal's alerts (docs/email-alerts.md §10.4). Optional: any sender without one
// is read by the model fallback, so a parser exists only where volume justifies it.
export interface EmailParser {
  portal: string; // matches portalFor(): "indeed"
  matches(sender: string): boolean;
  parse(email: AlertEmail): ParseResult;
}

const MAX_LINKS = 150;

export function toAlertEmail(raw: Buffer, fallbackReceivedAt: Date): AlertEmail {
  const mail = parseMail(raw);
  const text = mail.text?.trim() || (mail.html ? htmlToText(mail.html) : '');
  return {
    sender: senderAddress(mail.from),
    subject: mail.subject,
    receivedAt: fallbackReceivedAt,
    text,
    links: mail.html ? htmlLinks(mail.html) : textLinks(text),
  };
}

export function htmlLinks(html: string): EmailLink[] {
  const links = new Map<string, EmailLink>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = decodeEntities(m[2]!.trim());
    if (!/^https?:\/\//i.test(url)) continue;
    const text = htmlToText(m[3]!).replace(/\s+/g, ' ').trim();
    const existing = links.get(url);
    if (!existing) links.set(url, { url, text });
    else if (!existing.text && text) existing.text = text;
    if (links.size >= MAX_LINKS) break;
  }
  return [...links.values()];
}

export function textLinks(text: string): EmailLink[] {
  const links = new Map<string, EmailLink>();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/https?:\/\/[^\s<>"]+/g)) {
      if (!links.has(m[0]))
        links.set(m[0], { url: m[0], text: line.replace(m[0], '').trim() || (lines[i - 1] ?? '').trim() });
    }
  });
  return [...links.values()].slice(0, MAX_LINKS);
}

// Which source a sender's jobs are credited to: a known portal, or the sender's domain.
const PORTALS: Record<string, { portal: string; label: string }> = {
  'indeed.com': { portal: 'indeed', label: 'Indeed' },
  'linkedin.com': { portal: 'linkedin', label: 'LinkedIn' },
  'rozee.pk': { portal: 'rozee-pk', label: 'Rozee.pk' }, // ids match the seeded email_alerts:<slug> rows
  'wellfound.com': { portal: 'wellfound', label: 'Wellfound' },
  'angel.co': { portal: 'wellfound', label: 'Wellfound' },
  'arc.dev': { portal: 'arc', label: 'Arc.dev' },
  'welcometothejungle.com': { portal: 'wttj', label: 'Welcome to the Jungle' },
  'otta.com': { portal: 'wttj', label: 'Welcome to the Jungle' },
  'glassdoor.com': { portal: 'glassdoor', label: 'Glassdoor' },
  'mustakbil.com': { portal: 'mustakbil', label: 'Mustakbil' },
  'remote.co': { portal: 'remote-co', label: 'remote.co' },
};

// "donotreply@jobalert.indeed.com" → indeed.com; "x@mail.rozee.pk" → rozee.pk.
export function senderDomain(sender: string | null): string | null {
  const host = sender?.split('@')[1]?.toLowerCase();
  if (!host) return null;
  const labels = host.split('.');
  // Two-label public suffixes (com.pk, co.uk, …) keep one more label.
  const keep =
    labels.length >= 3 && /^(com|co|org|net|gov|edu|ac)$/.test(labels.at(-2)!) && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export function portalFor(sender: string | null): { portal: string; label: string } {
  const domain = senderDomain(sender);
  if (!domain) return { portal: 'unknown', label: 'Unknown sender' };
  return PORTALS[domain] ?? { portal: domain, label: domain };
}

// "Remote" / "Hybrid work in Lahore" / "Lahore" → work mode, when the text says so.
export function workModeOf(location: string | null): WorkMode | null {
  if (!location) return null;
  if (/\bhybrid\b/i.test(location)) return 'HYBRID';
  if (/\bremote\b/i.test(location)) return 'REMOTE';
  return null;
}
