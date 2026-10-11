import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { ANALYSIS_QUEUE, DISCOVERY_QUEUE, DiscoveryJob, queueJobOptions, type DiscoverSourceData } from '@shortlist/shared';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { enqueueAnalyses } from '../analysis/analysis.processor.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DiscoveryService, PermanentSourceError } from './discovery.service.js';

@Processor(DISCOVERY_QUEUE)
export class DiscoveryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryProcessor.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly prisma: PrismaService,
    @InjectQueue(DISCOVERY_QUEUE) private readonly queue: Queue,
    @InjectQueue(ANALYSIS_QUEUE) private readonly analysisQueue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  onModuleInit() {
    this.worker.concurrency = this.env.WORKER_CONCURRENCY;
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case DiscoveryJob.All:
        return this.fanOut(job);
      case DiscoveryJob.Source:
        return this.runSource(job as Job<DiscoverSourceData>);
      default:
        throw new UnrecoverableError(`Unknown job "${job.name}"`);
    }
  }

  // One job per enabled source, so a slow or failing source retries on its own and
  // never holds up the others. Job ids derive from this batch's id: if the fan-out job
  // itself is retried, re-adding the same ids is a no-op instead of duplicate runs. A
  // source already queued or running (a "Find new jobs" tap) is joined, not run twice.
  private async fanOut(job: Job) {
    const sources = await this.prisma.jobSource.findMany({ where: { isEnabled: true, type: { not: 'EMAIL_INBOX' } }, select: { id: true } });
    await this.queue.addBulk(
      sources.map((s) => ({
        name: DiscoveryJob.Source,
        data: { sourceId: s.id } satisfies DiscoverSourceData,
        opts: queueJobOptions.discoverSource(s.id, job.id!),
      })),
    );
    this.logger.log(`Queued ${sources.length} enabled sources`);
    return { enqueued: sources.length };
  }

  private async runSource(job: Job<DiscoverSourceData>) {
    try {
      const summary = await this.discovery.runSource(job.data.sourceId);
      // New jobs go straight to analysis; the budget guard decides there, per job. If
      // queuing them fails, the run itself still succeeded — failing it here would retry
      // the fetch, record a spurious FAILED run, and find no "new" jobs the second time.
      // The nightly sweep picks up anything left PENDING.
      try {
        await enqueueAnalyses(this.analysisQueue, summary.newJobIds, `new-${job.id}`);
      } catch (err) {
        this.logger.warn(`Couldn't queue ${summary.newJobIds.length} new jobs for analysis: ${(err as Error).message}`);
      }
      return summary;
    } catch (err) {
      // Retrying a missing adapter or bad config can't succeed — fail once, clearly.
      if (err instanceof PermanentSourceError) throw new UnrecoverableError(err.message);
      throw err;
    }
  }
}
