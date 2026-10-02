import type { DiscoveryPreferencesInput } from '@shortlist/shared';
import type { Posting } from './types.js';

// The cheap rule filter (Agents.md §5): plain code, no model calls. It exists to turn
// hundreds of raw postings into the few worth spending AI money on, so it errs on the
// side of dropping — every rejection carries a reason, for tuning.

export type Verdict = { pass: true } | { pass: false; reason: string };
const PASS: Verdict = { pass: true };
const reject = (reason: string): Verdict => ({ pass: false, reason });

// Whole-word, case-insensitive: "react" matches "React.js developer" but not
// "reactive"; "next.js" and "c++" work because we match on non-alphanumeric boundaries
// rather than \b. Returns the first term found, or undefined.
export function termMatcher(terms: readonly string[]): (text: string) => string | undefined {
  if (terms.length === 0) return () => undefined;
  const escaped = terms.map((t) => t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![a-z0-9])(${escaped.join('|')})(?![a-z0-9])`, 'i');
  return (text) => re.exec(text)?.[1]?.toLowerCase();
}

export interface ScreenOptions {
  // Posting age only means something on aggregators, where stale listings linger. On a
  // company's own board a listed job IS open — companies take closed roles down — and
  // long-running openings often carry a months-old publish date. (Found in the first
  // live run: all 10 of Septem's postings, incl. a MERN role, were dropped for age.)
  enforceMaxAge: boolean;
  now?: Date;
}

export interface CompiledFilter {
  screenListing(p: Posting, options: ScreenOptions): Verdict;
  screenDescription(p: Posting, description: string): Verdict;
}

export function compileFilter(prefs: DiscoveryPreferencesInput): CompiledFilter {
  const titleIn = termMatcher(prefs.titleInclude);
  const titleOut = termMatcher(prefs.titleExclude);
  const stack = termMatcher(prefs.stackKeywords);
  const onsite = termMatcher(prefs.onsiteLocations);
  const allowed = new Set(prefs.remoteAllowRegions.map((r) => r.toLowerCase()));
  const WORLDWIDE = /\b(worldwide|anywhere|global(ly)?|international)\b/i;
  const maxAgeMs = prefs.maxPostingAgeDays * 24 * 60 * 60 * 1000;

  return {
    // Stage A — only what's in the listing itself (no extra requests).
    screenListing(p, { enforceMaxAge, now = new Date() }) {
      if (enforceMaxAge && p.postedAt && now.getTime() - p.postedAt.getTime() > maxAgeMs) {
        return reject(`older than ${prefs.maxPostingAgeDays} days`);
      }
      if (!titleIn(p.title)) return reject('title: not a role we target');
      const excluded = titleOut(p.title);
      if (excluded) return reject(`title: excluded term "${excluded}"`);

      const location = p.location ?? '';
      // In an allowed place (Lahore/Pakistan) — on-site, hybrid, or remote, all fine.
      if (onsite(location)) return PASS;

      const remote = p.workMode === 'REMOTE' || /(?<![a-z])remote(?![a-z])/i.test(location);
      if (remote) {
        if (!prefs.allowRemote) return reject('remote roles disabled');
        if (!location || WORLDWIDE.test(location)) return PASS;
        // Every named part must be an allowed region ("Remote - LATAM" → "latam" isn't).
        const parts = location
          .toLowerCase()
          .split(/\s*(?:[,;/|()]|\s-\s|\s–\s)\s*/)
          .map((x) => x.trim())
          .filter(Boolean);
        const outside = parts.find((part) => !allowed.has(part));
        return outside ? reject(`remote, but limited to "${outside}"`) : PASS;
      }
      // No location at all (common on single-company boards): give it the benefit of
      // the doubt; the AI step reads the full description anyway.
      if (!location && p.workMode === null) return PASS;
      return reject(`location: "${location || p.workMode}" is not an allowed place`);
    },

    // Stage B — needs the description, which may have cost a request to fetch.
    screenDescription(p, description) {
      return stack(`${p.title}\n${description}`) ? PASS : reject('no core-stack keyword in title or description');
    },
  };
}
