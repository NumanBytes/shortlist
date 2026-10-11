import { getJson, postJson } from '../http.js';
import { htmlToText, joinParts, toDate } from '../text.js';
import { mapPostings } from '../postings.js';
import type { Adapter, Posting, WorkMode } from '../types.js';

// Workable's public careers-page API (what apply.workable.com itself calls).
// v3 lists jobs without descriptions; v2 returns one job's description.
interface WorkableListing {
  shortcode: string;
  title: string;
  remote?: boolean;
  workplace?: string;
  published?: string;
  location?: { city?: string; region?: string; country?: string; countryCode?: string };
}
interface WorkableDetail {
  description?: string;
  requirements?: string;
  benefits?: string;
}

const WORKPLACE: Record<string, WorkMode> = { remote: 'REMOTE', hybrid: 'HYBRID', on_site: 'ONSITE' };
const MAX_PAGES = 5;

export const workable: Adapter<{ provider: 'workable'; account: string }> = async ({ account }, ctx) => {
  const acct = encodeURIComponent(account);
  const listings: WorkableListing[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await postJson<{ results: WorkableListing[]; nextPage?: string }>(
      `https://apply.workable.com/api/v3/accounts/${acct}/jobs`,
      { query: '', location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) },
    );
    listings.push(...res.results);
    token = res.nextPage;
    if (!token) break;
  }

  return mapPostings(listings, ctx, (j): Posting => ({
    externalId: j.shortcode,
    title: j.title.trim(),
    company: ctx.sourceName,
    location: joinParts(j.location?.city, j.location?.region, j.location?.country),
    workMode: WORKPLACE[j.workplace ?? ''] ?? (j.remote ? 'REMOTE' : null),
    url: `https://apply.workable.com/${acct}/j/${j.shortcode}/`,
    postedAt: toDate(j.published),
    description: null,
    loadDescription: async () => {
      const d = await getJson<WorkableDetail>(`https://apply.workable.com/api/v2/accounts/${acct}/jobs/${j.shortcode}`);
      return [d.description, d.requirements, d.benefits].filter(Boolean).map((h) => htmlToText(h!)).join('\n\n');
    },
  }));
};
