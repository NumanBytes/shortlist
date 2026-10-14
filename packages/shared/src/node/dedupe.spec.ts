import { dedupeHash, normalize, normalizeCompany } from './dedupe.js';

describe('dedupe', () => {
  it('treats the same role spelled differently across sources as one job', () => {
    expect(dedupeHash('Motive Technologies, Inc.', 'Software Engineer - Frontend')).toBe(
      dedupeHash('motive', 'Software Engineer (Frontend)'),
    );
  });

  it('keeps different titles and different companies apart', () => {
    expect(dedupeHash('Motive', 'Frontend Engineer')).not.toBe(dedupeHash('Motive', 'Backend Engineer'));
    expect(dedupeHash('Motive', 'Frontend Engineer')).not.toBe(dedupeHash('Careem', 'Frontend Engineer'));
  });

  it('does not conflate C, C++ and C#', () => {
    expect(normalize('C++ Developer')).not.toBe(normalize('C# Developer'));
    expect(normalize('C++ Developer')).not.toBe(normalize('C Developer'));
  });

  it('strips accents and company suffixes', () => {
    expect(normalize('Café Développeur')).toBe('cafe developpeur');
    expect(normalizeCompany('Acme Pvt. Ltd.')).toBe('acme');
  });
});
