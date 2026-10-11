import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ANALYSIS_QUEUE, DISCOVERY_QUEUE } from '@shortlist/shared';
import { ADAPTERS } from './adapters/index.js';
import { ADAPTER_REGISTRY, DiscoveryService } from './discovery.service.js';
import { DiscoveryProcessor } from './discovery.processor.js';
import { DiscoveryScheduler } from './discovery.scheduler.js';

@Module({
  imports: [BullModule.registerQueue({ name: DISCOVERY_QUEUE }, { name: ANALYSIS_QUEUE })],
  providers: [
    DiscoveryService,
    DiscoveryProcessor,
    DiscoveryScheduler,
    // Injected (not imported directly) so tests can swap in fake sources.
    { provide: ADAPTER_REGISTRY, useValue: ADAPTERS },
  ],
})
export class DiscoveryModule {}
