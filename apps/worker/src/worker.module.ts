import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalysisModule } from './analysis/analysis.module.js';
import { CareerModule } from './career/career.module.js';
import { ConfigModule, ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { EmailModule } from './email/email.module.js';
import { HeartbeatModule } from './heartbeat/heartbeat.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { createRedis } from './redis.js';
import { ResumeModule } from './resume/resume.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    // One Redis connection for every queue, so no feature module depends on another to set it up.
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ connection: createRedis(env.REDIS_URL) }),
    }),
    NotificationsModule,
    DiscoveryModule,
    AnalysisModule,
    ResumeModule,
    EmailModule,
    CareerModule,
    HeartbeatModule,
  ],
})
export class WorkerModule {}
