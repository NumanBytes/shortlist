import { ResumeContentSchema } from '@shortlist/shared';
import { BudgetGuard } from '../analysis/budget-guard.js';
import { OutOfCreditError, type AnalyzerResult } from '../analysis/job-analyzer.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ResumeWriter } from './resume-writer.js';
import { PermanentTailorError, ResumeService } from './resume.service.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];

// A fake Claude: records every prompt and returns whatever the test scripts.
class FakeWriter implements ResumeWriter {
  configured = true;
  prompts: { system: string; user: string }[] = [];
  next: (prompt: { user: string }) => Partial<AnalyzerResult> | Error = () => ({});
  async write(prompt: { system: string; user: string }): Promise<AnalyzerResult> {
    this.prompts.push(prompt);
    const r = this.next(prompt);
    if (r instanceof Error) throw r;
    return {
      model: 'claude-sonnet-5-5-20260901',
      text: '{}',
      stopReason: 'end_turn',
      usage: { inputTokens: 5000, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ...r,
    };
  }
}

// "the ref for React" → "E<n>" / "S<n>", from the prompt the service actually built.
const eRef = (user: string, name: string) => new RegExp(`(E\\d+) \\[[^\\]]*\\] ${name} —`).exec(user)?.[1] ?? 'E999';
const sRef = (user: string, name: string) => new RegExp(`(S\\d+): ${name} —`).exec(user)?.[1] ?? 'S999';

const output = (user: string) =>
  JSON.stringify({
    experience: [
      {
        role: 'R1',
        bullets: [
          { label: 'Frontend', text: 'Built frontend features in React that shipped to production.', evidence: [eRef(user, 'React')] },
          { label: null, text: 'Built frontend features with GraphQL.', evidence: [eRef(user, 'React')] }, // uncited GraphQL
        ],
      },
    ],
    projects: [],
    skillGroups: [{ label: 'Frontend', skills: [sRef(user, 'React'), sRef(user, 'TypeScript')] }],
    learning: [],
  });

async function setup() {
  const user = await prisma.user.create({
    data: { email: `resume-${crypto.randomUUID()}@e2e.shortlist.test`, name: 'Resume Test', passwordHash: 'x' },
  });
  createdUsers.push(user.id);
  const role = await prisma.workExperience.create({
    data: { userId: user.id, company: 'CloudCard Inc.', title: 'Software Engineer', startDate: new Date('2024-05-01'), isCurrent: true },
  });
  const skill = (name: string, verified: boolean) =>
    prisma.skill.create({
      data: {
        userId: user.id,
        name,
        category: 'LIBRARY',
        evidence: {
          create: {
            context: 'COMMERCIAL',
            depth: 'PRODUCTION',
            whatIDid: `Used ${name} to build frontend features that shipped to production.`,
            lastUsed: new Date(),
            workExperienceId: role.id,
            isVerified: verified,
            verifiedAt: verified ? new Date() : null,
          },
        },
      },
      include: { evidence: true },
    });
  const react = await skill('React', true);
  const ts = await skill('TypeScript', true);
  await skill('Azure B2C', false); // UNVERIFIED — must never reach the model
  const job = await prisma.job.create({
    data: {
      userId: user.id,
      title: 'Frontend Engineer',
      company: 'Kwanso',
      rawJD: 'React, TypeScript, GraphQL a plus.',
      dedupeHash: crypto.randomUUID(),
      analysisStatus: 'DONE',
      requirements: {
        create: [
          { skillName: 'React', importance: 'REQUIRED', isCore: true, matchedSkillIds: [] },
          { skillName: 'GraphQL', importance: 'PREFERRED', isCore: false },
        ],
      },
      resume: { create: { status: 'PENDING' } },
    },
  });
  return { user, job, react, ts };
}

const service = (writer = new FakeWriter()) => ({ svc: new ResumeService(prisma, new BudgetGuard(prisma), writer), writer });

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe('ResumeService.tailor', () => {
  it('sends verified evidence only, stores a checked DRAFT variant, and logs the cost first', async () => {
    const { job, react, ts } = await setup();
    const { svc, writer } = service();
    writer.next = (p) => ({ text: output(p.user) });

    const outcome = await svc.tailor(job.id);

    expect(writer.prompts[0]!.user).toContain('React');
    expect(writer.prompts[0]!.user).not.toContain('Azure');
    expect(outcome).toMatchObject({ status: 'READY', bullets: 1, dropped: 1 });

    const record = await prisma.jobResume.findUniqueOrThrow({ where: { jobId: job.id }, include: { variant: true } });
    expect(record).toMatchObject({ status: 'READY', reused: false, error: null });
    const v = record.variant!;
    expect(v.status).toBe('DRAFT');
    expect(v.requirementProfile).toEqual(['graphql', 'react']);
    expect([...v.evidenceIds].sort()).toEqual([react.evidence[0]!.id, ts.evidence[0]!.id].sort());
    const content = ResumeContentSchema.parse(v.content);
    expect(content.experience[0]!.bullets).toEqual([
      { label: 'Frontend', text: 'Built frontend features in React that shipped to production.', evidenceIds: [react.evidence[0]!.id] },
    ]);
    expect(content.dropped[0]!.reason).toBe('mentions GraphQL without citing evidence for it');

    const usage = await prisma.aiUsage.findFirstOrThrow({ where: { jobId: job.id } });
    expect(usage).toMatchObject({ purpose: 'TAILOR_RESUME', succeeded: true });
    expect(Number(usage.costUsd)).toBeCloseTo(0.025); // 5000 × $2/M + 1500 × $10/M
  });

  it('runs only for a job that is waiting to be tailored', async () => {
    const { job } = await setup();
    await prisma.jobResume.update({ where: { jobId: job.id }, data: { status: 'READY' } });
    const { svc, writer } = service();
    expect(await svc.tailor(job.id)).toMatchObject({ status: 'SKIPPED' });
    expect(writer.prompts).toHaveLength(0);
  });

  it('defers (never drops) over budget, without calling the model', async () => {
    const { user, job } = await setup();
    await prisma.aiSettings.create({ data: { userId: user.id, maxAnalysesPerDay: 40, monthlyBudgetUsd: 0 } });
    const { svc, writer } = service();
    expect(await svc.tailor(job.id)).toMatchObject({ status: 'DEFERRED' });
    expect(writer.prompts).toHaveLength(0);
    expect(await prisma.jobResume.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ status: 'DEFERRED' });
  });

  it('defers when out of credit', async () => {
    const { job } = await setup();
    const { svc, writer } = service();
    writer.next = () => new OutOfCreditError('top up');
    expect(await svc.tailor(job.id)).toMatchObject({ status: 'DEFERRED', reason: 'top up' });
  });

  it('fails permanently on invalid output — but the billed call is still logged', async () => {
    const { job } = await setup();
    const { svc, writer } = service();
    writer.next = () => ({ text: '{"experience": "nope"}' });
    await expect(svc.tailor(job.id)).rejects.toBeInstanceOf(PermanentTailorError);
    expect(await prisma.jobResume.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ status: 'FAILED' });
    expect(await prisma.aiUsage.findFirstOrThrow({ where: { jobId: job.id } })).toMatchObject({ succeeded: false });
  });

  it('fails, storing nothing, when no bullet survives the checks', async () => {
    const { job } = await setup();
    const { svc, writer } = service();
    writer.next = () => ({
      text: JSON.stringify({
        experience: [{ role: 'R1', bullets: [{ label: null, text: 'Led a team of 12 on Azure.', evidence: ['E1'] }] }],
        projects: [],
        skillGroups: [],
        learning: [],
      }),
    });
    expect(await svc.tailor(job.id)).toMatchObject({ status: 'FAILED' });
    expect(await prisma.resumeVariant.count({ where: { userId: job.userId } })).toBe(0);
  });
});
