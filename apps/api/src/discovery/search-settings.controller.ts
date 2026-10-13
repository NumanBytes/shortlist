import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { DiscoveryPreferencesSchema, type DiscoveryPreferencesInput } from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { SearchSettingsService } from './search-settings.service.js';

@Controller()
export class SearchSettingsController {
  constructor(private readonly settings: SearchSettingsService) {}

  @Get('discovery/preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.settings.preferences(user.id);
  }

  // The whole set at once: it's one form, and a partial update could leave the filter
  // in a state the user never saw.
  @Put('discovery/preferences')
  save(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DiscoveryPreferencesSchema)) body: DiscoveryPreferencesInput,
  ) {
    return this.settings.savePreferences(user.id, body);
  }

  @Post('discovery/sources/remote-boards')
  addRemoteBoards(@CurrentUser() user: AuthUser) {
    return this.settings.addRemoteBoards(user.id);
  }

  @Get('onboarding')
  onboarding(@CurrentUser() user: AuthUser) {
    return this.settings.onboarding(user.id);
  }
}
