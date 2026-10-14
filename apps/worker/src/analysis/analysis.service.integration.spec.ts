import { PrismaService } from '../prisma/prisma.service.js';
import { AnalysisService, PermanentAnalysisError } from './analysis.service.js';
import { BudgetGuard } from './budget-guard.js';
import { OutOfCreditError, type AnalyzerResult, type JobAnalyzer } from './job-analyzer.js';

process.loadEnvFile(); // DATABASE_URL from apps/worker/.env

const prisma = new PrismaService();
const createdUsers: string[] = [];

// A fake Claude: records every prompt and returns whatever the test scripts.
class FakeAnalyzer implements JobAnalyzer {
  configured = true;
  prompts: { system: string; user: string }[] = [];
  next: (prompt: { user: string }) => Partial<AnalyzerResult> | Error | Promise<Partial<AnalyzerResult>> = () => ({});
  async analyze(prompt: { system: string; user: string }): Promise<AnalyzerResult> {
    this.prompts.push(prompt);
    const r = await this.next(prompt);
    if (r instanceof Error) throw r;
    return {
      model: 'claude-haiku-4-5-20251001',
      text: '{}',
      stopReason: 'end_turn',
      usage: { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ...r,
    };
  }
}

// Turns "the ref for React" into "S<n>" using the prompt the service actually built.
const refFor = (user: string, name: string) => new RegExp(`(S\\d+): ${name} \\(`).exec(user)?.[1] ?? 'S999';

const output = (user: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    seniority: 'MID',
    yearsRequired: 2,
    redFlags: [],
    requirements: [
      {
        skill: 'React',
        importance: 'REQUIRED',
        isCore: true,
        yearsRequired: null,
        sameAs: [refFor(user, 'React')],
        relatedTo: [],
      },
      {
        skill: 'TypeScript',
        importance: 'REQUIRED',
        isCore: false,
        yearsRequired: null,
        sameAs: [refFor(user, 'TypeScript')],
        relatedTo: [],
      },
      { skill: 'GraphQL', importance: 'PREFERRED', isCore: false, yearsRequired: null, sameAs: [], relatedTo: [] },
    ],
    ...over,
  });

async function setup() {
  const user = await prisma.user.create({
    data: { email: `analysis-${crypto.randomUUID()}@e2e.shortlist.test`, name: 'Analysis Test', passwordHash: 'x' },
  });
  createdUsers.push(user.id);
  const role = await prisma.workExperience.create({
    data: {
      userId: user.id,
      company: 'CloudCard Inc.',
      title: 'Frontend Developer',
      startDate: new Date('2024-05-01'),
      isCurrent: true,
    },
  });
  const skill = async (name: string, verified: boolean, context: 'COMMERCIAL' | 'PERSONAL' = 'COMMERCIAL') =>
    prisma.skill.create({
      data: {
        userId: user.id,
        name,
        category: 'LIBRARY',
        evidence: {
          create: {
            context,
            depth: 'PRODUCTION',
            whatIDid: `Used ${name}`,
            lastUsed: new Date(),
            workExperienceId: context === 'COMMERCIAL' ? role.id : undefined,
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
    },
  });
  return { user, job, react, ts };
}

function service(analyzer = new FakeAnalyzer()) {
  return { svc: new AnalysisService(prisma, new BudgetGuard(prisma), analyzer), analyzer };
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe('AnalysisService.analyzeJob', () => {
  it('never sends unverified evidence to the model', async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({ text: output(p.user) });
    await svc.analyzeJob(job.id);
    expect(analyzer.prompts[0]!.user).toContain('React');
    expect(analyzer.prompts[0]!.user).not.toContain('Azure');
  });

  it('stores requirements, a code-computed score, gaps, and logs the cost', async () => {
    const { job, react } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({ text: output(p.user) });
    const outcome = await svc.analyzeJob(job.id);

    expect(outcome).toMatchObject({ status: 'DONE', verdict: 'APPLY' });
    const stored = await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
      include: { requirements: true, match: { include: { gaps: true } } },
    });
    expect(stored).toMatchObject({ analysisStatus: 'DONE', seniority: 'MID', yearsRequired: 2 });
    expect(stored.requirements.find((r) => r.skillName === 'React')!.matchedSkillIds).toEqual([react.id]);
    expect(stored.match!.gaps).toEqual([expect.objectContaining({ skillName: 'GraphQL', severity: 'MINOR' })]);
    expect(stored.match!.strengths[0]).toMatch(/React — React \(commercial production, CloudCard Inc\.\)/);

    const usage = await prisma.aiUsage.findFirstOrThrow({ where: { jobId: job.id } });
    expect(usage).toMatchObject({ purpose: 'ANALYZE_JOB', inputTokens: 2000, outputTokens: 400, succeeded: true });
    expect(Number(usage.costUsd)).toBeCloseTo(0.004); // 2000 × $1/M + 400 × $5/M
  });

  it("drops references the model invents — it can't add a skill", async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({
      text: output(p.user, {
        requirements: [
          {
            skill: 'Azure B2C',
            importance: 'REQUIRED',
            isCore: true,
            yearsRequired: null,
            sameAs: ['S42'],
            relatedTo: [],
          },
        ],
      }),
    });
    await svc.analyzeJob(job.id);
    const r = await prisma.jobRequirement.findFirstOrThrow({ where: { jobId: job.id } });
    expect(r.matchedSkillIds).toEqual([]);
    const match = await prisma.jobMatch.findUniqueOrThrow({ where: { jobId: job.id }, include: { gaps: true } });
    expect(match.gaps[0]).toMatchObject({ skillName: 'Azure B2C', severity: 'BLOCKING' });
  });

  it('counts an identically named skill as the same even when the model says "related"', async () => {
    const { job, react } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({
      text: output(p.user, {
        requirements: [
          {
            skill: 'React',
            importance: 'REQUIRED',
            isCore: true,
            yearsRequired: null,
            sameAs: [],
            relatedTo: [refFor(p.user, 'React')],
          },
        ],
      }),
    });
    await svc.analyzeJob(job.id);
    const r = await prisma.jobRequirement.findFirstOrThrow({ where: { jobId: job.id } });
    expect(r).toMatchObject({ matchedSkillIds: [react.id], relatedSkillIds: [] });
  });

  it('defers without calling the model when the monthly budget is spent', async () => {
    const { user, job } = await setup();
    await prisma.aiSettings.create({ data: { userId: user.id, maxAnalysesPerDay: 40, monthlyBudgetUsd: 0.01 } });
    await prisma.aiUsage.create({
      data: {
        userId: user.id,
        purpose: 'ANALYZE_JOB',
        model: 'claude-haiku-4-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.02,
        succeeded: true,
      },
    });
    const { svc, analyzer } = service();
    const outcome = await svc.analyzeJob(job.id);
    expect(outcome).toMatchObject({ status: 'DEFERRED', reason: expect.stringMatching(/Monthly AI budget reached/) });
    expect(analyzer.prompts).toHaveLength(0);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).analysisStatus).toBe('DEFERRED');
  });

  it('defers once the daily analysis cap is reached', async () => {
    const { user, job } = await setup();
    await prisma.aiSettings.create({ data: { userId: user.id, maxAnalysesPerDay: 1, monthlyBudgetUsd: 5 } });
    await prisma.aiUsage.create({
      data: {
        userId: user.id,
        purpose: 'ANALYZE_JOB',
        model: 'claude-haiku-4-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.001,
        succeeded: true,
      },
    });
    const { svc, analyzer } = service();
    expect(await svc.analyzeJob(job.id)).toMatchObject({
      status: 'DEFERRED',
      reason: expect.stringMatching(/Daily analysis cap/),
    });
    expect(analyzer.prompts).toHaveLength(0);
  });

  it('lets a job the user asked about past the daily cap, but not past the monthly budget', async () => {
    const { user, job } = await setup();
    await prisma.aiSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, maxAnalysesPerDay: 0, monthlyBudgetUsd: 5 },
      update: { maxAnalysesPerDay: 0, monthlyBudgetUsd: 5 },
    });
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({ text: output(p.user) });
    expect(await svc.analyzeJob(job.id, { requestedByUser: true })).toMatchObject({ status: 'DONE' });
    expect(analyzer.prompts).toHaveLength(1);

    const other = await prisma.job.create({
      data: { userId: user.id, title: 'Other', company: 'Co', rawJD: 'React', dedupeHash: `h-${Date.now()}` },
    });
    await prisma.aiSettings.update({ where: { userId: user.id }, data: { monthlyBudgetUsd: 0 } });
    expect(await svc.analyzeJob(other.id, { requestedByUser: true })).toMatchObject({
      status: 'DEFERRED',
      reason: expect.stringMatching(/Monthly AI budget/),
    });
  });

  it('defers (no spend) when the user has no verified evidence', async () => {
    const { user, job } = await setup();
    await prisma.skillEvidence.updateMany({ where: { skill: { userId: user.id } }, data: { isVerified: false } });
    const { svc, analyzer } = service();
    expect(await svc.analyzeJob(job.id)).toMatchObject({
      status: 'DEFERRED',
      reason: expect.stringMatching(/No verified evidence/),
    });
    expect(analyzer.prompts).toHaveLength(0);
  });

  it('defers when no API key is configured', async () => {
    const { job } = await setup();
    const analyzer = new FakeAnalyzer();
    analyzer.configured = false;
    expect(await service(analyzer).svc.analyzeJob(job.id)).toMatchObject({ status: 'DEFERRED' });
    expect(analyzer.prompts).toHaveLength(0);
  });

  it('defers (not fails) when the account is out of credit, so a top-up resumes it', async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = () => new OutOfCreditError('Anthropic credit balance is too low');
    expect(await svc.analyzeJob(job.id)).toMatchObject({ status: 'DEFERRED', reason: expect.stringMatching(/credit/) });
  });

  it('invalid model output: logs the billed call, marks FAILED, and does not retry', async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = () => ({ text: '{"seniority":"WIZARD"}' });
    await expect(svc.analyzeJob(job.id)).rejects.toBeInstanceOf(PermanentAnalysisError);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).analysisStatus).toBe('FAILED');
    expect(await prisma.aiUsage.findFirstOrThrow({ where: { jobId: job.id } })).toMatchObject({ succeeded: false });
  });

  it('truncated output (max_tokens) is rejected, not half-stored', async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({ text: output(p.user), stopReason: 'max_tokens' });
    await expect(svc.analyzeJob(job.id)).rejects.toThrow(/cut off/);
    expect(await prisma.jobRequirement.count({ where: { jobId: job.id } })).toBe(0);
  });

  it('a transient error propagates for the queue to retry, leaving the job PENDING', async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = () => new Error('529 overloaded');
    await expect(svc.analyzeJob(job.id)).rejects.toThrow('529');
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).analysisStatus).toBe('PENDING');
  });

  it('is idempotent: an analysed job is not analysed (or billed) again', async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({ text: output(p.user) });
    await svc.analyzeJob(job.id);
    expect(await svc.analyzeJob(job.id)).toMatchObject({ status: 'SKIPPED' });
    expect(analyzer.prompts).toHaveLength(1);
  });

  it('analyses again when the description is pasted while the model is reading the old one', async () => {
    const { job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = async (p) => {
      // First call: the user pastes the full posting mid-run (JobsService.pasteDescription).
      if (analyzer.prompts.length === 1) {
        await prisma.job.update({
          where: { id: job.id },
          data: { rawJD: 'Full posting: React, TypeScript, Kubernetes.', analysisStatus: 'PENDING' },
        });
      }
      return { text: output(p.user) };
    };

    const outcome = await svc.analyzeJob(job.id);

    expect(outcome).toMatchObject({ status: 'DONE' });
    expect(analyzer.prompts).toHaveLength(2);
    expect(analyzer.prompts[1]!.user).toContain('Kubernetes');
    // Both calls were billed, so both are logged.
    expect(await prisma.aiUsage.count({ where: { jobId: job.id } })).toBe(2);
  });
});

describe('AnalysisService.rescoreUser', () => {
  it('re-scores from the stored mapping when evidence changes — with no model call', async () => {
    const { user, job, react } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({ text: output(p.user) });
    await svc.analyzeJob(job.id);
    const before = await prisma.jobMatch.findUniqueOrThrow({ where: { jobId: job.id } });

    // The user un-verifies their React evidence.
    await prisma.skillEvidence.updateMany({ where: { skillId: react.id }, data: { isVerified: false } });
    expect(await svc.rescoreUser(user.id)).toEqual({ rescored: 1, needsReanalysis: [] });

    const after = await prisma.jobMatch.findUniqueOrThrow({ where: { jobId: job.id }, include: { gaps: true } });
    expect(after.overallScore).toBeLessThan(before.overallScore);
    expect(after.gaps.map((g) => g.skillName)).toContain('React');
    expect(analyzer.prompts).toHaveLength(1); // only the original analysis
  });

  it('sends a job back for ONE fresh analysis when the user verifies a skill the model never saw', async () => {
    const { user, job } = await setup();
    const { svc, analyzer } = service();
    analyzer.next = (p) => ({ text: output(p.user) });
    await svc.analyzeJob(job.id);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).analyzedSkillIds).toHaveLength(2);

    // The user verifies their (previously unverified) Azure-named skill... any new skill.
    await prisma.skillEvidence.updateMany({
      where: { skill: { userId: user.id, name: 'Azure B2C' } },
      data: { isVerified: true },
    });
    expect(await svc.rescoreUser(user.id)).toEqual({ rescored: 0, needsReanalysis: [job.id] });
    const pending = await prisma.job.findUniqueOrThrow({ where: { id: job.id }, include: { match: true } });
    expect(pending.analysisStatus).toBe('PENDING');
    expect(pending.match).not.toBeNull(); // the old score stays visible meanwhile

    await svc.analyzeJob(job.id);
    expect(analyzer.prompts).toHaveLength(2);
    expect(analyzer.prompts[1]!.user).toContain('Azure B2C'); // now verified, so now shown
  });
});
