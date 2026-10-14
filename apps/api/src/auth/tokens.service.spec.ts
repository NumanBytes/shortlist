import jwt from 'jsonwebtoken';
import type { Env } from '../config/env.js';
import { TokensService } from './tokens.service.js';

const env = {
  JWT_ACCESS_SECRET: 's'.repeat(32),
  JWT_ACCESS_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
} as Env;

describe('TokensService', () => {
  const tokens = new TokensService(env);

  it('round-trips an access token to its user id and email-verified flag', () => {
    expect(tokens.verifyAccessToken(tokens.signAccessToken('user-1', true))).toEqual({ sub: 'user-1', ev: true });
    expect(tokens.verifyAccessToken(tokens.signAccessToken('user-1', false))).toEqual({ sub: 'user-1', ev: false });
  });

  // Tokens issued before the claim existed belong to accounts that were all verified.
  it('reads a token without the claim as verified', () => {
    const old = jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: 'user-1', algorithm: 'HS256' });
    expect(tokens.verifyAccessToken(old)).toEqual({ sub: 'user-1', ev: true });
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({}, 'x'.repeat(32), { subject: 'user-1', algorithm: 'HS256' });
    expect(() => tokens.verifyAccessToken(forged)).toThrow();
  });

  it('rejects an unsigned "alg: none" token', () => {
    const unsigned = jwt.sign({ sub: 'user-1' }, '', { algorithm: 'none' });
    expect(() => tokens.verifyAccessToken(unsigned)).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_ACCESS_SECRET, {
      subject: 'user-1',
      algorithm: 'HS256',
    });
    expect(() => tokens.verifyAccessToken(expired)).toThrow(/expired/);
  });

  it('generates unique refresh tokens and stores only a deterministic hash', () => {
    const a = tokens.generateRefreshToken();
    const b = tokens.generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toContain(a.token);
    expect(tokens.hashRefreshToken(a.token)).toBe(a.tokenHash);
  });

  it('sets refresh expiry REFRESH_TOKEN_TTL_DAYS in the future', () => {
    const { expiresAt } = tokens.generateRefreshToken();
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThanOrEqual(30);
  });
});
