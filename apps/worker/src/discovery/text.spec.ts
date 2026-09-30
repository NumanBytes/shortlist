import { decodeEntities, htmlToText, toDate } from './text.js';

describe('htmlToText', () => {
  it('keeps structure as line breaks and bullets', () => {
    expect(htmlToText('<p>Build UIs</p><ul><li>React</li><li>TypeScript</li></ul>')).toBe('Build UIs\n\n- React\n- TypeScript');
  });

  it('decodes entity-encoded HTML (Greenhouse, WWR) before stripping it', () => {
    expect(htmlToText('&lt;p&gt;Tom &amp;amp; Jerry&lt;/p&gt;')).toBe('Tom & Jerry');
  });

  it('drops scripts and styles entirely', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Hi</p><script>alert(1)</script>')).toBe('Hi');
  });
});

describe('decodeEntities', () => {
  it('handles named, decimal, and hex entities', () => {
    expect(decodeEntities('A &ndash; B &#8211; C &#x2013; D&nbsp;E')).toBe('A – B – C – D E');
  });
});

describe('toDate', () => {
  it('reads epoch seconds, epoch ms, ISO, and naive-UTC strings', () => {
    expect(toDate(1_790_000_000)?.toISOString()).toBe('2026-09-21T14:13:20.000Z');
    expect(toDate(1_790_000_000_000)?.toISOString()).toBe('2026-09-21T14:13:20.000Z');
    expect(toDate('1790000000')?.toISOString()).toBe('2026-09-21T14:13:20.000Z');
    expect(toDate('2026-09-21T12:55:11')?.toISOString()).toBe('2026-09-21T12:55:11.000Z');
  });

  it('returns null for missing or garbage input', () => {
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate('not a date')).toBeNull();
  });
});
