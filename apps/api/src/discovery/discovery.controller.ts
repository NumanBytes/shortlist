import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UpdateJobSourceSchema, type UpdateJobSourceInput } from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DiscoveryService } from './discovery.service.js';

@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('sources')
  sources(@CurrentUser() user: AuthUser) {
    return this.discovery.listSources(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.discovery.status(user.id);
  }

  @Patch('sources/:id')
  setEnabled(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateJobSourceSchema)) body: UpdateJobSourceInput,
  ) {
    return this.discovery.setEnabled(user.id, id, body);
  }

  // 202: queued for the worker.
  @Post('sources/:id/run')
  @HttpCode(HttpStatus.ACCEPTED)
  runOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.discovery.runOne(user.id, id);
  }

  // 202: the work happens later, in the worker.
  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(@CurrentUser() user: AuthUser) {
    return this.discovery.runNow(user.id);
  }
}
