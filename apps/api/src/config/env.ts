import { z } from 'zod';

// Every environment variable the API needs, declared in one place.
// If anything is missing or malformed, the process refuses to start.
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url().startsWith('postgres', 'DATABASE_URL must be a PostgreSQL connection string'),

    // HS256 signing key for access tokens. 32+ chars so it can't be brute-forced offline
    // from a captured token. Generate with: openssl rand -base64 48
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    // Short-lived: an access token can't be revoked, so its lifetime IS the exposure window.
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    // Long-lived but revocable — stored (hashed) in the RefreshToken table.
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // Each +1 doubles hashing time. 12 is ~250ms; tests lower it to keep suites fast.
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

    // How many proxies sit in front of the API (a host's load balancer, a Vercel rewrite).
    // Express then takes the client IP from X-Forwarded-For that many hops back. 0 = use the
    // socket address (no proxy). Too low and every user shares the proxy's IP for rate
    // limits; too high and a client can spoof its IP with its own X-Forwarded-For header.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    // Browser origins allowed to call the API with credentials (the refresh cookie).
    // Comma-separated, exact origins — e.g. "https://app.getshortlist.com".
    // The API only enqueues jobs (e.g. "run discovery now"); the worker consumes them.
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://')
      .default('redis://localhost:6379'),

    WEB_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(z.url().refine((o) => new URL(o).origin === o, 'Must be a bare origin, no path or trailing slash')),
      ),

    // Where the browser lands after connecting Gmail (the web app's own URL).
    WEB_APP_URL: z.url().default('http://localhost:5173'),

    // Gmail job alerts (docs/email-alerts.md §10). Optional as a group: without them the app works and
    // "Connect Gmail" says it isn't configured. The redirect URI must match the one
    // registered on the Google OAuth client exactly.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: z.url().optional(),
    // 32 random bytes, base64 (openssl rand -base64 32). Encrypts the Gmail refresh token at
    // rest; the worker needs the same value to decrypt it.
    TOKEN_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
      .optional(),
  })
  .superRefine((env, ctx) => {
    const google = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI, env.TOKEN_ENCRYPTION_KEY];
    if (google.some(Boolean) && !google.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message:
          'Set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY, or none',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

// Loads .env from the working directory if present. In production the host
// injects real environment variables and there is no file, which is fine.
function loadDotEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export function loadEnv(source?: NodeJS.ProcessEnv): Env {
  if (!source) {
    loadDotEnvFile();
    source = process.env;
  }
  // An empty value means "not set": Docker Compose passes `${VAR:-}` as "", and hosting
  // dashboards often do the same. Without this, a blank optional setting (e.g. no Gmail)
  // would fail validation instead of falling back to its default or being left off.
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = EnvSchema.safeParse(set);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
