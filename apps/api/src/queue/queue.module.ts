import { Global, Module } from '@nestjs/common';
import { DiscoveryQueue } from './discovery-queue.js';

@Global()
@Module({ providers: [DiscoveryQueue], exports: [DiscoveryQueue] })
export class QueueModule {}
