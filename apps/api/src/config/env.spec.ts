import { loadEnv } from './env.js';

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/shortlist',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('applies defaults to a minimal valid environment', () => {
    expect(loadEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
      JWT_ACCESS_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      BCRYPT_ROUNDS: 12,
      WEB_ORIGINS: ['http://localhost:5173'],
      REDIS_URL: 'redis://localhost:6379',
    });
  });

  it('parses a comma-separated origin allowlist', () => {
    const env = loadEnv({ ...valid, WEB_ORIGINS: 'https://app.getshortlist.com, http://localhost:5173' });
    expect(env.WEB_ORIGINS).toEqual(['https://app.getshortlist.com', 'http://localhost:5173']);
  });

  it('rejects an origin with a path or trailing slash', () => {
    expect(() => loadEnv({ ...valid, WEB_ORIGINS: 'https://app.getshortlist.com/' })).toThrow(/bare origin/);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadEnv({ JWT_ACCESS_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-Postgres DATABASE_URL', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(/PostgreSQL/);
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'too-short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});
