import { getText } from '../http.js';
import { inlineText, jsonLdDescription } from '../html.js';
import { mapPostings } from '../postings.js';
import type { Adapter, Posting } from '../types.js';

// Simplicant job boards (<company>.simplicant.com) — server-rendered HTML: one link per
// opening (/jobs/<id>-<slug>/detail) with its title and location, repeated under "Featured"
// and its department; each job page embeds a schema.org JobPosting (docs/discovery.md §9.3).
const JOB =
  /<a[^>]+href="((?:https?:)?\/\/[a-z0-9-]+\.simplicant\.com\/jobs\/(\d+)-[^"]*\/detail)"[^>]*>([\s\S]*?)<\/a>/gi;

export const simplicant: Adapter<{ provider: 'simplicant'; url: string }> = async ({ url }, ctx) => {
  const page = await getText(url);
  const seen = new Set<string>();
  const jobs = [...page.matchAll(JOB)].flatMap((m) => {
    const [, href, id, inner] = m as unknown as [string, string, string, string];
    if (seen.has(id)) return [];
    seen.add(id);
    const title = /job-title[^>]*>([\s\S]*?)<\//.exec(inner)?.[1];
    const location = /job-subtitle[^>]*>([\s\S]*?)<\//.exec(inner)?.[1];
    return [
      {
        id,
        url: new URL(href, url).toString(),
        title: title ? inlineText(title) : '',
        location: location ? inlineText(location) || null : null,
      },
    ];
  });

  return mapPostings(jobs, ctx, (j): Posting => ({
    externalId: j.id,
    title: j.title,
    company: ctx.sourceName,
    location: j.location,
    workMode: /\bremote\b/i.test(j.location ?? '') ? 'REMOTE' : null,
    url: j.url,
    postedAt: null,
    description: null,
    loadDescription: async () => jsonLdDescription(await getText(j.url)) ?? '',
  }));
};
