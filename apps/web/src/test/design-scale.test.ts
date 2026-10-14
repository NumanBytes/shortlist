// The type and radius scales (index.css, UI audit G9/G10, docs/web-design.md §8.6) hold
// only if nobody reaches past them. This fails on a raw size or radius class anywhere in
// the app's components, so a new screen can't quietly bring back a 14th font size.
// The printed resume is exempt: it is a Letter page sized in points, not UI.
const sources = import.meta.glob<string>(
  ['../**/*.tsx', '!../**/*.test.tsx', '!../features/resume/ResumeDocument.tsx'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const RULES: [RegExp, string][] = [
  [
    /(?<![\w-])text-(?:\[\d+(?:\.\d+)?px\]|xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g,
    'use a named text step (text-footnote, text-body, …)',
  ],
  [
    /(?<![\w-])rounded(?:-[tblrse]{1,2})?(?:-(?:none|xs|xl|[2-4]xl|\[[^\]]+\]))?(?![\w[-])/g,
    'use rounded-sm/md/lg/sheet/full',
  ],
];

describe('design scale', () => {
  it('finds the component sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
  });

  it('uses only the named type and radius steps', () => {
    const problems: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      for (const [rule, fix] of RULES) {
        for (const m of source.matchAll(rule)) {
          problems.push(`${path}: ${m[0]} — ${fix}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
