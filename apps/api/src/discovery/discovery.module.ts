import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryService } from './discovery.service.js';
import { SearchSettingsController } from './search-settings.controller.js';
import { SearchSettingsService } from './search-settings.service.js';

@Module({
  controllers: [DiscoveryController, SearchSettingsController],
  providers: [DiscoveryService, SearchSettingsService],
})
export class DiscoveryModule {}
