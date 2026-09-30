import { getJson } from '../http.js';
import { htmlToText, joinParts, toDate } from '../text.js';
import type { Adapter, Posting, WorkMode } from '../types.js';

// Public Postings API — https://github.com/lever/postings-api
interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[] };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
}

const WORKPLACE: Record<string, WorkMode> = { remote: 'REMOTE', hybrid: 'HYBRID', onsite: 'ONSITE', 'on-site': 'ONSITE' };

export const lever: Adapter<{ provider: 'lever'; site: string }> = async ({ site }, ctx) => {
  const postings = await getJson<LeverPosting[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`,
  );
  return postings.map((p): Posting => {
    const places = p.categories?.allLocations?.length ? p.categories.allLocations.join(' / ') : p.categories?.location;
    return {
      externalId: p.id,
      title: p.text.trim(),
      company: ctx.sourceName,
      location: joinParts(places, p.country),
      workMode: WORKPLACE[p.workplaceType?.toLowerCase() ?? ''] ?? null,
      url: p.hostedUrl,
      postedAt: toDate(p.createdAt),
      description: [
        p.descriptionPlain ?? '',
        ...(p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
        p.additionalPlain ?? '',
      ]
        .filter(Boolean)
        .join('\n\n')
        .trim(),
    };
  });
};
