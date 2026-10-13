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

// Hosted careers pages (Milestone 2): HTML captured 2026-10-13, trimmed, contact details removed.
describe('hosted careers pages', () => {
  it('jazzhr reads the list template, and the description from the job page’s JobPosting data', async () => {
    const calls = serve([
      [/northbay\.applytojob\.com\/apply$/, 'jazzhr-list.html'],
      [/northbay\.applytojob\.com\/apply\/q91wjU5pCF\//, 'jazzhr-job.html'],
    ]);
    const postings = await ADAPTERS.jazzhr({ provider: 'jazzhr', url: 'https://northbay.applytojob.com/apply' }, ctx);
    expectWellFormed(postings);
    expect(postings[0]).toMatchObject({
      externalId: 'q91wjU5pCF',
      title: '.NET Developer',
      location: 'Lahore, Punjab, Pakistan',
      company: 'Test Co',
      description: null,
    });
    expect(postings.find((p) => p.location === 'Remote')?.workMode).toBe('REMOTE');
    expect(calls).toHaveLength(1); // descriptions only for survivors
    expect(await postings[0]!.loadDescription!()).toMatch(/\.NET Developer/);
  });

  it('jazzhr reads a custom table template, once per job', async () => {
    serve([[/venturedive\.applytojob\.com\/apply$/, 'jazzhr-table.html']]);
    const postings = await ADAPTERS.jazzhr(
      { provider: 'jazzhr', url: 'https://venturedive.applytojob.com/apply' },
      ctx,
    );
    expectWellFormed(postings);
    expect(postings).toHaveLength(4); // the page shows its table twice
    expect(postings[0]).toMatchObject({ title: 'Network & System Support Engineer', location: 'Karachi, Pakistan' });
  });

  it('zohorecruit reads the hidden job list and the job page’s own record', async () => {
    serve([
      [/techlogix\.zohorecruit\.com\/jobs\/Careers---Lahore$/, 'zohorecruit-list.html'],
      [/techlogix\.zohorecruit\.com\/jobs\/Careers---Lahore\/144136000023648189\//, 'zohorecruit-job.html'],
    ]);
    const postings = await ADAPTERS.zohorecruit(
      { provider: 'zohorecruit', url: 'https://techlogix.zohorecruit.com/jobs/Careers---Lahore' },
      ctx,
    );
    expectWellFormed(postings);
    expect(postings[0]).toMatchObject({
      title: 'Senior React Native Developer',
      location: 'Lahore, Pakistan',
      url: 'https://techlogix.zohorecruit.com/jobs/Careers---Lahore/144136000023648189/Senior-React-Native-Developer',
    });
    const description = await postings[0]!.loadDescription!();
    expect(description).toMatch(/Senior React Native Developer/);
    expect(description).not.toMatch(/<|\\x22/);
  });

  it('zohorecruit fails clearly when the careers site is gone, instead of reporting no jobs', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html><h2>not available</h2></html>', { status: 200 }));
    await expect(
      ADAPTERS.zohorecruit({ provider: 'zohorecruit', url: 'https://slashnext.zohorecruit.com/jobs/Careers' }, ctx),
    ).rejects.toThrow(/No Zoho Recruit job list/);
  });

  it('opencats reads the table and the details page', async () => {
    serve([
      [/m=careers&p=showAll$/, 'opencats-list.html'],
      [/m=careers&p=showJob&ID=229$/, 'opencats-job.html'],
    ]);
    const url = 'https://hr.intagleo.com/careers/index.php?m=careers&p=showAll';
    const postings = await ADAPTERS.opencats({ provider: 'opencats', url }, ctx);
    expectWellFormed(postings);
    expect(postings[0]).toMatchObject({
      externalId: '229',
      title: 'Data Engineer- Yardi',
      location: 'Lahore, Pakistan',
      url: 'https://hr.intagleo.com/careers/index.php?m=careers&p=showJob&ID=229',
    });
    const description = await postings[0]!.loadDescription!();
    expect(description).toMatch(/Data Migration Engineer/); // inside the template's HTML comment
    expect(description).not.toMatch(/Apply to Position|<!--/);
  });
});

describe('hosted careers pages — simplicant', () => {
  it('reads each job once, though the board lists it under Featured and its department', async () => {
    serve([
      [/7vals\.simplicant\.com\/$/, 'simplicant-list.html'],
      [/7vals\.simplicant\.com\/jobs\/25252-software-engineer\/detail$/, 'simplicant-job.html'],
    ]);
    const postings = await ADAPTERS.simplicant({ provider: 'simplicant', url: 'https://7vals.simplicant.com/' }, ctx);
    expectWellFormed(postings);
    expect(new Set(postings.map((p) => p.externalId)).size).toBe(postings.length);
    const se = postings.find((p) => p.externalId === '25252')!;
    expect(se).toMatchObject({
      title: 'Software Engineer',
      location: 'Lahore, Punjab, Pakistan',
      url: 'https://7vals.simplicant.com/jobs/25252-software-engineer/detail',
    });
    expect(await se.loadDescription!()).toMatch(/SaaS/);
  });
});

describe('hosted careers pages — variants', () => {
  it('opencats also reads installs that name jobs by slug', async () => {
    serve([[/careers\.i2cinc\.com\/careers\/index\.php\?m=careers&p=showAll$/, 'opencats-slug-list.html']]);
    const postings = await ADAPTERS.opencats(
      { provider: 'opencats', url: 'https://careers.i2cinc.com/careers/index.php?m=careers&p=showAll' },
      ctx,
    );
    expectWellFormed(postings);
    expect(postings[0]).toMatchObject({
      externalId: 'associate-client-success-manager-strategic-key-accounts-7',
      title: 'Associate Client Success Manager - Strategic & Key Accounts',
      location: 'Lahore, Punjab',
    });
  });
});

describe('errors', () => {
  it('surfaces HTTP failures instead of returning an empty list', async () => {
    serve([]); // every request 404s
    await expect(ADAPTERS.greenhouse({ provider: 'greenhouse', board: 'nope' }, ctx)).rejects.toThrow('HTTP 404');
  });
});
