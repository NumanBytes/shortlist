import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { GmailModule } from '../gmail/gmail.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { LegalController } from './legal.controller.js';

// The user's data rights and the public policy details (docs/security.md §8.8, §8.9).
@Module({
  imports: [BillingModule, GmailModule, RateLimitModule],
  controllers: [AccountController, LegalController],
  providers: [AccountService],
})
export class AccountModule {}
