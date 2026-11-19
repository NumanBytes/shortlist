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
      TRUST_PROXY_HOPS: 0,
      WEB_APP_URL: 'http://localhost:5173',
    });
  });

  it('treats empty values as not set (Docker Compose passes blank optional settings as "")', () => {
    const env = loadEnv({
      ...valid,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_REDIRECT_URI: '',
      TOKEN_ENCRYPTION_KEY: '',
      PORT: '',
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.PORT).toBe(3000); // the default, not a failed parse of ""
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

  describe('Gmail settings (all or none)', () => {
    const google = {
      GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/v1/gmail/callback',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    };

    it('accepts the full set', () => {
      expect(loadEnv({ ...valid, ...google }).GOOGLE_CLIENT_ID).toBe(google.GOOGLE_CLIENT_ID);
    });

    it('refuses a partial set instead of half-working', () => {
      const { TOKEN_ENCRYPTION_KEY: _, ...partial } = google;
      expect(() => loadEnv({ ...valid, ...partial })).toThrow(/or none/);
    });

    it('refuses an encryption key that is not 32 bytes', () => {
      expect(() => loadEnv({ ...valid, ...google, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
        /32 bytes/,
      );
    });
  });

  describe('legal details (all or none; required for live payments)', () => {
    const legal = {
      LEGAL_NAME: 'Example Operator',
      LEGAL_ADDRESS: '1 Example Road, Example City',
      LEGAL_EMAIL: 'support@example.com',
      LEGAL_JURISDICTION: 'Exampleland',
    };
    const paddle = (key: string, token: string) => ({
      PADDLE_API_KEY: key,
      PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_x',
      PADDLE_CLIENT_TOKEN: token,
      PADDLE_PRICE_STARTER: 'pri_a',
      PADDLE_PRICE_PRO: 'pri_b',
    });

    it('accepts the full set, or none', () => {
      expect(loadEnv({ ...valid, ...legal }).LEGAL_NAME).toBe('Example Operator');
      expect(loadEnv(valid).LEGAL_NAME).toBeUndefined();
    });

    it('refuses a partial set', () => {
      const { LEGAL_ADDRESS: _, ...partial } = legal;
      expect(() => loadEnv({ ...valid, ...partial })).toThrow(/or none/);
    });

    it('needs them for a live Paddle key, not for the sandbox', () => {
      expect(() => loadEnv({ ...valid, ...paddle('pdl_live_apikey_x', 'live_x') })).toThrow(/Live payments need/);
      expect(loadEnv({ ...valid, ...legal, ...paddle('pdl_live_apikey_x', 'live_x') }).LEGAL_EMAIL).toBe(
        'support@example.com',
      );
      expect(loadEnv({ ...valid, ...paddle('pdl_sdbx_apikey_x', 'test_x') }).PADDLE_API_KEY).toBe('pdl_sdbx_apikey_x');
    });
  });
});
