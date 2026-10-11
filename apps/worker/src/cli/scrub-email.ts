// Development helper: turn a captured (private) alert email into a fixture safe to commit.
//   pnpm --filter @shortlist/worker scrub:email <in.eml> <out.eml> "<your name>" <your@email>
//
// The output is a simplified email (text + HTML parts, UTF-8, no transfer encoding) with:
// - your name and address replaced by "Test User" / test.user@example.com;
// - every link stripped to scheme + host + path, keeping only the public job id (Indeed's
//   `jk`); click-tracking paths (personal tokens) replaced by placeholders;
// - routing, DKIM and tracking headers dropped.
// Always read the result before committing it (docs/email-alerts.md §10.4).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseMail } from '../email/mime.js';

const [input, output, name, address] = process.argv.slice(2);
if (!input || !output || !name || !address) {
  console.error('Usage: scrub:email <in.eml> <out.eml> "<your name>" <your@email>');
  process.exit(1);
}

const KEEP_PARAMS = new Set(['jk']);
let placeholder = 0;
const seen = new Map<string, string>();

function scrubUrl(raw: string): string {
  if (seen.has(raw)) return seen.get(raw)!;
  let out: string;
  try {
    const u = new URL(raw.replace(/&amp;/g, '&'));
    const opaque =
      u.pathname.includes('~~') ||
      /^(engage|cts|clk|click|email|links?|t)\./i.test(u.hostname) ||
      /[0-9a-f]{16,}|[A-Za-z0-9_-]{32,}/i.test(u.pathname);
    const params = [...u.searchParams].filter(([k]) => KEEP_PARAMS.has(k));
    out = `${u.origin}${opaque ? `/redacted/${++placeholder}` : u.pathname}${params.length ? `?${new URLSearchParams(params)}` : ''}`;
  } catch {
    out = `https://example.com/redacted/${++placeholder}`;
  }
  seen.set(raw, out);
  return out;
}

const names = name.split(/\s+/).filter((n) => n.length > 2);
function scrubText(s: string): string {
  let r = s.replace(/https?:\/\/[^\s"'<>)]+/g, (u) => scrubUrl(u));
  r = r.replace(new RegExp(address!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'test.user@example.com');
  for (const n of names) r = r.replace(new RegExp(`\\b${n}\\b`, 'gi'), 'Test');
  return r;
}

const mail = parseMail(readFileSync(input));
const boundary = 'shortlist-fixture';
const parts = [
  mail.text !== null && `Content-Type: text/plain; charset="UTF-8"\n\n${scrubText(mail.text)}`,
  mail.html !== null && `Content-Type: text/html; charset="UTF-8"\n\n${scrubText(mail.html)}`,
].filter(Boolean);
const eml = [
  `From: ${scrubText(mail.from ?? '')}`,
  `To: Test User <test.user@example.com>`,
  `Subject: ${scrubText(mail.subject)}`,
  `Date: ${mail.date?.toUTCString() ?? ''}`,
  'MIME-Version: 1.0',
  `Content-Type: multipart/alternative; boundary="${boundary}"`,
  '',
  ...parts.map((p) => `--${boundary}\n${p}\n`),
  `--${boundary}--`,
  '',
].join('\n');
writeFileSync(output!, eml);
console.log(`Wrote ${output} (${eml.length} bytes, ${placeholder} links redacted). Read it before committing.`);
