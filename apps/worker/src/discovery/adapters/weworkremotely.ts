import { XMLParser } from 'fast-xml-parser';
import { getText } from '../http.js';
import { htmlToText, toDate } from '../text.js';
import { mapPostings } from '../postings.js';
import type { Adapter, Posting } from '../types.js';

// Category RSS feeds, e.g. https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss
// Item titles are "Company: Job title".
interface WwrItem {
  title?: string;
  link?: string;
  guid?: string | { '#text'?: string };
  pubDate?: string;
  region?: string;
  description?: string;
}

const parser = new XMLParser({ ignoreAttributes: true, processEntities: false });

export const weworkremotely: Adapter<{ provider: 'weworkremotely'; category: string }> = async ({ category }, ctx) => {
  const xml = await getText(`https://weworkremotely.com/categories/${encodeURIComponent(category)}.rss`);
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: WwrItem | WwrItem[] } } };
  const raw = doc.rss?.channel?.item;
  const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

  return mapPostings(
    items.filter((i) => i.title && i.link),
    ctx,
    (i): Posting => {
      const title = htmlToText(String(i.title));
      const split = title.indexOf(': ');
      const guid = typeof i.guid === 'object' ? i.guid['#text'] : i.guid;
      return {
        externalId: guid || i.link!,
        company: split > 0 ? title.slice(0, split).trim() : 'Unknown',
        title: split > 0 ? title.slice(split + 2).trim() : title,
        location: i.region ? htmlToText(String(i.region)) : null,
        workMode: 'REMOTE',
        url: i.link!,
        postedAt: toDate(i.pubDate),
        description: htmlToText(String(i.description ?? '')),
      };
    },
  );
};
