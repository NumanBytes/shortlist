import { getJson } from '../http.js';
import { htmlToText, toDate } from '../text.js';
import type { Adapter, Posting } from '../types.js';

// Public Job Board API — https://developers.greenhouse.io/job-board.html
// ?content=true includes each description, so this is a single request per board.
interface GreenhouseJob {
  id: number;
  title: string;
  company_name?: string;
  absolute_url: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  content?: string;
}

export const greenhouse: Adapter<{ provider: 'greenhouse'; board: string }> = async ({ board }, ctx) => {
  const { jobs } = await getJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
  );
  return jobs.map((j): Posting => {
    const location = j.location?.name?.trim() || null;
    return {
      externalId: String(j.id),
      title: j.title.trim(),
      company: j.company_name?.trim() || ctx.sourceName,
      location,
      workMode: location && /\bremote\b/i.test(location) ? 'REMOTE' : null,
      url: j.absolute_url,
      postedAt: toDate(j.first_published ?? j.updated_at),
      description: htmlToText(j.content ?? ''),
    };
  });
};
