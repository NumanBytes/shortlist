import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MAIL_QUEUE } from '@shortlist/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AuthEmailService } from './auth-email.service.js';
import { MailProcessor } from './mail.processor.js';
import { MAILER, SmtpMailer } from './mailer.js';

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [
    AuthEmailService,
    MailProcessor,
    { provide: MAILER, inject: [ENV], useFactory: (env: Env) => new SmtpMailer(env) },
  ],
})
export class MailModule {}
