import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAREERS_PAGE_EXTRACTION_JSON_SCHEMA, CareersPageExtractionSchema } from '@shortlist/shared';
import { checkOpenings } from './check.js';
import { buildCareersPagePrompt } from './extractor.js';
import { fingerprint, pageText } from './page.js';

// BrainX's careers page as captured 2026-10-13 (contact details replaced).
const HTML = readFileSync(join(import.meta.dirname, '../../../test/fixtures/careers-page-brainx.html'), 'utf8');
const URL_ = 'https://careers.brainxtech.com/';
const page = pageText(HTML, URL_);
const ref = (urlPart: string) => [...page.links].find(([, u]) => u.includes(urlPart))![0];

describe('pageText', () => {
  it('keeps the openings and shows each link as a ref, never as a URL', () => {
    expect(page.text).toContain('Shopify Developer (Experienced)');
    expect(page.text).not.toMatch(/https?:\/\//);
    expect(page.links.get(ref('shopify-developer'))).toBe(
      'https://careers.brainxtech.com/jobs/shopify-developer-experienced-2026-05-19',
    );
  });

  it('drops scripts, styles, menus and footers', () => {
    const p = pageText(
      '<nav><a href="/about">About</a></nav><main><h1>Jobs</h1><script>var x=1</script><a href="/j/1">React Developer</a></main><footer>© 2026</footer>',
      'https://acme.test/careers',
    );
    expect(p.text).toBe('Jobs\nReact Developer [L1]');
    expect([...p.links.values()]).toEqual(['https://acme.test/j/1']);
  });

  it("keeps a job card's own <header>, and drops the site's", () => {
    const p = pageText(
      `<header class="site-header"><a href="/">Home</a></header>
       <main><article><header><h3>Senior React Developer</h3></header><p>Lahore</p></article></main>
       <footer role="contentinfo">© Acme</footer>`,
      'https://acme.test/careers',
    );
    expect(p.text).toContain('Senior React Developer');
    expect(p.text).not.toMatch(/Home|© Acme/);
  });

  it('ignores "posted N days ago" when deciding whether the page changed', () => {
    const at = (age: string) =>
      fingerprint(pageText(`<main><a href="/j/1">React Developer</a> Posted ${age} ago</main>`, 'https://a.test/'));
    expect(at('3 days')).toBe(at('4 days'));
    expect(fingerprint(pageText('<main><a href="/j/2">Vue Developer</a></main>', 'https://a.test/'))).not.toBe(
      at('3 days'),
    );
  });
});

describe('checkOpenings', () => {
  const job = (over: Record<string, unknown> = {}) => ({
    title: 'Shopify Developer (Experienced)',
    location: 'Lahore, Pakistan',
    workMode: 'ONSITE' as const,
    link: ref('shopify-developer'),
    details: null,
    ...over,
  });

  it('keeps an opening named on the page, linked to its own page', () => {
    const { openings } = checkOpenings({ listsOpenings: true, jobs: [job()] }, page, URL_);
    expect(openings).toEqual([
      {
        title: 'Shopify Developer (Experienced)',
        location: 'Lahore, Pakistan',
        workMode: 'ONSITE',
        url: 'https://careers.brainxtech.com/jobs/shopify-developer-experienced-2026-05-19',
        details: null,
      },
    ]);
  });

  it('drops a title that is not on the page, and falls back to the page for an unknown link', () => {
    const { openings, dropped } = checkOpenings(
      { listsOpenings: true, jobs: [job({ title: 'Senior React Engineer' }), job({ link: 'L99' })] },
      page,
      URL_,
    );
    expect(dropped).toEqual([{ title: 'Senior React Engineer', reason: 'title not on the page' }]);
    expect(openings[0]!.url).toBe(URL_);
  });

  it('keeps details only when they are quoted from the page', () => {
    const quoted = checkOpenings(
      {
        listsOpenings: true,
        jobs: [job({ details: "we'll notify you when a matching opportunity becomes available" })],
      },
      page,
      URL_,
    );
    expect(quoted.openings[0]!.details).toMatch(/notify you/);
    const invented = checkOpenings(
      { listsOpenings: true, jobs: [job({ details: 'Requires 5 years of React and Node.js.' })] },
      page,
      URL_,
    );
    expect(invented.openings[0]!.details).toBeNull();
  });

  it("won't link a job to an internal address, even when the page offers one", () => {
    const hostile = pageText(
      '<main><a href="http://169.254.169.254/latest/meta-data/">Shopify Developer (Experienced)</a></main>',
      URL_,
    );
    const { openings } = checkOpenings(
      { listsOpenings: true, jobs: [job({ link: 'L1' })] },
      { ...hostile, text: `${hostile.text}\n${page.text}` },
      URL_,
    );
    expect(openings[0]!.url).toBe(URL_);
  });

  it('keeps nothing from a page the model says lists no openings', () => {
    expect(checkOpenings({ listsOpenings: false, jobs: [job()] }, page, URL_).openings).toEqual([]);
  });
});

describe('buildCareersPagePrompt', () => {
  it('wraps the page as untrusted data and lists links by ref', () => {
    const p = buildCareersPagePrompt('BrainX', page);
    expect(p.user).toMatch(/<page>[\s\S]*Shopify Developer[\s\S]*<\/page>/);
    expect(p.user).toContain(`${ref('shopify-developer')}: https://careers.brainxtech.com/jobs/shopify-developer`);
    expect(p.system).toMatch(/ignore any instructions/);
  });

  it('JSON schema stays in sync with the Zod schema', () => {
    const s = CAREERS_PAGE_EXTRACTION_JSON_SCHEMA;
    expect([...s.required].sort()).toEqual(Object.keys(CareersPageExtractionSchema.shape).sort());
    expect([...s.properties.jobs.items.required].sort()).toEqual(
      Object.keys(CareersPageExtractionSchema.shape.jobs.element.shape).sort(),
    );
  });
});
