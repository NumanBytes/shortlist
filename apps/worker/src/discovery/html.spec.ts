import { jsonLdDescription, jsonLdJobPosting, requireJsonLdDescription } from './html.js';

const page = (json: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head></html>`;

describe('jsonLdJobPosting', () => {
  it('finds a JobPosting in an array, under @graph, or typed as a list', () => {
    expect(jsonLdJobPosting(page([{ '@type': 'Organization' }, { '@type': 'JobPosting', title: 'A' }]))?.title).toBe(
      'A',
    );
    expect(
      jsonLdJobPosting(page({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'JobPosting', title: 'B' }] }))?.title,
    ).toBe('B');
    expect(jsonLdJobPosting(page({ '@type': ['JobPosting', 'Thing'], title: 'C' }))?.title).toBe('C');
    expect(jsonLdJobPosting(page({ '@type': 'Organization' }))).toBeNull();
  });
});

describe('jsonLdDescription', () => {
  it('keeps text that was escaped markup in the original, instead of stripping it as a tag', () => {
    const html = page({
      '@type': 'JobPosting',
      description: '<p>Knowledge of &lt;canvas&gt; and C&amp;lt;T&amp;gt;</p>',
    });
    expect(jsonLdDescription(html)).toBe('Knowledge of <canvas> and C&lt;T&gt;');
  });

  it('fails a posting whose page has no JobPosting data, rather than returning nothing', () => {
    expect(() => requireJsonLdDescription('<html></html>', 'https://x.applytojob.com/apply/1/a')).toThrow(
      /No JobPosting data/,
    );
  });
});
