import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CatalogQuerySchema, FollowPlacesSchema, type CatalogQuery, type FollowPlacesInput } from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';

// Browsing and following the shared source catalog (docs/discovery.md §9.16). Managing it is
// the admin's (AdminController).
@Controller('discovery/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  browse(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(CatalogQuerySchema)) query: CatalogQuery) {
    return this.catalog.browse(user.id, query);
  }

  @Post(':id/follow')
  follow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.follow(user.id, id);
  }

  @Post('follow-places')
  followPlaces(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(FollowPlacesSchema)) body: FollowPlacesInput,
  ) {
    return this.catalog.followPlaces(user.id, body.regions);
  }
}
