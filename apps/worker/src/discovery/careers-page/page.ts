import { createHash } from 'node:crypto';
import { htmlToText } from '../text.js';

// A careers page reduced to what matters (docs/discovery.md §9.14): its visible text, with each
// link shown as a short ref ("Senior Engineer [L3]") so the model can point at a job's own
// page without ever writing a URL. Menus, headers and footers are dropped: they are the same
// on every page and would only cost tokens and trigger false "changed" readings.
export interface PageText {
  text: string;
  links: Map<string, string>; // "L3" -> absolute http(s) URL
  truncated: boolean;
}

const MAX_TEXT = 24_000;

function stripChrome(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ');
}

export function pageText(html: string, pageUrl: string): PageText {
  const links = new Map<string, string>();
  const refOf = new Map<string, string>();
  const withRefs = stripChrome(html).replace(
    /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (whole, href: string, inner: string) => {
      let url: URL;
      try {
        url = new URL(href.replace(/&amp;/g, '&'), pageUrl);
      } catch {
        return inner;
      }
      if (!/^https?:$/.test(url.protocol)) return inner;
      url.hash = '';
      const key = url.toString();
      let ref = refOf.get(key);
      if (!ref) {
        ref = `L${links.size + 1}`;
        links.set(ref, key);
        refOf.set(key, ref);
      }
      return `${inner} [${ref}]`;
    },
  );
  const full = htmlToText(withRefs);
  const text = full.slice(0, MAX_TEXT);
  // A long page's links past the cut would only cost tokens: keep the refs the text shows.
  const shown = new Set(text.match(/\[L\d+\]/g)?.map((r) => r.slice(1, -1)));
  const kept = new Map([...links].filter(([ref]) => shown.has(ref)));
  return { text, links: kept, truncated: full.length > MAX_TEXT };
}

// The text of a job's own page, for its description: chrome removed, no link refs.
export function mainText(html: string): string {
  return htmlToText(stripChrome(html));
}

// What decides "the page changed": its text and links, minus phrases that change daily on
// their own ("Posted 10 months ago").
export function fingerprint(page: PageText): string {
  const stable = page.text
    .replace(/\b\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return createHash('sha256')
    .update(stable)
    .update('\n')
    .update([...page.links.values()].join('\n'))
    .digest('hex');
}
