import { z } from 'zod';
import {
  ImplementedSourceConfigSchema,
  isBoardProvider,
  parseBoardAddress,
  type ImplementedSourceConfig,
} from './job-source.schema.js';

// "Add a source" (docs/discovery.md §9.15): a company's jobs page becomes a JobSource row —
// data, not code. The user gives a name and a link; the link decides the provider: a
// Greenhouse/Lever/SmartRecruiters/Workable board gets its API adapter, a hosted page on
// JazzHR/Zoho/OpenCats/Simplicant gets its page adapter, and anything else is a company
// careers page for the change watcher (§9.14).

export const AddSourceSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the company a name').max(100),
    link: z.string().trim().min(1, "Paste the company's jobs page link").max(500),
  })
  .strict();
export type AddSourceInput = z.infer<typeof AddSourceSchema>;

export type SourceFromLink =
  | { ok: true; key: string; type: 'ATS_BOARD' | 'MANUAL'; config: ImplementedSourceConfig }
  | { ok: false; error: string };

const BOARDS = ['greenhouse', 'lever', 'smartrecruiters', 'workable'] as const;
const HOSTED = ['jazzhr', 'zohorecruit', 'opencats', 'simplicant'] as const;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// A cheap, DNS-free screen so an obviously internal address is refused when it's saved. The
// worker's check at fetch time (DNS included, every redirect) is the real guard against
// SSRF; this one just gives the user a clear answer up front.
function looksPublicHost(host: string): boolean {
  if (host.startsWith('[')) return false; // IPv6 literals: no reason for a jobs page to use one
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) return false;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!v4) return true;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b < 128) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 168)
  );
}

export function sourceFromLink(name: string, link: string): SourceFromLink {
  const raw = link.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That isn't a valid link" };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'Use an http(s) link' };
  if (!looksPublicHost(url.hostname)) return { ok: false, error: "That address isn't on the public internet" };
  const href = url.toString();

  for (const provider of BOARDS) {
    if (!isBoardProvider(provider)) continue;
    const parsed = parseBoardAddress(provider, href);
    if (parsed.ok) {
      const id = Object.values(parsed.config).find((v) => v !== provider) as string;
      return { ok: true, key: `${provider}:${slug(id)}`, type: 'ATS_BOARD', config: parsed.config };
    }
    // The host is this platform's but the link is wrong: say so instead of watching it as a page.
    if (parsed.error !== `That isn't a ${provider} board link`) return { ok: false, error: parsed.error };
  }
  for (const provider of HOSTED) {
    const parsed = ImplementedSourceConfigSchema.safeParse({ provider, url: href });
    if (parsed.success) return { ok: true, key: `${provider}:${slug(name)}`, type: 'ATS_BOARD', config: parsed.data };
  }
  return {
    ok: true,
    key: `careers_page:${slug(name)}`,
    type: 'MANUAL',
    config: { provider: 'careers_page', url: href },
  };
}
