import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CAREER_QUEUE } from '@shortlist/shared';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CareerImportProcessor } from './career-import.processor.js';
import { CareerImportService } from './career-import.service.js';
import { AnthropicResumeReader, RESUME_READER } from './resume-reader.js';

@Module({
  imports: [BullModule.registerQueue({ name: CAREER_QUEUE }), AnalysisModule],
  providers: [
    CareerImportService,
    CareerImportProcessor,
    {
      provide: RESUME_READER,
      inject: [ENV],
      useFactory: (env: Env) => new AnthropicResumeReader(env.ANTHROPIC_API_KEY),
    },
  ],
})
export class CareerModule {}
