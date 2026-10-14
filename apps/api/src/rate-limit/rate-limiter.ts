import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { withTimeout } from '../common/with-timeout.js';

export interface RateRule {
  limit: number;
  windowSeconds: number;
}

// The auth limits (docs/security.md §8.1). A security policy, so it lives in code and changes by
// review. Injected as a token so tests can swap in their own (low limits, own namespace).
export interface AuthRateRules {
  // Every login attempt from one IP: one machine trying many accounts.
  loginPerIp: RateRule;
  // FAILED logins for one email, from anywhere: one account guessed from many IPs.
  loginFailuresPerAccount: RateRule;
  registerPerIp: RateRule;
  // Account emails (docs/security.md §8.7): each one sends a real email, so they're capped
  // per address (as typed, like login — the limit can't reveal which have accounts) and per IP.
  resetRequestsPerIp: RateRule;
  resetRequestsPerAccount: RateRule;
  resetAttemptsPerIp: RateRule;
  verificationEmailsPerUser: RateRule;
  // Key namespace — lets tests isolate their counters from each other and from dev.
  prefix: string;
}

export const AUTH_RATE_RULES = Symbol('AUTH_RATE_LIMITS');

export const DEFAULT_AUTH_RATE_RULES: AuthRateRules = {
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  loginFailuresPerAccount: { limit: 10, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 5, windowSeconds: 60 * 60 },
  resetRequestsPerIp: { limit: 10, windowSeconds: 60 * 60 },
  resetRequestsPerAccount: { limit: 3, windowSeconds: 60 * 60 },
  resetAttemptsPerIp: { limit: 20, windowSeconds: 60 * 60 },
  verificationEmailsPerUser: { limit: 5, windowSeconds: 60 * 60 },
  prefix: 'shortlist:rl',
};

export interface RateDecision {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

// Fixed-window counter: INCR, and on the window's first hit set its expiry. Run as one Lua
// script so it's a single round trip and atomic — two separate commands could leave a
// counter without an expiry (process dies in between), locking that key out forever.
// Fixed windows allow up to 2x the limit across a window boundary; for slowing password
// guessing that's fine, and much simpler than a sliding log.
const HIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {n, ttl}`;

const PEEK = `
local n = tonumber(redis.call('GET', KEYS[1]) or '0')
return {n, redis.call('PTTL', KEYS[1])}`;

const TIMEOUT_MS = 1000;

// Counters in Redis (docs/architecture.md §4: "a queue, and rate-limit counters"). Losing them is
// harmless — they're short-lived by design — so nothing here belongs in Postgres.
//
// Fails OPEN: if Redis doesn't answer, the request is allowed and a warning logged. Redis
// isn't the store of record, and an outage shouldn't lock every user out; bcrypt's cost
// (~250ms per attempt) still slows guessing meanwhile.
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiter.name);
  private readonly redis: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    this.redis.on('error', () => undefined); // reported per call instead
  }

  // Counts this attempt and says whether it's within the rule.
  hit(key: string, rule: RateRule): Promise<RateDecision> {
    return this.run(HIT, key, rule, (count) => count <= rule.limit);
  }

  // Whether the rule is already exhausted, without counting anything.
  peek(key: string, rule: RateRule): Promise<RateDecision> {
    return this.run(PEEK, key, rule, (count) => count < rule.limit);
  }

  async reset(key: string): Promise<void> {
    await withTimeout(this.redis.del(key), TIMEOUT_MS).catch(() => undefined);
  }

  private async run(
    script: string,
    key: string,
    rule: RateRule,
    ok: (count: number) => boolean,
  ): Promise<RateDecision> {
    try {
      const [count, ttlMs] = (await withTimeout(
        this.redis.eval(script, 1, key, rule.windowSeconds * 1000),
        TIMEOUT_MS,
      )) as [number, number];
      return { allowed: ok(count), count, retryAfterSeconds: Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : 0) / 1000)) };
    } catch (err) {
      this.logger.warn(`Rate limiter unavailable, allowing request: ${(err as Error).message}`);
      return { allowed: true, count: 0, retryAfterSeconds: 0 };
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
