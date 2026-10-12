import { decodeEntities, htmlToText } from './text.js';

// Helpers for platforms that publish job pages as HTML, not an API (docs/discovery.md §9.3,
// Milestone 2). Each adapter keeps its own selectors; these are the parts they share.

// The schema.org JobPosting a page embeds for search engines (Google for Jobs), when it has
// one: the description, the date posted and the place, without depending on page layout.
export interface JsonLdJobPosting {
  title?: string;
  description?: string; // HTML
  datePosted?: string;
  jobLocationType?: string; // "TELECOMMUTE" = remote
  jobLocation?: unknown;
}

export function jsonLdJobPosting(html: string): JsonLdJobPosting | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue; // one malformed block doesn't hide the next
    }
    for (const node of Array.isArray(data) ? data : [data]) {
      if (node && typeof node === 'object' && (node as { '@type'?: unknown })['@type'] === 'JobPosting')
        return node as JsonLdJobPosting;
    }
  }
  return null;
}

// The plain text of an embedded posting's description, or null when the page has none.
export function jsonLdDescription(html: string): string | null {
  const desc = jsonLdJobPosting(html)?.description;
  return desc ? htmlToText(decodeEntities(desc)) : null;
}

// The visible text inside a tag's HTML, entities decoded, whitespace collapsed.
export const inlineText = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
