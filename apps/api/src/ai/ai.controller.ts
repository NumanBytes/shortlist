import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateAiSettingsSchema, type UpdateAiSettingsInput } from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('usage')
  usage(@CurrentUser() user: AuthUser) {
    return this.ai.usage(user.id);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateAiSettingsSchema)) body: UpdateAiSettingsInput,
  ) {
    return this.ai.updateSettings(user.id, body);
  }
}
