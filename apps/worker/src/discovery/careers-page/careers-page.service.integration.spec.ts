import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetGuard } from '../../analysis/budget-guard.js';
import type { AnalyzerResult } from '../../analysis/job-analyzer.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermanentSourceError } from '../errors.js';
import { CareersPageService } from './careers-page.service.js';
import type { CareersPageExtractor } from './extractor.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];
const URL_ = 'https://careers.brainxtech.com/';
const HTML = readFileSync(join(import.meta.dirname, '../../../test/fixtures/careers-page-brainx.html'), 'utf8');

// A fake Claude: names the two openings on the page, by the refs it was given.
class FakeExtractor implements CareersPageExtractor {
  configured = true;
  calls = 0;
  async extract({ user }: { user: string }): Promise<AnalyzerResult> {
    this.calls++;
    const ref = (part: string) => new RegExp(`(L\\d+): \\S*${part}`).exec(user)![1]!;
    return {
      model: 'claude-haiku-4-5-20251001',
      text: JSON.stringify({
        listsOpenings: true,
        jobs: [
          {
            title: 'Shopify Developer (Experienced)',
            location: 'Lahore, Pakistan',
            workMode: 'ONSITE',
            link: ref('shopify'),
            details: null,
          },
          {
            title: 'Graphic Designer',
            location: 'Lahore, Pakistan',
            workMode: 'REMOTE',
            link: ref('graphic'),
            details: null,
          },
        ],
      }),
      stopReason: 'end_turn',
      usage: { inputTokens: 2500, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

let page = HTML;
beforeEach(() => {
  page = HTML;
  vi.stubGlobal('fetch', async () => new Response(page, { status: 200 }));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

async function setup() {
  const user = await prisma.user.create({
    data: { email: `careers-${crypto.randomUUID()}@e2e.shortlist.test`, name: 'Careers Test', passwordHash: 'x' },
  });
  createdUsers.push(user.id);
  const source = await prisma.jobSource.create({
    data: {
      userId: user.id,
      key: 'careers_page:brainx',
      name: 'BrainX',
      type: 'MANUAL',
      config: { provider: 'careers_page', url: URL_ },
    },
  });
  const extractor = new FakeExtractor();
  const svc = new CareersPageService(prisma, new BudgetGuard(prisma), extractor);
  const read = () => svc.read({ sourceId: source.id, userId: user.id, name: 'BrainX', url: URL_ });
  return { user, source, extractor, read };
}

describe('CareersPageService.read', () => {
  it('reads a new page once, then answers from the snapshot until it changes', async () => {
    const { user, extractor, read } = await setup();
    const first = await read();
    expect(first.map((p) => p.title)).toEqual(['Shopify Developer (Experienced)', 'Graphic Designer']);
    expect(first[0]).toMatchObject({ company: 'BrainX', url: expect.stringContaining('/jobs/shopify-developer') });
    expect(extractor.calls).toBe(1);
    expect(await prisma.aiUsage.count({ where: { userId: user.id, purpose: 'EXTRACT_CAREERS_PAGE' } })).toBe(1);

    // Same page: no model call, same jobs, same ids (so the job store sees the same postings).
    const again = await read();
    expect(extractor.calls).toBe(1);
    expect(again.map((p) => p.externalId)).toEqual(first.map((p) => p.externalId));

    // The page changed: read again.
    page = HTML.replace('Graphic Designer', 'Senior Graphic Designer');
    await read();
    expect(extractor.calls).toBe(2);
  });

  it('over budget, a changed page keeps the last reading; a never-read page fails visibly', async () => {
    const { user, extractor, read } = await setup();
    await read();
    await prisma.aiUsage.create({
      data: {
        userId: user.id,
        purpose: 'TAILOR_RESUME',
        model: 'x',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 1000,
        succeeded: true,
      },
    });
    page = HTML.replace('Graphic Designer', 'Senior Graphic Designer');
    expect((await read()).map((p) => p.title)).toContain('Graphic Designer'); // the last reading
    expect(extractor.calls).toBe(1);

    const fresh = await setup();
    await prisma.aiUsage.create({
      data: {
        userId: fresh.user.id,
        purpose: 'TAILOR_RESUME',
        model: 'x',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 1000,
        succeeded: true,
      },
    });
    await expect(fresh.read()).rejects.toThrow(PermanentSourceError);
    expect(fresh.extractor.calls).toBe(0);
  });

  it('refuses a page that is empty without JavaScript, without calling the model', async () => {
    const { extractor, read } = await setup();
    page = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
    await expect(read()).rejects.toThrow(/without JavaScript/);
    expect(extractor.calls).toBe(0);
  });
});
