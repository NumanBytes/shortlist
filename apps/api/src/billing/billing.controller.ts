import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ChangePlanSchema, CheckoutSchema, type ChangePlanInput, type CheckoutInput } from '@shortlist/shared';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { BillingService } from './billing.service.js';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.billing.status(user.id);
  }

  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CheckoutSchema)) body: CheckoutInput) {
    return this.billing.checkout(user.id, body.plan);
  }

  // 202: the change is billed by the provider and arrives with its webhook.
  @Post('change-plan')
  @HttpCode(HttpStatus.ACCEPTED)
  changePlan(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ChangePlanSchema)) body: ChangePlanInput) {
    return this.billing.changePlan(user.id, body.plan);
  }

  @Post('portal')
  portal(@CurrentUser() user: AuthUser) {
    return this.billing.portal(user.id);
  }

  // Called by Paddle, not by a user: public, and proven by its signature instead (docs/billing.md
  // §20.3). The signature covers the exact bytes sent, so it's checked on the raw body — the app
  // keeps it (`rawBody: true`). 200 tells Paddle to stop retrying.
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('paddle-signature') signature: string | undefined) {
    return this.billing.webhook(signature, req.rawBody);
  }
}
