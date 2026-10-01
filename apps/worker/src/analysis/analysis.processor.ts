import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { ANALYSIS_QUEUE, AnalysisJob, type AnalyzeJobData } from '@shortlist/shared';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnalysisService, PermanentAnalysisError } from './analysis.service.js';
import { BudgetGuard } from './budget-guard.js';

export const ANALYZE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 120_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 2000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly analysis: AnalysisService,
    private readonly budget: BudgetGuard,
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYSIS_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  onModuleInit() {
    this.worker.concurrency = this.env.ANALYSIS_CONCURRENCY;
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case AnalysisJob.Job:
        try {
          return await this.analysis.analyzeJob((job.data as AnalyzeJobData).jobId);
        } catch (err) {
          if (err instanceof PermanentAnalysisError) throw new UnrecoverableError(err.message);
          throw err;
        }
      case AnalysisJob.Sweep:
        return this.sweep(job);
      default:
        throw new UnrecoverableError(`Unknown job "${job.name}"`);
    }
  }

  // Nightly, per user: re-score analysed jobs (free — no model call), then queue pending
  // and deferred jobs up to what's left of the daily cap, newest first.
  private async sweep(job: Job) {
    const users = await this.prisma.job.groupBy({
      by: ['userId'],
      where: { analysisStatus: { in: ['PENDING', 'DEFERRED', 'DONE'] } },
    });
    let queued = 0;
    let rescored = 0;
    for (const { userId } of users) {
      rescored += await this.analysis.rescoreUser(userId);
      const settings = await this.budget.settingsFor(userId);
      const room = Math.max(0, settings.maxAnalysesPerDay - (await this.budget.analysesLastDay(userId)));
      if (room === 0) continue;
      const pending = await this.prisma.job.findMany({
        where: { userId, analysisStatus: { in: ['PENDING', 'DEFERRED'] } },
        orderBy: { discoveredAt: 'desc' },
        take: room,
        select: { id: true },
      });
      await enqueueAnalyses(this.queue, pending.map((p) => p.id), `sweep-${job.id}`);
      queued += pending.length;
    }
    this.logger.log(`Analysis sweep: ${queued} queued, ${rescored} re-scored`);
    return { queued, rescored };
  }
}

// Job ids include the batch so a job deferred today can be queued again tomorrow,
// while a retried batch re-adding the same ids is a no-op. (No ":" allowed in ids.)
export async function enqueueAnalyses(queue: Queue, jobIds: string[], batchId: string) {
  if (jobIds.length === 0) return;
  await queue.addBulk(
    jobIds.map((jobId) => ({
      name: AnalysisJob.Job,
      data: { jobId } satisfies AnalyzeJobData,
      opts: { ...ANALYZE_JOB_OPTIONS, jobId: `analyze__${jobId}__${batchId}` },
    })),
  );
}
