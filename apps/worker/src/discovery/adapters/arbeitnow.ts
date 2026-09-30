import { getJson } from '../http.js';
import { htmlToText, toDate } from '../text.js';
import type { Adapter, Posting } from '../types.js';

// https://www.arbeitnow.com/api/job-board-api — mostly Europe; remote=false jobs are
// on-site and will usually be dropped by the location filter.
interface ArbeitnowJob {
  slug: string;
  title: string;
  company_name: string;
  location?: string;
  remote?: boolean;
  url: string;
  created_at?: number;
  description?: string;
  tags?: string[];
}

export const arbeitnow: Adapter<{ provider: 'arbeitnow'; maxPages: number }> = async ({ maxPages }) => {
  const jobs: ArbeitnowJob[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await getJson<{ data: ArbeitnowJob[]; links?: { next?: string | null } }>(
      `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
    );
    jobs.push(...res.data);
    if (!res.links?.next) break;
  }
  return jobs.map((j): Posting => ({
    externalId: j.slug,
    title: j.title.trim(),
    company: j.company_name.trim(),
    location: j.location?.trim() || null,
    workMode: j.remote ? 'REMOTE' : 'ONSITE',
    url: j.url,
    postedAt: toDate(j.created_at),
    description: [htmlToText(j.description ?? ''), j.tags?.length ? `Tags: ${j.tags.join(', ')}` : '']
      .filter(Boolean)
      .join('\n\n'),
  }));
};
