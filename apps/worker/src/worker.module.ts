import { Module } from '@nestjs/common';
import { AnalysisModule } from './analysis/analysis.module.js';
import { ConfigModule } from './config/config.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { EmailModule } from './email/email.module.js';
import { HeartbeatModule } from './heartbeat/heartbeat.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ResumeModule } from './resume/resume.module.js';

@Module({ imports: [ConfigModule, PrismaModule, DiscoveryModule, AnalysisModule, ResumeModule, EmailModule, HeartbeatModule] })
export class WorkerModule {}
