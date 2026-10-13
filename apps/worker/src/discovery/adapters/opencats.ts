import { getText } from '../http.js';
import { inlineText } from '../html.js';
import { mapPostings } from '../postings.js';
import { decodeEntities, htmlToText } from '../text.js';
import type { Adapter, Posting } from '../types.js';

// OpenCATS careers pages (self-hosted: …/careers/index.php?m=careers&p=showAll). One table
// row per opening — a link to p=showJob and the location — and a details page whose
// description sits in #careerContent (docs/discovery.md §9.3). Installs name a job by
// ID=<n> (Intagleo) or job=<slug> (i2c).
const ROW = /<tr[^>]*>\s*<td>\s*<a href="([^"]*p=showJob[^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>/gi;

export function opencatsDescription(html: string): string {
  const start = html.indexOf('id="careerContent"');
  if (start < 0) return '';
  const end = html.indexOf('candidateRegistration', start);
  const body = html
    .slice(start, end < 0 ? undefined : end)
    // Some installs wrap part of the description in an HTML comment; keep the content.
    .replace(/<!--|-->/g, '');
  return htmlToText(body.slice(body.indexOf('>') + 1)).replace(/\s*Apply to Position\s*$/i, '');
}

export const opencats: Adapter<{ provider: 'opencats'; url: string }> = async ({ url }, ctx) => {
  const page = await getText(url);
  const rows = [...page.matchAll(ROW)].map((m) => {
    const link = new URL(decodeEntities(m[1]!), url);
    return {
      url: link.toString(),
      id: link.searchParams.get('ID') ?? link.searchParams.get('job') ?? '', // '' fails the posting check
      title: inlineText(m[2]!),
      location: inlineText(m[3]!) || null,
    };
  });

  return mapPostings(rows, ctx, (r): Posting => ({
    externalId: r.id,
    title: r.title,
    company: ctx.sourceName,
    location: r.location,
    workMode: /\bremote\b/i.test(r.location ?? '') ? 'REMOTE' : null,
    url: r.url,
    postedAt: null,
    description: null,
    loadDescription: async () => opencatsDescription(await getText(r.url)),
  }));
};
