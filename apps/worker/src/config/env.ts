import { vapidKeysValid } from '@shortlist/shared/node';
import { z } from 'zod';

// Every environment variable the worker needs. Invalid config = refuse to start.
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url().startsWith('postgres', 'DATABASE_URL must be a PostgreSQL connection string'),
    // redis:// locally, rediss:// (TLS) for Upstash in production.
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://')
      .default('redis://localhost:6379'),
    // When the nightly discovery runs, in DISCOVERY_TZ. Default: 02:00 Lahore time.
    DISCOVERY_CRON: z.string().default('0 2 * * *'),
    DISCOVERY_TZ: z.string().default('Asia/Karachi'),
    // How many sources are fetched in parallel. Each source's own requests are sequential.
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),

    // Claude API key — lives ONLY in the worker's env (docs/architecture.md §4). Optional: without
    // it, jobs are still discovered but analysis is deferred, never failed.
    ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-', 'ANTHROPIC_API_KEY must start with sk-ant-').optional(),
    // Nightly sweep: analyse pending/deferred jobs and re-score after evidence changes.
    ANALYSIS_CRON: z.string().default('0 3 * * *'),
    // Parallel model calls. Low on purpose: bounds rate-limit pressure and how far a burst
    // can overshoot the daily cap before the guard sees it.
    ANALYSIS_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),

    // Gmail job alerts (docs/email-alerts.md §10). Optional as a group, like ANTHROPIC_API_KEY: without
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

    // Web Push (docs/notifications.md §19). Optional as a group: without them nothing is
    // pushed, and notifications are still recorded. Generate a pair with
    // `pnpm --filter @shortlist/worker vapid:keys`; the public key also goes to the API.
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    // A contact the push services can reach: mailto:you@example.com or an https URL.
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:\/\/)/, 'VAPID_SUBJECT must be a mailto: or https:// URL')
      .optional(),
    // Account emails — verify an address, reset a password (docs/security.md §8.7). Optional
    // as a group: SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM, or none. Any SMTP server
    // works (a Gmail app password, Brevo, Mailgun, Zoho…). The API needs the same SMTP_HOST,
    // which is how it knows new accounts must verify.
    SMTP_HOST: z.string().min(1).optional(),
    // 465 = TLS from the first byte; anything else (587) upgrades with STARTTLS.
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    // "Shortlist <shortlist@example.com>": who the emails come from.
    SMTP_FROM: z.string().min(3).optional(),
    // The links in those emails open the web app here.
    WEB_APP_URL: z.url().default('http://localhost:5173'),
    // The morning digest, in DISCOVERY_TZ: after the nightly discovery (02:00) and scoring (03:00).
    DIGEST_CRON: z.string().default('0 8 * * *'),
  })
  .superRefine((env, ctx) => {
    const google = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.TOKEN_ENCRYPTION_KEY];
    if (google.some(Boolean) && !google.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'Set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY, or none',
      });
    }
    const smtp = [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASSWORD, env.SMTP_FROM];
    if (smtp.some(Boolean) && !smtp.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'Set all of SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM, or none',
      });
    }
    const vapid = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT];
    if (vapid.some(Boolean) && !vapid.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message: 'Set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none',
      });
    } else if (
      env.VAPID_PUBLIC_KEY &&
      !vapidKeysValid({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY! })
    ) {
      ctx.addIssue({ code: 'custom', path: ['VAPID_PRIVATE_KEY'], message: 'VAPID keys are not a matching pair' });
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
