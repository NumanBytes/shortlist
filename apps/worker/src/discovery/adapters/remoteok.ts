import { getJson } from '../http.js';
import { htmlToText, toDate } from '../text.js';
import type { Adapter, Posting } from '../types.js';

// https://remoteok.com/api — terms: link back to the Remote OK URL and name Remote OK
// as the source (no logo). The first array element is the legal notice, not a job.
interface RemoteOkJob {
  id?: string;
  position?: string;
  company?: string;
  location?: string;
  url?: string;
  date?: string;
  description?: string;
  tags?: string[];
}

export const remoteok: Adapter<{ provider: 'remoteok' }> = async () => {
  const items = await getJson<RemoteOkJob[]>('https://remoteok.com/api');
  return items
    .filter((j): j is Required<Pick<RemoteOkJob, 'id' | 'position' | 'url'>> & RemoteOkJob => Boolean(j.id && j.position && j.url))
    .map((j): Posting => ({
      externalId: j.id,
      title: j.position.trim(),
      company: j.company?.trim() || 'Unknown',
      location: j.location?.trim() || null,
      workMode: 'REMOTE',
      url: j.url,
      postedAt: toDate(j.date),
      // Tags carry the stack ("react", "typescript") — keep them searchable.
      description: [htmlToText(j.description ?? ''), j.tags?.length ? `Tags: ${j.tags.join(', ')}` : '']
        .filter(Boolean)
        .join('\n\n'),
    }));
};
