import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AUTH_RATE_RULES, RateLimiter, type AuthRateRules, type RateDecision } from './rate-limiter.js';

// 429, carrying how long to wait; AuthController puts that in a Retry-After header.
export class TooManyRequestsException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

const minutes = (s: number) => {
  const m = Math.ceil(s / 60);
  return m <= 1 ? 'a minute' : `${m} minutes`;
};

// Emails are hashed into the key: Redis then never holds a list of addresses people tried.
const accountKey = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);

// The auth endpoints' rules (docs/security.md §8.1), in one place:
// - login: every attempt counts against the IP; FAILED attempts count against the account.
//   An exhausted account is refused before the password is even checked — that's what
//   stops guessing. The key is the email as typed, so an unknown email behaves exactly
//   like a real one and the limit can't reveal which emails have accounts. Success resets
//   the account's failures, so the real user isn't punished for earlier typos.
// - register: attempts per IP.
@Injectable()
export class AuthRateLimits {
  constructor(
    private readonly limiter: RateLimiter,
    @Inject(AUTH_RATE_RULES) private readonly rules: AuthRateRules,
  ) {}

  async beforeLogin(ip: string, email: string): Promise<void> {
    const [byIp, byAccount] = await Promise.all([
      this.limiter.hit(this.key('login-ip', ip), this.rules.loginPerIp),
      this.limiter.peek(this.key('login-fail', accountKey(email)), this.rules.loginFailuresPerAccount),
    ]);
    this.refuse(byAccount, 'Too many failed sign-in attempts for this account');
    this.refuse(byIp, 'Too many sign-in attempts');
  }

  async loginFailed(email: string): Promise<void> {
    await this.limiter.hit(this.key('login-fail', accountKey(email)), this.rules.loginFailuresPerAccount);
  }

  async loginSucceeded(email: string): Promise<void> {
    await this.limiter.reset(this.key('login-fail', accountKey(email)));
  }

  async beforeRegister(ip: string): Promise<void> {
    this.refuse(await this.limiter.hit(this.key('register-ip', ip), this.rules.registerPerIp), 'Too many sign-ups from this network');
  }

  private key(kind: string, subject: string) {
    return `${this.rules.prefix}:${kind}:${subject}`;
  }

  private refuse(d: RateDecision, what: string) {
    if (!d.allowed) throw new TooManyRequestsException(`${what} — try again in ${minutes(d.retryAfterSeconds)}.`, d.retryAfterSeconds);
  }
}

