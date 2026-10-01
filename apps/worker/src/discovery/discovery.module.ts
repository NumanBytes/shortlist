import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ANALYSIS_QUEUE, DISCOVERY_QUEUE } from '@shortlist/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ADAPTERS } from './adapters/index.js';
import { ADAPTER_REGISTRY, DiscoveryService } from './discovery.service.js';
import { DiscoveryProcessor } from './discovery.processor.js';
import { DiscoveryScheduler } from './discovery.scheduler.js';
import { createRedis } from './queue.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ connection: createRedis(env.REDIS_URL) }),
    }),
    BullModule.registerQueue({ name: DISCOVERY_QUEUE }, { name: ANALYSIS_QUEUE }),
  ],
  providers: [
    DiscoveryService,
    DiscoveryProcessor,
    DiscoveryScheduler,
    // Injected (not imported directly) so tests can swap in fake sources.
    { provide: ADAPTER_REGISTRY, useValue: ADAPTERS },
  ],
})
export class DiscoveryModule {}
