import { getJson } from '../http.js';
import { htmlToText, toDate } from '../text.js';
import { mapPostings } from '../postings.js';
import type { Adapter, Posting } from '../types.js';

// https://himalayas.app/api — cursor-paginated, newest first. We read the first
// maxPages pages (the nightly run only needs what's new).
interface HimalayasJob {
  guid: string;
  title: string;
  companyName: string;
  locationRestrictions?: string[];
  applicationLink: string;
  pubDate?: number;
  description?: string;
  categories?: string[];
}

const PAGE_SIZE = 20;

export const himalayas: Adapter<{ provider: 'himalayas'; maxPages: number }> = async ({ maxPages }, ctx) => {
  const jobs: HimalayasJob[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const url: string = `https://himalayas.app/jobs/api?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await getJson<{ jobs: HimalayasJob[]; nextCursor?: string | null }>(url);
    jobs.push(...res.jobs);
    cursor = res.nextCursor ?? null;
    if (!cursor) break;
  }
  return mapPostings(jobs, ctx, (j): Posting => ({
    externalId: j.guid,
    title: j.title.trim(),
    company: j.companyName.trim(),
    // No restrictions = hire from anywhere.
    location: j.locationRestrictions?.length ? j.locationRestrictions.join(', ') : 'Worldwide',
    workMode: 'REMOTE',
    url: j.applicationLink,
    postedAt: toDate(j.pubDate),
    description: [htmlToText(j.description ?? ''), j.categories?.length ? `Categories: ${j.categories.join(', ')}` : '']
      .filter(Boolean)
      .join('\n\n'),
  }));
};
