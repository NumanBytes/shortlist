import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RESUME_QUEUE } from '@shortlist/shared';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AnthropicResumeWriter, RESUME_WRITER } from './resume-writer.js';
import { ResumeProcessor } from './resume.processor.js';
import { ResumeService } from './resume.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: RESUME_QUEUE }), AnalysisModule],
  providers: [
    ResumeService,
    ResumeProcessor,
    {
      provide: RESUME_WRITER,
      inject: [ENV],
      useFactory: (env: Env) => new AnthropicResumeWriter(env.ANTHROPIC_API_KEY),
    },
  ],
})
export class ResumeModule {}
