import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { NOTIFICATIONS_QUEUE } from '@shortlist/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DigestScheduler } from './digest.scheduler.js';
import { NotificationsProcessor } from './notifications.processor.js';
import { Notifier } from './notifier.js';
import { PUSH_CLIENT, WebPushClient } from './push-client.js';

// Global: discovery, analysis, email, resume and the budget guard all report events through
// Notifier (docs/notifications.md §19.4).
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  providers: [
    Notifier,
    NotificationsProcessor,
    DigestScheduler,
    { provide: PUSH_CLIENT, inject: [ENV], useFactory: (env: Env) => new WebPushClient(env) },
  ],
  exports: [Notifier],
})
export class NotificationsModule {}
