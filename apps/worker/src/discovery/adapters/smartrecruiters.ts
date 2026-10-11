import { getJson } from '../http.js';
import { htmlToText, joinParts, toDate } from '../text.js';
import { mapPostings } from '../postings.js';
import type { Adapter, Posting } from '../types.js';

// Public Posting API — https://developers.smartrecruiters.com/docs/posting-api
// The list has no descriptions; each costs one request, made only for postings that
// pass the title/location screen (loadDescription).
interface SrListing {
  id: string;
  name: string;
  company?: { name?: string };
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean };
}
interface SrDetail {
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

const PAGE = 100;
const MAX_PAGES = 5;

export const smartrecruiters: Adapter<{ provider: 'smartrecruiters'; company: string }> = async ({ company }, ctx) => {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings`;
  const listings: SrListing[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await getJson<{ totalFound: number; content: SrListing[] }>(
      `${base}?limit=${PAGE}&offset=${page * PAGE}`,
    );
    listings.push(...res.content);
    if (listings.length >= res.totalFound || res.content.length === 0) break;
  }

  return mapPostings(listings, ctx, (l): Posting => ({
    externalId: l.id,
    title: l.name.trim(),
    company: l.company?.name?.trim() || ctx.sourceName,
    location: joinParts(l.location?.city, l.location?.region, l.location?.country),
    workMode: l.location?.remote ? 'REMOTE' : l.location?.hybrid ? 'HYBRID' : 'ONSITE',
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${l.id}`,
    postedAt: toDate(l.releasedDate),
    description: null,
    loadDescription: async () => {
      const detail = await getJson<SrDetail>(`${base}/${l.id}`);
      return Object.values(detail.jobAd?.sections ?? {})
        .filter((s) => s?.text)
        .map((s) => `${s!.title ?? ''}\n${htmlToText(s!.text!)}`.trim())
        .join('\n\n');
    },
  }));
};
