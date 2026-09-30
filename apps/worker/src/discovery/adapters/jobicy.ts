import { getJson } from '../http.js';
import { decodeEntities, htmlToText, toDate } from '../text.js';
import type { Adapter, Posting } from '../types.js';

// https://jobicy.com/jobs-rss-feed — terms: credit Jobicy with a direct link, and every
// apply button must go to the original job URL from the feed.
interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobGeo?: string;
  pubDate?: string;
  jobDescription?: string;
}

export const jobicy: Adapter<{ provider: 'jobicy'; tag?: string }> = async ({ tag }) => {
  const { jobs } = await getJson<{ jobs: JobicyJob[] }>(
    `https://jobicy.com/api/v2/remote-jobs?count=100${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`,
  );
  return jobs.map((j): Posting => ({
    externalId: String(j.id),
    title: decodeEntities(j.jobTitle).trim(),
    company: decodeEntities(j.companyName).trim(),
    location: j.jobGeo?.trim() || null,
    workMode: 'REMOTE',
    url: j.url,
    postedAt: toDate(j.pubDate),
    description: htmlToText(j.jobDescription ?? ''),
  }));
};
