import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryService } from './discovery.service.js';
import { SearchSettingsController } from './search-settings.controller.js';
import { SearchSettingsService } from './search-settings.service.js';

@Module({
  controllers: [DiscoveryController, SearchSettingsController, CatalogController],
  providers: [DiscoveryService, SearchSettingsService, CatalogService],
  // The admin's catalog routes (AdminModule) use the same service.
  exports: [CatalogService],
})
export class DiscoveryModule {}
