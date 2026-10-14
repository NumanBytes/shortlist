import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string; // user id
  // Email verified (docs/security.md §8.7). In the token so the guard can refuse an
  // unverified account without a database read on every request; a new token (refresh)
  // picks up a change within the 15-minute lifetime. Tokens from before this claim existed
  // count as verified — every account then was.
  ev: boolean;
}

@Injectable()
export class TokensService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  signAccessToken(userId: string, emailVerified: boolean): string {
    return jwt.sign({ ev: emailVerified }, this.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
    });
  }

  // Throws if the token is malformed, expired, or signed with anything else.
  verifyAccessToken(token: string): AccessTokenPayload {
    // Pinning `algorithms` is what stops a forged token from choosing its own
    // algorithm (e.g. "none", or RS256 with our secret treated as a public key).
    const payload = jwt.verify(token, this.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new Error('Access token has no subject');
    }
    return { sub: payload.sub, ev: payload.ev !== false };
  }

  // Refresh tokens are opaque random strings, not JWTs: the server has to look them
  // up anyway (to check revocation), so there's nothing a self-describing token adds.
  generateRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    return { token, tokenHash: this.hashRefreshToken(token), expiresAt };
  }

  // SHA-256, not bcrypt: the input is 256 bits of randomness, so there's no dictionary
  // to attack and slow hashing buys nothing. A deterministic hash is also what lets us
  // find the row by its unique `tokenHash` index. Only the hash is stored, so a
  // database leak doesn't hand out usable sessions.
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
