import type { PrismaService } from '../prisma/prisma.service.js';
import { dedupeHash } from './dedupe.js';
import type { Posting } from './types.js';

export interface StoreItem {
  posting: Posting;
  description: string;
  // Only an alert's summary is known (docs/email-alerts.md §10.5); the full description comes later.
  partial?: boolean;
}

export interface StoreContext {
  userId: string;
  jobSourceId: string;
  discoveryRunId: string;
  provider: string; // shown as attribution ("via Indeed")
}

export interface StoreResult {
  newJobIds: string[];
  // Jobs that were only partial and now have their full description from this source —
  // they need analysing again, with the real text.
  completedJobIds: string[];
}

// Shared by board discovery and email alerts: inserts postings not seen before (by
// normalized company + title, docs/discovery.md §9.7), bumps lastSeenAt on ones that were, and
// fills in the description of a partial (alert-only) job when a source finally has it.
export async function storeJobs(prisma: PrismaService, ctx: StoreContext, items: StoreItem[]): Promise<StoreResult> {
  if (items.length === 0) return { newJobIds: [], completedJobIds: [] };
  const { userId } = ctx;

  // The same posting can appear twice within one source; keep the first.
  const byHash = new Map<string, StoreItem>();
  for (const item of items) {
    const hash = dedupeHash(item.posting.company, item.posting.title);
    if (!byHash.has(hash)) byHash.set(hash, item);
  }
  const existing = await prisma.job.findMany({
    where: { userId, dedupeHash: { in: [...byHash.keys()] } },
    select: { id: true, dedupeHash: true, isPartial: true, salary: true },
  });
  const existingByHash = new Map(existing.map((j) => [j.dedupeHash, j]));

  // A partial job meets a source with the full description: fill it in, analyse again.
  const completions = existing.filter((j) => {
    const item = byHash.get(j.dedupeHash)!;
    return j.isPartial && !item.partial && item.description.trim().length > 0;
  });

  const [created] = await prisma.$transaction([
    prisma.job.createManyAndReturn({
      data: [...byHash]
        .filter(([h]) => !existingByHash.has(h))
        .map(([h, { posting: p, description, partial }]) => ({
          userId,
          jobSourceId: ctx.jobSourceId,
          discoveryRunId: ctx.discoveryRunId,
          dedupeHash: h,
          title: p.title,
          company: p.company,
          location: p.location,
          workMode: p.workMode,
          source: ctx.provider,
          sourceUrl: p.url,
          rawJD: description,
          isPartial: partial ?? false,
          salary: p.salary ?? null,
          postedAt: p.postedAt,
        })),
      // Another source for the same user may insert the same hash concurrently; the
      // unique index decides, and the loser simply counts it as not new.
      skipDuplicates: true,
      select: { id: true },
    }),
    prisma.job.updateMany({
      where: { userId, dedupeHash: { in: existing.map((j) => j.dedupeHash) } },
      data: { lastSeenAt: new Date() },
    }),
    ...completions.map((j) =>
      prisma.job.update({
        where: { id: j.id },
        data: {
          rawJD: byHash.get(j.dedupeHash)!.description,
          isPartial: false,
          analysisStatus: 'PENDING',
          analysisError: 'Full description found on another source — scoring again',
        },
      }),
    ),
    // A salary from any source beats none.
    ...existing
      .filter((j) => !j.salary && byHash.get(j.dedupeHash)!.posting.salary)
      .map((j) => prisma.job.update({ where: { id: j.id }, data: { salary: byHash.get(j.dedupeHash)!.posting.salary } })),
  ]);
  return { newJobIds: created.map((j) => j.id), completedJobIds: completions.map((j) => j.id) };
}
