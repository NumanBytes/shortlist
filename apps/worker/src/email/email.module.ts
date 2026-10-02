import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { EMAIL_QUEUE, EmailJob } from '@shortlist/shared';
import { HttpGmailApi, HttpGoogleOAuth, SecretBox } from '@shortlist/shared/node';
import type { Queue } from 'bullmq';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailProcessor } from './email.processor.js';
import { EmailService, SECRET_BOX, WORKER_GMAIL_API, WORKER_GOOGLE_OAUTH } from './email.service.js';

export const EMAIL_SCHEDULER_ID = 'gmail-check';

// Same pattern as discovery (§9.8): the schedule lives in Redis, upserted idempotently.
@Injectable()
export class EmailScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailScheduler.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      EMAIL_SCHEDULER_ID,
      { pattern: this.env.GMAIL_CHECK_CRON, tz: this.env.DISCOVERY_TZ },
      { name: EmailJob.CheckAll, data: {}, opts: { attempts: 2 } },
    );
    if (!this.env.GOOGLE_CLIENT_ID) this.logger.warn('GOOGLE_* not set — Gmail job alerts are off');
    this.logger.log(`Gmail checks "${this.env.GMAIL_CHECK_CRON}" (${this.env.DISCOVERY_TZ})`);
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [
    EmailService,
    EmailProcessor,
    EmailScheduler,
    {
      provide: WORKER_GOOGLE_OAUTH,
      inject: [ENV],
      // Refreshing a token needs no redirect URI; it's only part of the consent step.
      useFactory: (env: Env) =>
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? new HttpGoogleOAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: '' })
          : null,
    },
    { provide: WORKER_GMAIL_API, useValue: new HttpGmailApi() },
    { provide: SECRET_BOX, inject: [ENV], useFactory: (env: Env) => (env.TOKEN_ENCRYPTION_KEY ? new SecretBox(env.TOKEN_ENCRYPTION_KEY) : null) },
  ],
})
export class EmailModule {}
