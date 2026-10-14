import { Processor, WorkerHost } from '@nestjs/bullmq';
import { MAIL_QUEUE, MailJob, type SendAuthEmailData } from '@shortlist/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { AuthEmailService } from './auth-email.service.js';

// Account emails (docs/security.md §8.7). Sending is outbound I/O to a mail server, so it
// lives in the worker; a mail server that's down is retried with backoff.
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(private readonly emails: AuthEmailService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === MailJob.SendAuthEmail) return this.emails.send(job.data as SendAuthEmailData);
    throw new UnrecoverableError(`Unknown job "${job.name}"`);
  }
}
