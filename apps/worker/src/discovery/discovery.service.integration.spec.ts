import { DEFAULT_DISCOVERY_PREFERENCES } from '@shortlist/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ADAPTERS } from './adapters/index.js';
import { DiscoveryService, PermanentSourceError } from './discovery.service.js';
import type { AdapterRegistry, Posting } from './types.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];
const recent = () => new Date(Date.now() - 2 * 24 * 3600 * 1000);

const posting = (over: Partial<Posting> = {}): Posting => ({
  externalId: crypto.randomUUID(),
  title: 'Frontend Engineer',
  company: 'Acme',
  location: 'Lahore, Pakistan',
  workMode: 'ONSITE',
  url: `https://jobs.example.com/${crypto.randomUUID()}`,
  postedAt: recent(),
  description: 'Build product features in React and TypeScript.',
  ...over,
});

// A registry where "greenhouse" is whatever the test says; every other provider is real
// but never called (the test sources are all greenhouse).
function serviceWith(fetchPostings: (...args: unknown[]) => Promise<Posting[]>) {
  const adapters = { ...ADAPTERS, greenhouse: vi.fn(fetchPostings) } as unknown as AdapterRegistry;
  return { service: new DiscoveryService(prisma, adapters), adapter: adapters.greenhouse };
}

async function newSource(
  config: object = { provider: 'greenhouse', board: 'test' },
  type: 'ATS_BOARD' | 'AGGREGATOR_API' = 'ATS_BOARD',
) {
  const user = await prisma.user.create({
    data: { email: `worker-${crypto.randomUUID()}@e2e.shortlist.test`, name: 'Worker Test', passwordHash: 'x' },
  });
  createdUsers.push(user.id);
  return prisma.jobSource.create({
    data: { userId: user.id, key: 'greenhouse:test', name: 'Test Board', type, config },
  });
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } }); // cascades to sources, runs, jobs
  await prisma.$disconnect();
});

describe('DiscoveryService.runSource', () => {
  it('opens the run as RUNNING before fetching anything', async () => {
    const source = await newSource();
    let statusDuringFetch: string | undefined;
    const { service } = serviceWith(async () => {
      const run = await prisma.discoveryRun.findFirst({ where: { jobSourceId: source.id } });
      statusDuringFetch = run?.status;
      return [];
    });
    await service.runSource(source.id);
    expect(statusDuringFetch).toBe('RUNNING');
  });

  it('filters, stores matches with attribution, and records counts', async () => {
    const source = await newSource();
    const { service } = serviceWith(async () => [
      posting({ title: 'Frontend Engineer' }),
      posting({ title: 'Full Stack Developer', company: 'Beta' }),
      posting({ title: 'HR Executive' }), // stage A: title
      posting({ title: 'Software Engineer', location: 'Berlin', workMode: 'ONSITE' }), // stage A: location
      posting({ title: 'Software Engineer', company: 'Gamma', description: 'Java and Spring only.' }), // stage B
    ]);
    const summary = await service.runSource(source.id);

    expect(summary).toMatchObject({ status: 'SUCCESS', jobsFound: 5, jobsMatched: 2, jobsNew: 2 });
    expect(summary.rejections).toEqual({
      'title: not a role we target': 1,
      'location: "Berlin" is not an allowed place': 1,
      'no core-stack keyword in title or description': 1,
    });

    const run = await prisma.discoveryRun.findUniqueOrThrow({ where: { id: summary.runId } });
    expect(run).toMatchObject({ status: 'SUCCESS', jobsFound: 5, jobsMatched: 2, jobsNew: 2 });
    expect(run.finishedAt).toBeInstanceOf(Date);

    const jobs = await prisma.job.findMany({ where: { jobSourceId: source.id } });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ source: 'greenhouse', discoveryRunId: run.id, status: 'DISCOVERED' });
    expect(jobs[0]!.sourceUrl).toMatch(/^https:\/\/jobs\.example\.com\//);
    expect(jobs[0]!.rawJD).toContain('React');

    const after = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.lastRunStatus).toBe('SUCCESS');
  });

  it('does not duplicate jobs across runs, and bumps lastSeenAt', async () => {
    const source = await newSource();
    const same = posting();
    const { service } = serviceWith(async () => [same]);

    expect((await service.runSource(source.id)).jobsNew).toBe(1);
    const firstSeen = (await prisma.job.findFirstOrThrow({ where: { jobSourceId: source.id } })).lastSeenAt;

    const second = await service.runSource(source.id);
    expect(second).toMatchObject({ jobsMatched: 1, jobsNew: 0 });
    const jobs = await prisma.job.findMany({ where: { jobSourceId: source.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.lastSeenAt.getTime()).toBeGreaterThan(firstSeen.getTime());
  });

  it('dedupes the same role spelled differently within one fetch', async () => {
    const source = await newSource();
    const { service } = serviceWith(async () => [
      posting({ company: 'Acme Inc.', title: 'Frontend Engineer - React' }),
      posting({ company: 'acme', title: 'Frontend Engineer (React)' }),
    ]);
    expect(await service.runSource(source.id)).toMatchObject({ jobsMatched: 2, jobsNew: 1 });
  });

  it('only fetches descriptions for postings that passed the listing screen', async () => {
    const source = await newSource();
    const load = vi.fn(async () => 'React and TypeScript');
    const { service } = serviceWith(async () => [
      posting({ description: null, loadDescription: load }),
      posting({ title: 'Sales Manager', description: null, loadDescription: load }),
      posting({ title: 'Android Engineer', description: null, loadDescription: load }),
    ]);
    await service.runSource(source.id);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("one posting's description failing doesn't fail the run", async () => {
    const source = await newSource();
    const { service } = serviceWith(async () => [
      posting({ description: null, loadDescription: async () => Promise.reject(new Error('HTTP 500')) }),
      posting({ company: 'Other' }),
    ]);
    const summary = await service.runSource(source.id);
    expect(summary).toMatchObject({ status: 'SUCCESS', jobsNew: 1 });
    expect(summary.rejections['description fetch failed']).toBe(1);
  });

  it('marks a source that returns nothing as EMPTY, not SUCCESS', async () => {
    const source = await newSource();
    const { service } = serviceWith(async () => []);
    expect((await service.runSource(source.id)).status).toBe('EMPTY');
    expect((await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } })).lastRunStatus).toBe('EMPTY');
  });

  it('records a FAILED run with the error, and rethrows so the queue can retry', async () => {
    const source = await newSource();
    const { service } = serviceWith(async () => Promise.reject(new Error('HTTP 503 from boards-api.greenhouse.io')));
    await expect(service.runSource(source.id)).rejects.toThrow('HTTP 503');
    const run = await prisma.discoveryRun.findFirstOrThrow({ where: { jobSourceId: source.id } });
    expect(run).toMatchObject({ status: 'FAILED', errorMessage: 'HTTP 503 from boards-api.greenhouse.io' });
    expect(run.finishedAt).toBeInstanceOf(Date);
  });

  it('fails a planned-but-unimplemented provider permanently, with a clear message', async () => {
    const source = await newSource({ provider: 'zohorecruit', url: 'https://x.zohorecruit.com/jobs/Careers' });
    const { service, adapter } = serviceWith(async () => []);
    await expect(service.runSource(source.id)).rejects.toBeInstanceOf(PermanentSourceError);
    const run = await prisma.discoveryRun.findFirstOrThrow({ where: { jobSourceId: source.id } });
    expect(run.errorMessage).toMatch(/No adapter for provider "zohorecruit"/);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('applies the posting-age limit to aggregators only', async () => {
    const old = () =>
      posting({ company: crypto.randomUUID(), postedAt: new Date(Date.now() - 200 * 24 * 3600 * 1000) });
    const board = await newSource();
    const feed = await newSource({ provider: 'greenhouse', board: 'test' }, 'AGGREGATOR_API');
    const { service } = serviceWith(async () => [old()]);
    expect(await service.runSource(board.id)).toMatchObject({ jobsMatched: 1 }); // company board: still open
    expect(await service.runSource(feed.id)).toMatchObject({ jobsMatched: 0, rejections: { 'older than 30 days': 1 } });
  });

  it("uses the user's own filter preferences when they have them", async () => {
    const source = await newSource();
    await prisma.discoveryPreferences.create({
      data: { userId: source.userId, ...DEFAULT_DISCOVERY_PREFERENCES, onsiteLocations: ['berlin'] },
    });
    const { service } = serviceWith(async () => [posting({ location: 'Berlin' }), posting({ company: 'B' })]);
    // Berlin is now allowed; Lahore no longer is.
    expect(await service.runSource(source.id)).toMatchObject({ jobsMatched: 1 });
    const job = await prisma.job.findFirstOrThrow({ where: { jobSourceId: source.id } });
    expect(job.location).toBe('Berlin');
  });
});
