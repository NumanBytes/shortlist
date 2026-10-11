import { Inject, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import {
  ANALYSIS_QUEUE,
  AnalysisJob,
  DISCOVERY_QUEUE,
  DiscoveryJob,
  EMAIL_QUEUE,
  EmailJob,
  NIGHTLY_DISCOVERY_SCHEDULER_ID,
  RESUME_QUEUE,
  WORKER_HEARTBEAT_KEY,
  ResumeJob,
  dedupeId,
  queueJobOptions,
  type AnalyzeJobData,
  type CheckEmailData,
  type DiscoverSourceData,
  type TailorResumeData,
} from '@shortlist/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { withTimeout } from '../common/with-timeout.js';

// How long an HTTP request may wait on Redis (see withTimeout). A queue that doesn't
// answer in time is a 503, not a hung request.
const REDIS_TIMEOUT_MS = 3000;
const UNAVAILABLE = 'Job queue unavailable — try again shortly';

// The API's side of the queues: it only ever ADDS jobs; apps/worker processes them. Job ids,
// dedupe ids and retry options come from queueJobOptions (@shortlist/shared), shared with
// the worker: a second tap, two tabs or the nightly run all join the job already queued or
// running for the same thing instead of running — or paying — twice.
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
              // Joining matters here: lastRunAt only moves on when a run finishes, so the
              // cooldown alone can't stop a pile-up while the worker is busy or stopped.
              opts: queueJobOptions.discoverSource(sourceId, batchId),
            })),
          ),
    );
  }

  enqueueAnalysis(jobId: string, batchId: string): Promise<void> {
    return this.bounded(
      this.analysis.add(AnalysisJob.Job, { jobId } satisfies AnalyzeJobData, queueJobOptions.analyzeJob(jobId, batchId)),
    );
  }

  enqueueTailoring(jobId: string): Promise<void> {
    return this.bounded(
      this.resume.add(ResumeJob.Tailor, { jobId } satisfies TailorResumeData, queueJobOptions.tailorResume(jobId, String(Date.now()))),
    );
  }

  enqueueEmailCheck(userId: string): Promise<void> {
    return this.bounded(
      this.email.add(EmailJob.Check, { userId } satisfies CheckEmailData, queueJobOptions.checkEmail(userId, String(Date.now()))),
    );
  }

  private async bounded(add: Promise<unknown> | null): Promise<void> {
    if (!add) return;
    try {
      await withTimeout(add, REDIS_TIMEOUT_MS);
    } catch (err) {
      this.logger.error(`Enqueue failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  // "Cancel" on a tailoring run (Agents.md §13.1). A job still waiting (or in retry
  // backoff) is removed, so the model is never called. One the worker has started can't be
  // recalled — its Claude call is already in flight — so say so instead of pretending.
  async cancelTailoring(jobId: string): Promise<'removed' | 'running' | 'none'> {
    const attempt = (async () => {
      const id = await this.resume.getDeduplicationJobId(dedupeId.tailorResume(jobId));
      const job = id ? await this.resume.getJob(id) : undefined;
      if (!job) return 'none' as const;
      const state = await job.getState();
      if (state === 'active') return 'running' as const;
      if (state === 'completed' || state === 'failed') return 'none' as const;
      try {
        await job.remove(); // fails if the worker locked it a moment ago
      } catch {
        return 'running' as const;
      }
      await this.resume.removeDeduplicationKey(dedupeId.tailorResume(jobId));
      return 'removed' as const;
    })();
    try {
      return await withTimeout(attempt, REDIS_TIMEOUT_MS);
    } catch (err) {
      this.logger.error(`Cancel failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  // Is a worker consuming the queues? Its heartbeat key (written by apps/worker) exists
  // only while one runs. Read-only and best effort: null when Redis can't answer, so a
  // status view says "unknown" instead of failing the request.
  async workerOnline(): Promise<boolean | null> {
    const beat = await this.read(this.connection.get(WORKER_HEARTBEAT_KEY));
    return beat === undefined ? null : beat !== null;
  }

  // When the nightly discovery fires next (the scheduler lives in Redis, Agents.md §9.8).
  async nextNightlyDiscovery(): Promise<Date | null> {
    const scheduler = await this.read(this.discovery.getJobScheduler(NIGHTLY_DISCOVERY_SCHEDULER_ID));
    return scheduler?.next ? new Date(scheduler.next) : null;
  }

  // A read bounded like an enqueue; undefined (not a 503) when Redis doesn't answer.
  private async read<T>(op: Promise<T>): Promise<T | undefined> {
    return withTimeout(op, REDIS_TIMEOUT_MS).catch(() => undefined);
  }

  async onModuleDestroy() {
    await Promise.all([this.discovery, this.analysis, this.resume, this.email].map((q) => q.close().catch(() => undefined)));
    this.connection.disconnect();
  }
}
