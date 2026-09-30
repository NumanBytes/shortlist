import { z } from 'zod';

// Every environment variable the API needs, declared in one place.
// If anything is missing or malformed, the process refuses to start.
const EnvSchema = z.object({
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

  // Browser origins allowed to call the API with credentials (the refresh cookie).
  // Comma-separated, exact origins — e.g. "https://app.getshortlist.com".
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.url().refine((o) => new URL(o).origin === o, 'Must be a bare origin, no path or trailing slash'))),
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
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
