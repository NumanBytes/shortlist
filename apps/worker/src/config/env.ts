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
