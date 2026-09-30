import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { DISCOVERY_QUEUE, DiscoveryJob, type DiscoverSourceData } from '@shortlist/shared';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DiscoveryService, PermanentSourceError } from './discovery.service.js';
import { SOURCE_JOB_OPTIONS, sourceJobId } from './queue.js';

@Processor(DISCOVERY_QUEUE)
export class DiscoveryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryProcessor.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly prisma: PrismaService,
    @InjectQueue(DISCOVERY_QUEUE) private readonly queue: Queue,
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
  // itself is retried, re-adding the same ids is a no-op instead of duplicate runs.
  private async fanOut(job: Job) {
    const sources = await this.prisma.jobSource.findMany({ where: { isEnabled: true }, select: { id: true } });
    await this.queue.addBulk(
      sources.map((s) => ({
        name: DiscoveryJob.Source,
        data: { sourceId: s.id } satisfies DiscoverSourceData,
        opts: { ...SOURCE_JOB_OPTIONS, jobId: sourceJobId(s.id, job.id!) },
      })),
    );
    this.logger.log(`Queued ${sources.length} enabled sources`);
    return { enqueued: sources.length };
  }

  private async runSource(job: Job<DiscoverSourceData>) {
    try {
      return await this.discovery.runSource(job.data.sourceId);
    } catch (err) {
      // Retrying a missing adapter or bad config can't succeed — fail once, clearly.
      if (err instanceof PermanentSourceError) throw new UnrecoverableError(err.message);
      throw err;
    }
  }
}
