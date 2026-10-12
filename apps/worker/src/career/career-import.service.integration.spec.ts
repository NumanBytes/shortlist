import type { CareerExtraction } from '@shortlist/shared';
import { BudgetGuard } from '../analysis/budget-guard.js';
import type { AnalyzerResult } from '../analysis/job-analyzer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CareerImportService } from './career-import.service.js';
import type { ResumeReader } from './resume-reader.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];

const RESUME = `Jane Doe — Software Engineer
EXPERIENCE
Frontend Engineer, Acme Corp — Lahore (Jan 2024 – Present)
• Built React dashboards used by the operations team.
• Deployed releases on Azure App Service.
PROJECTS
Trailmap — a hiking planner
• Built a Next.js app with a PostgreSQL backend.
SKILLS: React, Next.js, PostgreSQL, Docker`;

const extraction: CareerExtraction = {
  roles: [
    {
      ref: 'R1',
      title: 'Frontend Engineer',
      company: 'Acme Corp',
      location: 'Lahore',
      start: '2024-01',
      end: null,
      current: true,
    },
  ],
  projects: [{ ref: 'P1', name: 'Trailmap', description: 'A hiking planner', role: null }],
  items: [
    {
      skill: 'React',
      category: 'FRAMEWORK',
      context: 'COMMERCIAL',
      depth: 'PRODUCTION',
      whatIDid: 'Built React dashboards used by the operations team.',
      role: 'R1',
      project: null,
      lastUsed: null,
    },
    {
      skill: 'Azure',
      category: 'PLATFORM',
      context: 'COMMERCIAL',
      depth: 'WORKING',
      whatIDid: 'Deployed releases on Azure App Service.',
      role: 'R1',
      project: null,
      lastUsed: null,
    },
    {
      skill: 'Next.js',
      category: 'FRAMEWORK',
      context: 'PERSONAL',
      depth: 'PRODUCTION',
      whatIDid: 'Built a Next.js app with a PostgreSQL backend.',
      role: null,
      project: 'P1',
      lastUsed: null,
    },
    {
      skill: 'React',
      category: 'FRAMEWORK',
      context: 'COMMERCIAL',
      depth: 'PRODUCTION',
      whatIDid: 'Architected the company-wide React platform.', // not in the resume
      role: 'R1',
      project: null,
      lastUsed: null,
    },
  ],
  listedSkills: [{ name: 'Docker', category: 'TOOL' }],
};

class FakeReader implements ResumeReader {
  configured = true;
  calls = 0;
  async read(): Promise<AnalyzerResult> {
    this.calls++;
    return {
      model: 'claude-sonnet-5-5-20260901',
      text: JSON.stringify(extraction),
      stopReason: 'end_turn',
      usage: { inputTokens: 3000, outputTokens: 1200, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

async function setup() {
  const user = await prisma.user.create({
    data: { email: `import-${crypto.randomUUID()}@e2e.shortlist.test`, name: 'Import Test', passwordHash: 'x' },
  });
  createdUsers.push(user.id);
  await prisma.neverClaim.create({ data: { userId: user.id, term: 'Azure' } });
  const reader = new FakeReader();
  const svc = new CareerImportService(prisma, new BudgetGuard(prisma), reader);
  const start = () => prisma.careerImport.create({ data: { userId: user.id, text: RESUME } });
  return { user, reader, svc, start };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe('CareerImportService.run', () => {
  it('stores what the resume quotes, all unverified, and clears the text', async () => {
    const { user, svc, start } = await setup();
    const row = await start();
    const outcome = await svc.run(row.id);
    expect(outcome).toEqual({
      status: 'DONE',
      created: { roles: 1, projects: 1, skills: 3, evidence: 2 },
      dropped: 2, // the Azure item (never-claim list) and the invented one
    });

    const evidence = await prisma.skillEvidence.findMany({
      where: { skill: { userId: user.id } },
      include: { skill: true },
    });
    expect(evidence.every((e) => !e.isVerified && e.verifiedAt === null)).toBe(true);
    expect(evidence.map((e) => e.skill.name).sort()).toEqual(['Next.js', 'React']);
    const nextjs = evidence.find((e) => e.skill.name === 'Next.js')!;
    expect(nextjs).toMatchObject({ context: 'PERSONAL', workExperienceId: null, projectId: expect.any(String) });
    // A listed skill becomes a skill with no evidence, for the user to describe.
    expect(await prisma.skill.count({ where: { userId: user.id, name: 'Docker', evidence: { none: {} } } })).toBe(1);

    const done = await prisma.careerImport.findUniqueOrThrow({ where: { id: row.id } });
    expect(done).toMatchObject({ status: 'DONE', text: null });
    expect(await prisma.aiUsage.count({ where: { userId: user.id, purpose: 'IMPORT_RESUME' } })).toBe(1);
  });

  it('importing the same resume twice adds nothing new', async () => {
    const { user, svc, start } = await setup();
    await svc.run((await start()).id);
    const again = await svc.run((await start()).id);
    expect(again).toMatchObject({ status: 'DONE', created: { roles: 0, projects: 0, skills: 0, evidence: 0 } });
    expect(await prisma.workExperience.count({ where: { userId: user.id } })).toBe(1);
  });

  it('defers without a model call when over budget, and clears the text', async () => {
    const { user, reader, svc, start } = await setup();
    // This month's spend already over any budget.
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
    const row = await start();
    expect(await svc.run(row.id)).toMatchObject({ status: 'DEFERRED' });
    expect(reader.calls).toBe(0);
    expect(await prisma.careerImport.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'DEFERRED',
      text: null,
    });
  });
});
