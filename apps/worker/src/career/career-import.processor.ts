import { Processor, WorkerHost } from '@nestjs/bullmq';
import { CAREER_QUEUE, CareerJob, type ImportResumeData } from '@shortlist/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { CareerImportService } from './career-import.service.js';

// Concurrency 1: imports are rare and user-initiated.
@Processor(CAREER_QUEUE)
export class CareerImportProcessor extends WorkerHost {
  constructor(private readonly imports: CareerImportService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== CareerJob.Import) throw new UnrecoverableError(`Unknown job "${job.name}"`);
    const { importId } = job.data as ImportResumeData;
    try {
      return await this.imports.run(importId);
    } catch (err) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.imports.fail(importId, `Couldn't reach Claude: ${(err as Error).message}`);
      }
      throw err;
    }
  }
}
