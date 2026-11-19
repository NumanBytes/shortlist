import { Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { BillingController } from './billing.controller.js';
import { BILLING_PROVIDER, PaddleBillingProvider } from './billing-provider.js';
import { BillingService } from './billing.service.js';

// Payments (docs/billing.md §20). Without the PADDLE_* settings the provider is null: billing
// routes say payments aren't set up, and an admin assigns plans as before.
@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    {
      provide: BILLING_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.PADDLE_API_KEY &&
        env.PADDLE_WEBHOOK_SECRET &&
        env.PADDLE_CLIENT_TOKEN &&
        env.PADDLE_PRICE_STARTER &&
        env.PADDLE_PRICE_PRO
          ? new PaddleBillingProvider({
              PADDLE_API_KEY: env.PADDLE_API_KEY,
              PADDLE_WEBHOOK_SECRET: env.PADDLE_WEBHOOK_SECRET,
              PADDLE_CLIENT_TOKEN: env.PADDLE_CLIENT_TOKEN,
              PADDLE_PRICE_STARTER: env.PADDLE_PRICE_STARTER,
              PADDLE_PRICE_PRO: env.PADDLE_PRICE_PRO,
            })
          : null,
    },
  ],
  // Account deletion cancels a live subscription first (docs/security.md §8.8).
  exports: [BILLING_PROVIDER],
})
export class BillingModule {}
