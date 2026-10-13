import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ANALYSIS_QUEUE, DISCOVERY_QUEUE } from '@shortlist/shared';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ADAPTERS } from './adapters/index.js';
import { CareersPageService } from './careers-page/careers-page.service.js';
import { AnthropicCareersPageExtractor, CAREERS_PAGE_EXTRACTOR } from './careers-page/extractor.js';
import { ADAPTER_REGISTRY, DiscoveryService } from './discovery.service.js';
import { DiscoveryProcessor } from './discovery.processor.js';
import { DiscoveryScheduler } from './discovery.scheduler.js';

@Module({
  // AnalysisModule for BudgetGuard: reading a careers page is a model call (docs/discovery.md §9.14).
  imports: [BullModule.registerQueue({ name: DISCOVERY_QUEUE }, { name: ANALYSIS_QUEUE }), AnalysisModule],
  providers: [
    DiscoveryService,
    DiscoveryProcessor,
    DiscoveryScheduler,
    CareersPageService,
    {
      provide: CAREERS_PAGE_EXTRACTOR,
      inject: [ENV],
      useFactory: (env: Env) => new AnthropicCareersPageExtractor(env.ANTHROPIC_API_KEY),
    },
    // Injected (not imported directly) so tests can swap in fake sources.
    { provide: ADAPTER_REGISTRY, useValue: ADAPTERS },
  ],
})
export class DiscoveryModule {}
