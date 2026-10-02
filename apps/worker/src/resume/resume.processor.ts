import { Processor, WorkerHost } from '@nestjs/bullmq';
import { RESUME_QUEUE, ResumeJob, type TailorResumeData } from '@shortlist/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { PermanentTailorError, ResumeService } from './resume.service.js';

// Concurrency 1: tailoring is user-initiated and rare; there's nothing to parallelise.
@Processor(RESUME_QUEUE)
export class ResumeProcessor extends WorkerHost {
  constructor(private readonly resumes: ResumeService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== ResumeJob.Tailor) throw new UnrecoverableError(`Unknown job "${job.name}"`);
    const { jobId } = job.data as TailorResumeData;
    try {
      return await this.resumes.tailor(jobId);
    } catch (err) {
      if (err instanceof PermanentTailorError) throw new UnrecoverableError(err.message);
      // Last attempt of a transient failure: say so, or the job would show "Tailoring…"
      // forever while nothing is queued.
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.resumes.fail(jobId, `Couldn't reach Claude: ${(err as Error).message}`);
      }
      throw err;
    }
  }
}
