import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_DISCOVERY_PREFERENCES,
  ImplementedSourceConfigSchema,
  PlannedSourceConfigSchema,
  type DiscoveryPreferencesInput,
} from '@shortlist/shared';
import type { DiscoveryRunStatus } from '@shortlist/db';
import { PrismaService } from '../prisma/prisma.service.js';
import { dedupeHash } from './dedupe.js';
import { compileFilter } from './filter.js';
import type { AdapterRegistry, Posting } from './types.js';

export const ADAPTER_REGISTRY = Symbol('ADAPTER_REGISTRY');

// A failure retrying can't fix (bad config, provider not implemented yet). The
// processor turns it into a non-retried job; transient errors (timeouts, 5xx) are
// thrown as-is so the queue retries them with backoff.
export class PermanentSourceError extends Error {}

export interface RunSummary {
  runId: string;
  status: DiscoveryRunStatus;
  jobsFound: number;
  jobsMatched: number;
  jobsNew: number;
  newJobIds: string[]; // handed to the analysis queue
  rejections: Record<string, number>; // reason -> count, for tuning the filter
}

// Descriptions that cost a request are fetched a few at a time, never all at once.
const DESCRIPTION_CONCURRENCY = 4;

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  async runSource(sourceId: string): Promise<RunSummary> {
    const source = await this.prisma.jobSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new PermanentSourceError(`JobSource ${sourceId} no longer exists`);

    // Opened BEFORE anything is fetched (Agents.md §4). If the process dies mid-fetch,
    // the run is left visibly RUNNING — never silently absent, which would read as
    // "no jobs today". That exact confusion is what this table exists to prevent.
    const run = await this.prisma.discoveryRun.create({ data: { jobSourceId: source.id, status: 'RUNNING' } });

    try {
      const config = this.parseConfig(source.config);
      const filter = compileFilter(await this.preferencesFor(source.userId));
      const rejections: Record<string, number> = {};
      const count = (reason: string) => (rejections[reason] = (rejections[reason] ?? 0) + 1);

      const adapter = this.adapters[config.provider] as (c: typeof config, ctx: { sourceName: string }) => Promise<Posting[]>;
      const postings = await adapter(config, { sourceName: source.name });

      // Stage A: title / location / age, from the listing alone.
      const enforceMaxAge = source.type === 'AGGREGATOR_API';
      const shortlisted = postings.filter((p) => {
        const v = filter.screenListing(p, { enforceMaxAge });
        if (!v.pass) count(v.reason);
        return v.pass;
      });

      // Stage B: core-stack keywords — needs the description (maybe one request each).
      const matched: { posting: Posting; description: string }[] = [];
      await forEachLimited(shortlisted, DESCRIPTION_CONCURRENCY, async (p) => {
        let description: string;
        try {
          description = p.description ?? (await p.loadDescription?.()) ?? '';
        } catch (err) {
          // One posting's detail page failing shouldn't sink the whole source.
          this.logger.warn(`${source.name}: description for "${p.title}" failed: ${(err as Error).message}`);
          count('description fetch failed');
          return;
        }
        const v = filter.screenDescription(p, description);
        if (v.pass) matched.push({ posting: p, description });
        else count(v.reason);
      });

      const newJobIds = await this.store({ userId: source.userId, jobSourceId: source.id, discoveryRunId: run.id, provider: config.provider }, matched);
      const jobsNew = newJobIds.length;
      const status: DiscoveryRunStatus = postings.length === 0 ? 'EMPTY' : 'SUCCESS';
      await this.finish(run.id, source.id, status, {
        jobsFound: postings.length,
        jobsMatched: matched.length,
        jobsNew,
      });
      this.logger.log(
        `${source.name}: ${status} — ${postings.length} found, ${matched.length} matched, ${jobsNew} new`,
      );
      return { runId: run.id, status, jobsFound: postings.length, jobsMatched: matched.length, jobsNew, newJobIds, rejections };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.finish(run.id, source.id, 'FAILED', { errorMessage: message.slice(0, 1000) });
      this.logger.error(`${source.name}: FAILED — ${message}`);
      throw err;
    }
  }

  private parseConfig(raw: unknown) {
    const implemented = ImplementedSourceConfigSchema.safeParse(raw);
    if (implemented.success) return implemented.data;
    const planned = PlannedSourceConfigSchema.safeParse(raw);
    if (planned.success) {
      throw new PermanentSourceError(`No adapter for provider "${planned.data.provider}" yet (planned for a later milestone)`);
    }
    throw new PermanentSourceError(`Invalid source config: ${implemented.error.issues.map((i) => i.message).join('; ')}`);
  }

  private async preferencesFor(userId: string): Promise<DiscoveryPreferencesInput> {
    const row = await this.prisma.discoveryPreferences.findUnique({ where: { userId } });
    if (!row) return DEFAULT_DISCOVERY_PREFERENCES;
    const { id: _id, userId: _u, updatedAt: _t, ...prefs } = row;
    return prefs;
  }

  // Inserts matched postings not seen before; bumps lastSeenAt on ones that were.
  // Returns the IDs of the new ones.
  private async store(
    ctx: { userId: string; jobSourceId: string; discoveryRunId: string; provider: string },
    matched: { posting: Posting; description: string }[],
  ): Promise<string[]> {
    const { userId } = ctx;
    if (matched.length === 0) return [];

    // The same posting can appear twice within one source; keep the first.
    const byHash = new Map<string, { posting: Posting; description: string }>();
    for (const m of matched) {
      const hash = dedupeHash(m.posting.company, m.posting.title);
      if (!byHash.has(hash)) byHash.set(hash, m);
    }
    const hashes = [...byHash.keys()];
    const existing = new Set(
      (
        await this.prisma.job.findMany({
          where: { userId, dedupeHash: { in: hashes } },
          select: { dedupeHash: true },
        })
      ).map((j) => j.dedupeHash),
    );

    const [created] = await this.prisma.$transaction([
      this.prisma.job.createManyAndReturn({
        data: hashes
          .filter((h) => !existing.has(h))
          .map((h) => {
            const { posting: p, description } = byHash.get(h)!;
            return {
              userId,
              jobSourceId: ctx.jobSourceId,
              discoveryRunId: ctx.discoveryRunId,
              dedupeHash: h,
              title: p.title,
              company: p.company,
              location: p.location,
              workMode: p.workMode,
              source: ctx.provider, // shown as attribution ("via Remote OK")
              sourceUrl: p.url,
              rawJD: description,
              postedAt: p.postedAt,
            };
          }),
        // Another source for the same user may insert the same hash concurrently; the
        // unique index decides, and the loser simply counts it as not new.
        skipDuplicates: true,
        select: { id: true },
      }),
      this.prisma.job.updateMany({
        where: { userId, dedupeHash: { in: [...existing] } },
        data: { lastSeenAt: new Date() },
      }),
    ]);
    return created.map((j) => j.id);
  }

  private async finish(
    runId: string,
    sourceId: string,
    status: DiscoveryRunStatus,
    data: { jobsFound?: number; jobsMatched?: number; jobsNew?: number; errorMessage?: string },
  ) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.discoveryRun.update({ where: { id: runId }, data: { status, finishedAt: now, ...data } }),
      this.prisma.jobSource.update({ where: { id: sourceId }, data: { lastRunAt: now, lastRunStatus: status } }),
    ]);
  }
}

async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}
