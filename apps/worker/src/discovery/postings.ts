import { WebUrl } from '@shortlist/shared';
import { z } from 'zod';
import type { AdapterContext, Posting } from './types.js';

// What every posting must have before the pipeline trusts it. Sources are third-party
// JSON/RSS, typed only by our reading of their docs, so this is the validation boundary:
// one check for all adapters instead of a schema per response shape. The URL must be
// http(s) — it becomes the Apply link's href.
const PostingCheck = z.object({
  externalId: z.string().min(1),
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  url: WebUrl,
});

// Maps a source's items to postings one at a time. An item the mapping can't read (a
// missing field it calls .trim() on) or that fails PostingCheck is skipped and reported —
// one malformed posting must not fail the whole source.
export function mapPostings<T>(items: T[], ctx: AdapterContext, toPosting: (item: T) => Posting): Posting[] {
  const postings: Posting[] = [];
  for (const item of items) {
    let posting: Posting;
    try {
      posting = toPosting(item);
    } catch (err) {
      ctx.onSkipped?.(`unreadable item (${(err as Error).message})`);
      continue;
    }
    const check = PostingCheck.safeParse(posting);
    if (!check.success) {
      const issue = check.error.issues[0];
      ctx.onSkipped?.(`"${posting.title}": ${issue?.path.join('.')} ${issue?.message ?? 'invalid'}`);
      continue;
    }
    postings.push(posting);
  }
  return postings;
}
