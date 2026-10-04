import { Module } from '@nestjs/common';
import { AuthRateLimits } from './auth-rate-limits.js';
import { AUTH_RATE_RULES, DEFAULT_AUTH_RATE_RULES, RateLimiter } from './rate-limiter.js';

@Module({
  providers: [RateLimiter, AuthRateLimits, { provide: AUTH_RATE_RULES, useValue: DEFAULT_AUTH_RATE_RULES }],
  exports: [AuthRateLimits],
})
export class RateLimitModule {}
