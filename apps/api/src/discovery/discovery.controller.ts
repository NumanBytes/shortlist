import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  AddSourceSchema,
  type AddSourceInput,
  UpdateJobSourceSchema,
  UpdateSourceAddressSchema,
  type UpdateJobSourceInput,
  type UpdateSourceAddressInput,
} from '@shortlist/shared';
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

  @Post('sources')
  add(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(AddSourceSchema)) body: AddSourceInput) {
    return this.discovery.addSource(user.id, body);
  }

  @Delete('sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.discovery.removeSource(user.id, id);
  }

  @Patch('sources/:id')
  setEnabled(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateJobSourceSchema)) body: UpdateJobSourceInput,
  ) {
    return this.discovery.setEnabled(user.id, id, body);
  }

  @Patch('sources/:id/address')
  setAddress(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSourceAddressSchema)) body: UpdateSourceAddressInput,
  ) {
    return this.discovery.setAddress(user.id, id, body);
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
