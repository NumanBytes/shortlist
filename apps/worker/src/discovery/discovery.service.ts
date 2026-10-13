import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ImplementedSourceConfigSchema, PlannedSourceConfigSchema } from '@shortlist/shared';
import type { DiscoveryRunStatus } from '@shortlist/db';
import { Notifier } from '../notifications/notifier.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CareersPageService } from './careers-page/careers-page.service.js';
import { compileFilter } from './filter.js';
import { storeJobs } from './job-store.js';
import { loadPreferences } from './preferences.js';
import type { AdapterContext, AdapterRegistry, Posting } from './types.js';

export const ADAPTER_REGISTRY = Symbol('ADAPTER_REGISTRY');

import { PermanentSourceError } from './errors.js';
export { PermanentSourceError };

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
    @Optional() private readonly careersPage?: CareersPageService,
    @Optional() private readonly notifier?: Notifier,
  ) {}

  async runSource(sourceId: string): Promise<RunSummary> {
    const source = await this.prisma.jobSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new PermanentSourceError(`JobSource ${sourceId} no longer exists`);

    // Opened BEFORE anything is fetched (docs/architecture.md §4). If the process dies mid-fetch,
    // the run is left visibly RUNNING — never silently absent, which would read as
    // "no jobs today". That exact confusion is what this table exists to prevent.
    const run = await this.prisma.discoveryRun.create({ data: { jobSourceId: source.id, status: 'RUNNING' } });

    try {
      const config = this.parseConfig(source.config);
      const filter = compileFilter(await loadPreferences(this.prisma, source.userId));
      const rejections: Record<string, number> = {};
      const count = (reason: string) => (rejections[reason] = (rejections[reason] ?? 0) + 1);

      const adapter = this.adapters[config.provider] as (c: typeof config, ctx: AdapterContext) => Promise<Posting[]>;
      const postings = await adapter(config, {
        sourceName: source.name,
        sourceId: source.id,
        userId: source.userId,
        careersPage: this.careersPage,
        onSkipped: (reason) => {
          count('invalid posting');
          this.logger.warn(`${source.name}: skipped ${reason}`);
        },
      });

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

      const stored = await storeJobs(
        this.prisma,
        { userId: source.userId, jobSourceId: source.id, discoveryRunId: run.id, provider: config.provider },
        matched,
      );
      const jobsNew = stored.newJobIds.length;
      // New jobs, plus alert-only jobs this source just completed: both need (re)analysis.
      const newJobIds = [...stored.newJobIds, ...stored.completedJobIds];
      const status: DiscoveryRunStatus = postings.length === 0 ? 'EMPTY' : 'SUCCESS';
      await this.finish(run.id, source.id, status, {
        jobsFound: postings.length,
        jobsMatched: matched.length,
        jobsNew,
      });
      this.logger.log(
        `${source.name}: ${status} — ${postings.length} found, ${matched.length} matched, ${jobsNew} new`,
      );
      return {
        runId: run.id,
        status,
        jobsFound: postings.length,
        jobsMatched: matched.length,
        jobsNew,
        newJobIds,
        rejections,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.finish(run.id, source.id, 'FAILED', { errorMessage: message.slice(0, 1000) });
      this.logger.error(`${source.name}: FAILED — ${message}`);
      await this.reportIfBroken(source, message);
      throw err;
    }
  }

  // One failure is often a blip; three runs in a row means the source is broken and the user
  // should know — a dead source otherwise looks exactly like "no new jobs" (docs/notifications.md §19.4).
  private async reportIfBroken(source: { id: string; userId: string; name: string }, message: string) {
    if (!this.notifier) return;
    const last = await this.prisma.discoveryRun.findMany({
      where: { jobSourceId: source.id },
      orderBy: { startedAt: 'desc' },
      take: 3,
      select: { status: true },
    });
    if (last.length < 3 || last.some((r) => r.status !== 'FAILED')) return;
    await this.notifier.problem(
      source.userId,
      `source-failing:${source.id}:${new Date().toISOString().slice(0, 10)}`,
      `${source.name} has failed 3 runs in a row`,
      message.slice(0, 200),
      `/sources`,
    );
  }

  private parseConfig(raw: unknown) {
    const implemented = ImplementedSourceConfigSchema.safeParse(raw);
    if (implemented.success) return implemented.data;
    const planned = PlannedSourceConfigSchema.safeParse(raw);
    if (planned.success) {
      throw new PermanentSourceError(
        `No adapter for provider "${planned.data.provider}" yet (planned for a later milestone)`,
      );
    }
    throw new PermanentSourceError(
      `Invalid source config: ${implemented.error.issues.map((i) => i.message).join('; ')}`,
    );
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
