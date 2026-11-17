import { Module } from '@nestjs/common';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';

@Module({ imports: [DiscoveryModule], controllers: [AdminController], providers: [AdminService, AdminGuard] })
export class AdminModule {}
