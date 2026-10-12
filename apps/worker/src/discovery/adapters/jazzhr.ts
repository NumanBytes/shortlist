import { getText } from '../http.js';
import { inlineText, jsonLdDescription } from '../html.js';
import { mapPostings } from '../postings.js';
import type { Adapter, Posting } from '../types.js';

// JazzHR hosted boards (<company>.applytojob.com/apply) — HTML only, no public API without
// the company's key. Boards use different templates (a list, or a custom table), but every
// opening links to /apply/<id>/<slug>, so the parser keys on those links rather than layout.
// Each job page embeds a schema.org JobPosting with the description and date (docs/discovery.md §9.3).
const JOB_LINK =
  /<a[^>]+href="(https:\/\/[a-z0-9-]+\.applytojob\.com\/apply\/([A-Za-z0-9]+)\/[^"#?]*)"[^>]*>([\s\S]*?)<\/a>/gi;
// Where the templates put a job's location, after its link.
const LOCATION = [/fa-map-marker['"]><\/i>([^<]+)</i, /resumator-job-location-column">([^<]+)</i];

export const jazzhr: Adapter<{ provider: 'jazzhr'; url: string }> = async ({ url }, ctx) => {
  const page = await getText(url);
  const links = [...page.matchAll(JOB_LINK)];
  const seen = new Set<string>();
  const items = links.flatMap((m, i) => {
    const [, href, id, inner] = m as unknown as [string, string, string, string];
    if (seen.has(id)) return []; // some templates link a job twice
    seen.add(id);
    // The location sits between this link and the next one.
    const after = page.slice(m.index! + m[0].length, links[i + 1]?.index ?? m.index! + m[0].length + 2000);
    const location = LOCATION.map((re) => re.exec(after)?.[1]).find(Boolean);
    return [{ href, id, title: inlineText(inner), location: location ? inlineText(location) : null }];
  });

  return mapPostings(items, ctx, (j): Posting => {
    const remote = /\bremote\b/i.test(j.location ?? '');
    return {
      externalId: j.id,
      title: j.title,
      company: ctx.sourceName,
      location: j.location,
      workMode: remote ? 'REMOTE' : null,
      url: j.href,
      postedAt: null, // only on the job page; a listed job on a company's own board is open (§9.6)
      description: null,
      loadDescription: async () => {
        const html = await getText(j.href);
        return jsonLdDescription(html) ?? '';
      },
    };
  });
};
