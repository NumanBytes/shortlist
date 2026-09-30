import { createHash } from 'node:crypto';

// The same role often appears on the company's own board AND on an aggregator, with
// slightly different company/title spelling. Hashing a normalized company + title
// collapses those into one Job (unique on userId + dedupeHash).
//
// Location is deliberately left out: sources format it too differently ("Lahore, PK"
// vs "Pakistan" vs "Remote - APAC") to match reliably, and the same title at the same
// company in two cities is one decision for the user, not two.

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|pvt|private|plc|gmbh|corp|corporation|co|company|technologies|technology|tech)\b/g;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9+#]+/g, ' ') // keep c++ / c# distinct from c
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompany(s: string): string {
  return normalize(s).replace(COMPANY_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}

export function dedupeHash(company: string, title: string): string {
  return createHash('sha256').update(`${normalizeCompany(company)}|${normalize(title)}`).digest('hex');
}
