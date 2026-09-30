import { getJson } from '../http.js';
import { htmlToText, toDate } from '../text.js';
import type { Adapter, Posting } from '../types.js';

// https://remotive.com/api-documentation — terms: link back to the Remotive URL and
// name Remotive as the source; at most ~4 requests a day (we make one). Jobs are
// delayed 24h on the free API.
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  publication_date?: string;
  description?: string;
  tags?: string[];
}

export const remotive: Adapter<{ provider: 'remotive'; category: string }> = async ({ category }) => {
  const { jobs } = await getJson<{ jobs: RemotiveJob[] }>(
    `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(category)}`,
  );
  return jobs.map((j): Posting => ({
    externalId: String(j.id),
    title: j.title.trim(),
    company: j.company_name.trim(),
    location: j.candidate_required_location?.trim() || null,
    workMode: 'REMOTE',
    url: j.url,
    postedAt: toDate(j.publication_date),
    description: [htmlToText(j.description ?? ''), j.tags?.length ? `Tags: ${j.tags.join(', ')}` : '']
      .filter(Boolean)
      .join('\n\n'),
  }));
};
