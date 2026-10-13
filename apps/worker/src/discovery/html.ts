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

// "@type" may be a string or a list ("JobPosting" or ["JobPosting", …]), and nodes may sit in
// an array or under "@graph" — all forms schema.org allows and sites use.
const isJobPosting = (node: unknown): node is JsonLdJobPosting => {
  const type = node && typeof node === 'object' ? (node as { '@type'?: unknown })['@type'] : undefined;
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
};

function* nodes(data: unknown): Generator<unknown> {
  if (Array.isArray(data)) for (const d of data) yield* nodes(d);
  else if (data && typeof data === 'object') {
    yield data;
    const graph = (data as { '@graph'?: unknown })['@graph'];
    if (graph) yield* nodes(graph);
  }
}

export function jsonLdJobPosting(html: string): JsonLdJobPosting | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue; // one malformed block doesn't hide the next
    }
    for (const node of nodes(data)) if (isJobPosting(node)) return node;
  }
  return null;
}

// The plain text of an embedded posting's description, or null when the page has none.
// htmlToText decodes entities itself (and un-escapes markup only when the whole value is
// escaped); decoding here first turned escaped text like "&lt;canvas&gt;" into a tag that was
// then stripped (code review 2026-10-13).
export function jsonLdDescription(html: string): string | null {
  const desc = jsonLdJobPosting(html)?.description;
  return desc ? htmlToText(desc) : null;
}

// For adapters whose only description source is the JobPosting data: a page without it fails
// that posting's description fetch (counted and logged by the pipeline) instead of quietly
// giving '' — which stage B would report as "no core-stack keyword", hiding the breakage.
export function requireJsonLdDescription(html: string, url: string): string {
  const text = jsonLdDescription(html);
  if (text === null) throw new Error(`No JobPosting data on ${url} — has the page changed?`);
  return text;
}

// The visible text inside a tag's HTML, entities decoded, whitespace collapsed.
export const inlineText = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
