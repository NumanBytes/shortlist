import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EMAIL_QUEUE, EmailJob, queueJobOptions, type CheckEmailData } from '@shortlist/shared';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import { EmailService, PermanentEmailError } from './email.service.js';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly email: EmailService,
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case EmailJob.CheckAll: {
        const userIds = await this.email.activeUserIds();
        await this.queue.addBulk(
          userIds.map((userId) => ({
            name: EmailJob.Check,
            data: { userId } satisfies CheckEmailData,
            opts: queueJobOptions.checkEmail(userId, String(job.id)),
          })),
        );
        this.logger.log(`Email check queued for ${userIds.length} mailbox(es)`);
        return { queued: userIds.length };
      }
      case EmailJob.Check: {
        const { userId } = job.data as CheckEmailData;
        try {
          return await this.email.check(userId);
        } catch (err) {
          if (err instanceof PermanentEmailError) throw new UnrecoverableError(err.message);
          // Out of retries on a transient error: say so on the connection, not just in logs.
          if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await this.email.failed(userId, `Couldn't reach Gmail: ${(err as Error).message}`);
          throw err;
        }
      }
      default:
        throw new UnrecoverableError(`Unknown job "${job.name}"`);
    }
  }
}
