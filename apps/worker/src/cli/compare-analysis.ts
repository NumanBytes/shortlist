// Development helper: score the same real jobs with several models / effort levels and compare,
// WITHOUT saving anything to the jobs — for measuring a model change before making it
// (docs/ai-scoring.md §12.6).
//
//   pnpm --filter @shortlist/worker compare:analysis [jobs=12]
//
// Every call is real and logged to AiUsage (≈ $0.006 per job on Haiku 4.5, ≈ $0.0006 on Haiku 5.5).
// The current model runs twice, so its own run-to-run disagreement is the noise floor that the
// candidates are judged against.
import { loadEnv } from '../config/env.js';
import { BudgetGuard } from '../analysis/budget-guard.js';
import { AnalysisService } from '../analysis/analysis.service.js';
import { AnthropicJobAnalyzer } from '../analysis/job-analyzer.js';
import { PrismaService } from '../prisma/prisma.service.js';

const VARIANTS = [
  { label: 'haiku-4.5', model: 'claude-haiku-4-5', effort: null },
  { label: 'haiku-4.5 again', model: 'claude-haiku-4-5', effort: null },
  { label: 'haiku-5.5 low', model: 'claude-haiku-5-5', effort: 'low' },
  { label: 'haiku-5.5 medium', model: 'claude-haiku-5-5', effort: 'medium' },
] as const;

const n = Number(process.argv[2] ?? 12);
const env = loadEnv();
if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in apps/worker/.env');
const prisma = new PrismaService();
const service = new AnalysisService(prisma, new BudgetGuard(prisma), null as never);

type Run = Awaited<ReturnType<AnalysisService['preview']>>;
const matched = (r: Run) => (r.ok ? new Set(r.requirements.flatMap((q) => q.matchedSkillIds)) : new Set<string>());
const jaccard = (a: Set<string>, b: Set<string>) => {
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / union.size;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

try {
  const jobs = await prisma.job.findMany({
    where: { analysisStatus: 'DONE', isPartial: false },
    orderBy: { analyzedAt: 'desc' },
    take: n,
    select: { id: true, title: true, company: true },
  });
  console.log(`Comparing ${jobs.length} jobs × ${VARIANTS.length} runs\n`);
  const runs = new Map<string, Run[]>(VARIANTS.map((v) => [v.label, []]));
  for (const job of jobs) {
    const row: string[] = [];
    for (const v of VARIANTS) {
      const run = await service.preview(job.id, new AnthropicJobAnalyzer(env.ANTHROPIC_API_KEY, v));
      runs.get(v.label)!.push(run);
      row.push(run.ok ? `${run.score.overallScore} ${run.score.verdict}` : `FAILED (${run.stopReason})`);
    }
    console.log(`${`${job.title} @ ${job.company}`.slice(0, 48).padEnd(48)}  ${row.join('  |  ')}`);
  }

  const base = runs.get(VARIANTS[0].label)!;
  console.log('\nAgainst the first haiku-4.5 run (the second haiku-4.5 run is the noise floor):\n');
  console.log('variant            failed  |Δscore|  same verdict  skill overlap  out tokens  $/job      seconds');
  for (const v of VARIANTS) {
    const list = runs.get(v.label)!;
    const pairs = list.map((r, i) => [base[i]!, r] as const).filter(([a, b]) => a.ok && b.ok);
    const delta = pairs.map(([a, b]) => (a.ok && b.ok ? Math.abs(a.score.overallScore - b.score.overallScore) : 0));
    const sameVerdict = pairs.filter(([a, b]) => a.ok && b.ok && a.score.verdict === b.score.verdict).length;
    const overlap = pairs.map(([a, b]) => jaccard(matched(a), matched(b)));
    console.log(
      [
        v.label.padEnd(17),
        String(list.filter((r) => !r.ok).length).padStart(6),
        mean(delta).toFixed(1).padStart(8),
        `${sameVerdict}/${pairs.length}`.padStart(13),
        mean(overlap).toFixed(2).padStart(14),
        mean(list.map((r) => r.usage.outputTokens))
          .toFixed(0)
          .padStart(11),
        mean(list.map((r) => r.costUsd))
          .toFixed(5)
          .padStart(9),
        (mean(list.map((r) => r.ms)) / 1000).toFixed(1).padStart(10),
      ].join('  '),
    );
  }
  const total = [...runs.values()].flat().reduce((s, r) => s + r.costUsd, 0);
  console.log(`\nTotal spent: $${total.toFixed(4)}`);
  for (const [label, list] of runs) for (const r of list) if (!r.ok) console.log(`${label} failure: ${r.reason}`);
} finally {
  await prisma.$disconnect();
}
