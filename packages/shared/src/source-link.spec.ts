import { sourceFromLink } from './source-link.js';

describe('sourceFromLink', () => {
  it('gives a known board its API adapter, keyed by the board', () => {
    expect(sourceFromLink('Motive', 'https://job-boards.greenhouse.io/gomotive')).toEqual({
      ok: true,
      key: 'greenhouse:gomotive',
      type: 'ATS_BOARD',
      config: { provider: 'greenhouse', board: 'gomotive' },
    });
    expect(sourceFromLink('Acme', 'jobs.lever.co/acme/123')).toMatchObject({
      ok: true,
      config: { provider: 'lever', site: 'acme' },
    });
  });

  it('gives a hosted page its page adapter', () => {
    expect(sourceFromLink('Arbisoft', 'https://arbisoft.applytojob.com/apply')).toMatchObject({
      ok: true,
      key: 'jazzhr:arbisoft',
      config: { provider: 'jazzhr', url: 'https://arbisoft.applytojob.com/apply' },
    });
  });

  it("watches any other company's page as a careers page", () => {
    expect(sourceFromLink('BrainX Technologies', 'careers.brainxtech.com/')).toEqual({
      ok: true,
      key: 'careers_page:brainx-technologies',
      type: 'MANUAL',
      config: { provider: 'careers_page', url: 'https://careers.brainxtech.com/' },
    });
  });

  it("says so when a platform's link is missing the board", () => {
    expect(sourceFromLink('X', 'https://boards.greenhouse.io/')).toMatchObject({ ok: false });
  });

  // SSRF screen at save time; the worker re-checks with DNS at every fetch.
  it('refuses internal addresses and other schemes', () => {
    for (const link of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/',
      'http://10.0.0.5/jobs',
      'http://postgres:5432/',
      'http://[::1]/',
      'http://api.internal/jobs',
      'ftp://example.com/jobs',
    ])
      expect(sourceFromLink('X', link)).toMatchObject({ ok: false });
  });
});
