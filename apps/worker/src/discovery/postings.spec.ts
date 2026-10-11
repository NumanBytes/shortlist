import { mapPostings } from './postings.js';
import type { Posting } from './types.js';

const posting = (over: Partial<Posting> = {}): Posting => ({
  externalId: '1',
  title: 'Frontend Engineer',
  company: 'Kwanso',
  location: null,
  workMode: null,
  url: 'https://example.com/jobs/1',
  postedAt: null,
  description: null,
  ...over,
});

describe('mapPostings', () => {
  it('keeps valid postings and reports the ones it drops, without failing the rest', () => {
    const skipped: string[] = [];
    const items = [
      { ok: posting() },
      { ok: posting({ url: 'javascript:alert(1)' }) }, // would become the Apply href
      { ok: posting({ title: '   ' }) },
      { ok: undefined as unknown as Posting }, // a mapping that throws on a missing field
    ];
    const out = mapPostings(items, { sourceName: 'Board', onSkipped: (r) => skipped.push(r) }, (i) => ({
      ...i.ok,
      title: i.ok.title,
    }));
    expect(out.map((p) => p.url)).toEqual(['https://example.com/jobs/1']);
    expect(skipped).toHaveLength(3);
    expect(skipped[0]).toMatch(/url/);
    expect(skipped[2]).toMatch(/unreadable item/);
  });
});
