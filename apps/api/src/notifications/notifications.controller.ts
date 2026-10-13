import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  NotificationSettingsSchema,
  SubscribePushSchema,
  UnsubscribePushSchema,
  type NotificationSettingsInput,
  type SubscribePushInput,
  type UnsubscribePushInput,
} from '@shortlist/shared';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('config')
  config() {
    return this.notifications.config();
  }

  @Post('subscriptions')
  subscribe(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(SubscribePushSchema)) body: SubscribePushInput) {
    return this.notifications.subscribe(user.id, body);
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UnsubscribePushSchema)) body: UnsubscribePushInput,
  ) {
    return this.notifications.unsubscribe(user.id, body.endpoint);
  }

  @Get('devices')
  devices(@CurrentUser() user: AuthUser) {
    return this.notifications.devices(user.id);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDevice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.removeDevice(user.id, id);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.notifications.settings(user.id);
  }

  @Put('settings')
  saveSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(NotificationSettingsSchema)) body: NotificationSettingsInput,
  ) {
    return this.notifications.saveSettings(user.id, body);
  }

  // 202: queued for the worker.
  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  test(@CurrentUser() user: AuthUser) {
    return this.notifications.test(user.id);
  }

  @Get()
  recent(@CurrentUser() user: AuthUser) {
    return this.notifications.recent(user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.readAll(user.id);
  }
}
