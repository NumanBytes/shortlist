import { loadEnv } from './env.js';

describe('loadEnv', () => {
  const valid = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/shortlist' };

  it('applies defaults to a minimal valid environment', () => {
    expect(loadEnv(valid)).toEqual({ ...valid, NODE_ENV: 'development', PORT: 3000 });
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-Postgres DATABASE_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/PostgreSQL/);
  });
});
