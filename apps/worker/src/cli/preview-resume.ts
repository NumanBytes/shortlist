// Development helper: tailor a resume for one job and print it, WITHOUT saving it — for
// tuning the tailoring prompt against real output (docs/resume.md §13.1).
//   pnpm --filter @shortlist/worker preview:resume <jobId>
//
// The model call is real (≈ $0.03–0.05): budget-checked and logged to AiUsage like any
// other. The job's own resume and its status are left untouched.
import { loadEnv } from '../config/env.js';
import { BudgetGuard } from '../analysis/budget-guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnthropicResumeWriter } from '../resume/resume-writer.js';
import { PermanentTailorError, ResumeService } from '../resume/resume.service.js';

const [jobId] = process.argv.slice(2);
if (!jobId) {
  console.error('Usage: preview:resume <jobId>');
  process.exit(1);
}
const env = loadEnv();
const prisma = new PrismaService();
const resumes = new ResumeService(prisma, new BudgetGuard(prisma), new AnthropicResumeWriter(env.ANTHROPIC_API_KEY));

try {
  const draft = await resumes.preview(jobId).catch((err: unknown) => {
    if (err instanceof PermanentTailorError && err.rawOutput) console.error(`Raw model output:\n${err.rawOutput}\n`);
    throw err;
  });
  if (draft.status !== 'READY') {
    console.error(`${draft.status}: ${draft.reason}`);
    process.exitCode = 1;
  } else {
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
    const counts: number[] = [];
    const print = (heading: string, bullets: { label: string | null; text: string }[]) => {
      console.log(`\n${heading}`);
      for (const b of bullets) {
        counts.push(words(b.text));
        console.log(`  ● [${words(b.text)}w] ${b.label ? `${b.label}: ` : ''}${b.text}`);
      }
    };
    for (const r of draft.content.experience) print(`${r.title} | ${r.company}`, r.bullets);
    for (const p of draft.content.projects) print(p.name, p.bullets);
    for (const d of draft.content.dropped) console.log(`\n  ✗ removed (${d.reason}): ${d.text}`);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    console.log(`\n${counts.length} bullets · average ${avg.toFixed(1)} words · longest ${Math.max(...counts)} · $${draft.cost.toFixed(4)} · not saved`);
  }
} finally {
  await prisma.$disconnect();
}
