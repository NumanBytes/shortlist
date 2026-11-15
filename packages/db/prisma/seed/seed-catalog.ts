// Seeds the shared source catalog (docs/discovery.md §9.16) from job-sources.ts.
//
//   pnpm --filter @shortlist/db db:seed:catalog [--dry-run]
//
// Replaces seeding each account (the old db:seed:sources): users now follow entries from the
// app. Additive and safe to re-run: entries are matched on their key and existing ones are
// left alone, so an admin's later edits (a fixed address, a hidden entry) are never undone.
// Only sources the worker can run are added; disabled and planned ones stay in job-sources.ts.
// Accounts that already watch a source at the same address become its followers.
import { PrismaClient } from '@prisma/client';
import { ImplementedSourceConfigSchema } from '@shortlist/shared';
import { JOB_SOURCES } from './job-sources.ts';

const dryRun = process.argv.includes('--dry-run');

// Same address whatever the key order (JSONB doesn't keep it).
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

async function main() {
  const keys = JOB_SOURCES.map((s) => s.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) throw new Error(`Refusing to seed: duplicate keys ${dupes.join(', ')}`);
  const runnable = JOB_SOURCES.filter((s) => s.enabled && ImplementedSourceConfigSchema.safeParse(s.config).success);

  const prisma = new PrismaClient();
  try {
    const existing = new Set((await prisma.sourceCatalogEntry.findMany({ select: { key: true } })).map((e) => e.key));
    const toCreate = runnable.filter((s) => !existing.has(s.key));
    let linked = 0;
    if (!dryRun) {
      await prisma.sourceCatalogEntry.createMany({
        data: toCreate.map((s) => ({ key: s.key, name: s.name, type: s.type, config: s.config, regions: s.regions })),
      });
      const entries = await prisma.sourceCatalogEntry.findMany({ select: { id: true, key: true, config: true } });
      const orphans = await prisma.jobSource.findMany({
        where: { catalogEntryId: null, key: { in: entries.map((e) => e.key) } },
        select: { id: true, key: true, config: true },
      });
      for (const source of orphans) {
        const entry = entries.find((e) => e.key === source.key);
        if (entry && same(entry.config, source.config)) {
          await prisma.jobSource.update({ where: { id: source.id }, data: { catalogEntryId: entry.id } });
          linked++;
        }
      }
    }
    console.log(`${dryRun ? 'Dry run — would add' : 'Added'} ${toCreate.length} catalog entries`);
    console.log(`  ${runnable.length - toCreate.length} already in the catalog (left untouched)`);
    console.log(`  ${JOB_SOURCES.length - runnable.length} not runnable yet (kept in job-sources.ts only)`);
    if (!dryRun) console.log(`  ${linked} existing account sources linked as followers`);
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
