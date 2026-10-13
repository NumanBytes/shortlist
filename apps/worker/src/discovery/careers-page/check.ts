import { normalizeForQuote, type CareersPageExtraction } from '@shortlist/shared';
import { workModeOf } from '../../email/alert-email.js';
import { looksPublic } from '../public-url.js';
import type { WorkMode } from '../types.js';
import type { PageText } from './page.js';

// One opening as kept from a careers page: what the snapshot stores and postings are built from.
export interface Opening {
  title: string;
  location: string | null;
  workMode: WorkMode | null;
  url: string; // the job's own page, or the careers page when it has none
  details: string | null; // the page's own text about the job, when it has some
}

// The model READS the page; code decides what to keep (the same split as email alerts,
// docs/email-alerts.md §10.4). A title must be on the page as written; a link must be one of the
// page's own; details are kept only if they are a quote. Nothing here is invented.
export function checkOpenings(
  out: CareersPageExtraction,
  page: PageText,
  pageUrl: string,
): { openings: Opening[]; dropped: { title: string; reason: string }[] } {
  const haystack = normalizeForQuote(page.text.replace(/\s*\[L\d+\]/g, ''));
  const onPage = (s: string) => {
    const n = normalizeForQuote(s);
    return n.length > 0 && haystack.includes(n);
  };
  const openings: Opening[] = [];
  const dropped: { title: string; reason: string }[] = [];
  const seen = new Set<string>();
  if (!out.listsOpenings) return { openings, dropped };
  for (const j of out.jobs) {
    const title = j.title.trim();
    // A link must be one of the page's own, and public: a hostile page can't make a job's
    // Apply link (or its description fetch) point into the worker's network.
    const link = j.link ? page.links.get(j.link.trim()) : undefined;
    const url = link && looksPublic(link) ? link : pageUrl;
    const key = `${normalizeForQuote(title)}|${url}`;
    if (!onPage(title)) {
      dropped.push({ title, reason: 'title not on the page' });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const location = j.location?.trim() || null;
    openings.push({
      title,
      location,
      workMode: j.workMode === 'UNKNOWN' ? workModeOf(location) : j.workMode,
      url,
      details: j.details && onPage(j.details) ? j.details.trim() : null,
    });
  }
  return { openings, dropped };
}
