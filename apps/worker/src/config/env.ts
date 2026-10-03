import { z } from 'zod';

// Every environment variable the worker needs. Invalid config = refuse to start.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgres', 'DATABASE_URL must be a PostgreSQL connection string'),
  // redis:// locally, rediss:// (TLS) for Upstash in production.
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://').default('redis://localhost:6379'),
  // When the nightly discovery runs, in DISCOVERY_TZ. Default: 02:00 Lahore time.
  DISCOVERY_CRON: z.string().default('0 2 * * *'),
  DISCOVERY_TZ: z.string().default('Asia/Karachi'),
  // How many sources are fetched in parallel. Each source's own requests are sequential.
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),

  // Claude API key — lives ONLY in the worker's env (Agents.md §4). Optional: without
  // it, jobs are still discovered but analysis is deferred, never failed.
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-', 'ANTHROPIC_API_KEY must start with sk-ant-').optional(),
  // Nightly sweep: analyse pending/deferred jobs and re-score after evidence changes.
  ANALYSIS_CRON: z.string().default('0 3 * * *'),
  // Parallel model calls. Low on purpose: bounds rate-limit pressure and how far a burst
  // can overshoot the daily cap before the guard sees it.
  ANALYSIS_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),

  // Gmail job alerts (Agents.md §10). Optional as a group, like ANTHROPIC_API_KEY: without
  // them, email checks report "not configured" instead of failing. Same values as the API.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
    .optional(),
  // How often connected inboxes are checked. Alerts arrive through the day; every two
  // hours keeps new jobs fresh without hammering the API (each check is a few requests).
  GMAIL_CHECK_CRON: z.string().default('15 */2 * * *'),
}).superRefine((env, ctx) => {
  const google = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.TOKEN_ENCRYPTION_KEY];
  if (google.some(Boolean) && !google.every(Boolean)) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_CLIENT_ID'],
      message: 'Set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY, or none',
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

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
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
