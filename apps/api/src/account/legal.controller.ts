import { Controller, Get, Inject } from '@nestjs/common';
import { REFUND_WINDOW_DAYS } from '@shortlist/shared';
import { Public } from '../auth/public.decorator.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

// Who runs this server, for the public Terms, Privacy and Refund pages (docs/security.md §8.9).
// Public: Paddle's reviewers, and anyone deciding whether to sign up, read them signed out.
// `operator` is null until the LEGAL_* settings are made; the pages then say so.
@Controller('legal')
export class LegalController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Public()
  @Get()
  get() {
    const { LEGAL_NAME: name, LEGAL_ADDRESS: address, LEGAL_EMAIL: email, LEGAL_JURISDICTION: jurisdiction } = this.env;
    return {
      operator: name && address && email && jurisdiction ? { name, address, email, jurisdiction } : null,
      refundWindowDays: REFUND_WINDOW_DAYS,
      payments: Boolean(this.env.PADDLE_API_KEY),
      gmail: Boolean(this.env.GOOGLE_CLIENT_ID),
      email: Boolean(this.env.SMTP_HOST),
    };
  }
}
