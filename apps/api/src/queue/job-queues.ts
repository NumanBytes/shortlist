import { Inject, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import {
  ANALYSIS_QUEUE,
  AnalysisJob,
  DISCOVERY_QUEUE,
  DiscoveryJob,
  EMAIL_QUEUE,
  EmailJob,
  RESUME_QUEUE,
  ResumeJob,
  type AnalyzeJobData,
  type CheckEmailData,
  type DiscoverSourceData,
  type TailorResumeData,
} from '@shortlist/shared';
import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

// How long an HTTP request may wait on Redis. Depending on connection state, a dead
// Redis either errors immediately ("Connection is closed") or makes BullMQ wait for a
// ready connection indefinitely — both were observed. Either way the caller gets a 503.
const ENQUEUE_TIMEOUT_MS = 3000;
const UNAVAILABLE = 'Job queue unavailable — try again shortly';

const RETRY: JobsOptions = {
  attempts: 3,
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

// The API's side of the queues: it only ever ADDS jobs; apps/worker processes them.
// Custom job ids can't contain ":".
@Injectable()
export class JobQueues implements OnModuleDestroy {
  private readonly logger = new Logger(JobQueues.name);
  private readonly connection: Redis;
  private readonly discovery: Queue;
  private readonly analysis: Queue;
  private readonly resume: Queue;
  private readonly email: Queue;

  constructor(@Inject(ENV) env: Env) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    this.connection.on('error', () => undefined); // surfaced per request as a 503 instead
    this.discovery = new Queue(DISCOVERY_QUEUE, { connection: this.connection });
    this.analysis = new Queue(ANALYSIS_QUEUE, { connection: this.connection });
    this.resume = new Queue(RESUME_QUEUE, { connection: this.connection });
    this.email = new Queue(EMAIL_QUEUE, { connection: this.connection });
    for (const q of [this.discovery, this.analysis, this.resume, this.email]) q.on('error', () => undefined);
  }

  enqueueSources(sourceIds: string[], batchId: string): Promise<void> {
    return this.bounded(
      sourceIds.length === 0
        ? null
        : this.discovery.addBulk(
            sourceIds.map((sourceId) => ({
              name: DiscoveryJob.Source,
              data: { sourceId } satisfies DiscoverSourceData,
              opts: { ...RETRY, jobId: `${sourceId}__${batchId}`, backoff: { type: 'exponential', delay: 60_000 } },
            })),
          ),
    );
  }

  enqueueAnalysis(jobId: string, batchId: string): Promise<void> {
    return this.bounded(
      this.analysis.add(AnalysisJob.Job, { jobId } satisfies AnalyzeJobData, {
        ...RETRY,
        jobId: `analyze__${jobId}__${batchId}`,
        backoff: { type: 'exponential', delay: 120_000 },
        // Same dedupe id as the worker uses: if this job is already queued, in retry
        // backoff, or being analysed, "Retry" joins it instead of billing a second call.
        deduplication: { id: `analyze-${jobId}` },
      }),
    );
  }

  enqueueTailoring(jobId: string): Promise<void> {
    return this.bounded(
      this.resume.add(ResumeJob.Tailor, { jobId } satisfies TailorResumeData, {
        ...RETRY,
        jobId: `tailor__${jobId}__${Date.now()}`,
        backoff: { type: 'exponential', delay: 60_000 },
        // A double-click (or two tabs) joins the tailoring already queued or running for
        // this job instead of paying for a second one.
        deduplication: { id: `tailor-${jobId}` },
      }),
    );
  }

  enqueueEmailCheck(userId: string): Promise<void> {
    return this.bounded(
      this.email.add(EmailJob.Check, { userId } satisfies CheckEmailData, {
        ...RETRY,
        jobId: `email__${userId}__${Date.now()}`,
        backoff: { type: 'exponential', delay: 60_000 },
        // One check per mailbox at a time, whoever asks (schedule or "Check now").
        deduplication: { id: `email-${userId}` },
      }),
    );
  }

  private async bounded(add: Promise<unknown> | null): Promise<void> {
    if (!add) return;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no response from Redis in ${ENQUEUE_TIMEOUT_MS}ms`)), ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([add, timeout]);
    } catch (err) {
      this.logger.error(`Enqueue failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    } finally {
      clearTimeout(timer);
      add.catch(() => undefined); // if the timeout won, don't leave an unhandled rejection
    }
  }

  async onModuleDestroy() {
    await Promise.all([this.discovery, this.analysis, this.resume, this.email].map((q) => q.close().catch(() => undefined)));
    this.connection.disconnect();
  }
}
