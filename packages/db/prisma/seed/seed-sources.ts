// Seeds the job sources (job-sources.ts) into an EXISTING account.
//
//   SEED_USER_EMAIL=you@example.com pnpm --filter @shortlist/db db:seed:sources [--dry-run]
//
// Additive and safe to re-run: sources are matched on their stable key, and existing
// rows are left untouched — so enabling/disabling a source by hand is never undone.
import { PrismaClient } from '@prisma/client';
import { JobSourceConfigSchema } from '@shortlist/shared';
import { JOB_SOURCES } from './job-sources.ts';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const email = process.env.SEED_USER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('Set SEED_USER_EMAIL to the account to seed.');

  // Every config must match the shape the worker will validate before each run.
  const invalid = JOB_SOURCES.flatMap((s) => {
    const r = JobSourceConfigSchema.safeParse(s.config);
    return r.success ? [] : [`${s.key}: ${r.error.issues.map((i) => i.message).join('; ')}`];
  });
  const keys = JOB_SOURCES.map((s) => s.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (invalid.length || dupes.length) {
    throw new Error(`Refusing to seed:\n  ${[...invalid, ...dupes.map((d) => `duplicate key ${d}`)].join('\n  ')}`);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account for ${email}. Register it through the API first.`);

    const existing = new Set(
      (await prisma.jobSource.findMany({ where: { userId: user.id }, select: { key: true } })).map((s) => s.key),
    );
    const toCreate = JOB_SOURCES.filter((s) => !existing.has(s.key));

    if (!dryRun) {
      await prisma.jobSource.createMany({
        data: toCreate.map((s) => ({
          userId: user.id,
          key: s.key,
          name: s.name,
          type: s.type,
          config: s.config,
          isEnabled: s.enabled,
        })),
      });
    }
    const enabled = toCreate.filter((s) => s.enabled).length;
    console.log(`${dryRun ? 'Dry run — would create' : 'Created'} for ${email}:`);
    console.log(
      `  ${toCreate.length} sources (${enabled} enabled, ${toCreate.length - enabled} recorded for later milestones)`,
    );
    console.log(`  ${JOB_SOURCES.length - toCreate.length} already present (left untouched)`);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
