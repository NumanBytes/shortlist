import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({ imports: [ConfigModule, PrismaModule, DiscoveryModule] })
export class WorkerModule {}
