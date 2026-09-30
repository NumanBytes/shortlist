import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Posting } from '../types.js';
import { ADAPTERS } from './index.js';

// Fixtures are real responses captured from each source on 2026-10-01, trimmed to a
// few postings. Tests never touch the network.
const FIXTURES = join(import.meta.dirname, '../../../test/fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

// Serves fixtures by URL pattern and records every request made.
function serve(routes: [RegExp, string][]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
    const route = routes.find(([re]) => re.test(url));
    if (!route) return new Response('not found', { status: 404 });
    return new Response(fixture(route[1]), { status: 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const ctx = { sourceName: 'Test Co' };

function expectWellFormed(postings: Posting[]) {
  expect(postings.length).toBeGreaterThan(0);
  for (const p of postings) {
    expect(p.externalId).toBeTruthy();
    expect(p.title).toBeTruthy();
    expect(p.company).toBeTruthy();
    expect(p.url).toMatch(/^https?:\/\//);
    expect(p.title).not.toMatch(/<|&[a-z]+;/); // no leftover markup/entities
  }
}

describe('greenhouse', () => {
  it('maps the board with descriptions in one request', async () => {
    const calls = serve([[/boards-api\.greenhouse\.io\/v1\/boards\/careem\/jobs\?content=true/, 'greenhouse.json']]);
    const postings = await ADAPTERS.greenhouse({ provider: 'greenhouse', board: 'careem' }, ctx);
    expectWellFormed(postings);
    expect(calls).toHaveLength(1);
    const pk = postings.find((p) => p.location?.includes('Pakistan'))!;
    expect(pk.company).toBe('Careem');
    expect(pk.description).not.toMatch(/<\/?[a-z]|&lt;/); // HTML decoded and stripped
    expect(pk.postedAt).toBeInstanceOf(Date);
  });
});

describe('lever', () => {
  it('maps postings, work mode, and country', async () => {
    serve([[/api\.lever\.co\/v0\/postings\/kwanso\?mode=json/, 'lever.json']]);
    const postings = await ADAPTERS.lever({ provider: 'lever', site: 'kwanso' }, ctx);
    expectWellFormed(postings);
    expect(postings[0]).toMatchObject({ company: 'Test Co', workMode: 'ONSITE' });
    expect(postings[0]!.location).toMatch(/PK$/);
    expect(postings[0]!.description).toBeTruthy();
  });
});

describe('smartrecruiters', () => {
  it('lists without descriptions, then loads one on demand', async () => {
    const calls = serve([
      [/postings\?limit=100&offset=0$/, 'smartrecruiters-list.json'],
      [/postings\/\d+$/, 'smartrecruiters-detail.json'],
    ]);
    const postings = await ADAPTERS.smartrecruiters({ provider: 'smartrecruiters', company: 'SeptemSystems' }, ctx);
    expectWellFormed(postings);
    expect(calls).toHaveLength(1); // the list only — no detail requests yet
    const mern = postings.find((p) => p.title.includes('MERN'))!;
    expect(mern.description).toBeNull();
    const description = await mern.loadDescription!();
    expect(description).toMatch(/react|node|mongo/i);
    expect(calls).toHaveLength(2);
  });
});

describe('workable', () => {
  it('lists via v3 POST, loads descriptions via v2', async () => {
    const calls = serve([
      [/api\/v3\/accounts\/blueground\/jobs$/, 'workable-list.json'],
      [/api\/v2\/accounts\/blueground\/jobs\/\w+$/, 'workable-detail.json'],
    ]);
    const postings = await ADAPTERS.workable({ provider: 'workable', account: 'blueground' }, ctx);
    expectWellFormed(postings);
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(postings[0]).toMatchObject({ workMode: 'HYBRID', location: expect.stringContaining('Greece') });
    expect(await postings[0]!.loadDescription!()).toBeTruthy();
  });
});

describe('aggregators', () => {
  it('remoteok skips the legal-notice element and keeps tags searchable', async () => {
    serve([[/remoteok\.com\/api$/, 'remoteok.json']]);
    const postings = await ADAPTERS.remoteok({ provider: 'remoteok' }, ctx);
    expectWellFormed(postings);
    expect(postings).toHaveLength(3); // 4 elements in the fixture, first is the notice
    expect(postings.every((p) => p.workMode === 'REMOTE')).toBe(true);
    expect(postings.some((p) => p.description?.includes('Tags:'))).toBe(true);
  });

  it('remotive', async () => {
    serve([[/remotive\.com\/api\/remote-jobs\?category=software-dev/, 'remotive.json']]);
    const postings = await ADAPTERS.remotive({ provider: 'remotive', category: 'software-dev' }, ctx);
    expectWellFormed(postings);
    expect(postings[0]!.postedAt?.toISOString()).toMatch(/Z$/);
  });

  it('arbeitnow stops when there is no next page', async () => {
    const calls = serve([[/arbeitnow\.com\/api\/job-board-api\?page=1/, 'arbeitnow.json']]);
    const postings = await ADAPTERS.arbeitnow({ provider: 'arbeitnow', maxPages: 3 }, ctx);
    expectWellFormed(postings);
    expect(calls).toHaveLength(1);
  });

  it('himalayas treats no location restrictions as worldwide', async () => {
    serve([[/himalayas\.app\/jobs\/api\?limit=20$/, 'himalayas.json']]);
    const postings = await ADAPTERS.himalayas({ provider: 'himalayas', maxPages: 5 }, ctx);
    expectWellFormed(postings);
    expect(postings.every((p) => p.workMode === 'REMOTE' && p.location)).toBe(true);
  });

  it('jobicy decodes entity-encoded titles', async () => {
    serve([[/jobicy\.com\/api\/v2\/remote-jobs\?count=100/, 'jobicy.json']]);
    expectWellFormed(await ADAPTERS.jobicy({ provider: 'jobicy' }, ctx));
  });

  it('weworkremotely splits "Company: Title" from the RSS feed', async () => {
    serve([[/weworkremotely\.com\/categories\/remote-full-stack-programming-jobs\.rss/, 'wwr.xml']]);
    const postings = await ADAPTERS.weworkremotely(
      { provider: 'weworkremotely', category: 'remote-full-stack-programming-jobs' },
      ctx,
    );
    expectWellFormed(postings);
    expect(postings[0]).toMatchObject({ company: 'Lithic', title: 'Senior Risk Associate' });
    expect(postings[0]!.description).not.toMatch(/&lt;|<p>/);
  });
});

describe('errors', () => {
  it('surfaces HTTP failures instead of returning an empty list', async () => {
    serve([]); // every request 404s
    await expect(ADAPTERS.greenhouse({ provider: 'greenhouse', board: 'nope' }, ctx)).rejects.toThrow('HTTP 404');
  });
});
