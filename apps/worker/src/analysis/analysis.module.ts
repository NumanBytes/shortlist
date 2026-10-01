import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ANALYSIS_QUEUE } from '@shortlist/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AnalysisProcessor } from './analysis.processor.js';
import { AnalysisScheduler } from './analysis.scheduler.js';
import { AnalysisService } from './analysis.service.js';
import { BudgetGuard } from './budget-guard.js';
import { AnthropicJobAnalyzer, JOB_ANALYZER } from './job-analyzer.js';

@Module({
  imports: [BullModule.registerQueue({ name: ANALYSIS_QUEUE })],
  providers: [
    AnalysisService,
    AnalysisProcessor,
    AnalysisScheduler,
    BudgetGuard,
    { provide: JOB_ANALYZER, inject: [ENV], useFactory: (env: Env) => new AnthropicJobAnalyzer(env.ANTHROPIC_API_KEY) },
  ],
  exports: [AnalysisService],
})
export class AnalysisModule {}
