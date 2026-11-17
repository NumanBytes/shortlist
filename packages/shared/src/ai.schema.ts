import { z } from 'zod';

// ── Models and prices (checked 2026-10-02, docs/ai-scoring.md §12.2) ───────────────────
// The three structured readers moved from Haiku 4.5 to Haiku 5.5 on 2026-11-17 (§12.6): about
// a tenth of the price. Not measured side by side first (the user's call); compare:analysis
// does that on real jobs.
export const AI_MODELS = {
  analyzeJob: 'claude-haiku-5-5',
  // Writing is where quality shows; still ~$0.03 per resume (docs/resume.md §13.1).
  tailorResume: 'claude-sonnet-5-5',
  // Reading jobs out of alert emails no code parser handles: short, structured, cheap.
  extractEmail: 'claude-haiku-5-5',
  // Reading a whole resume into roles, projects and quoted evidence, once per import:
  // accuracy matters more than the few cents (docs/career-data.md §7.6).
  importResume: 'claude-sonnet-5-5',
  // Listing the openings on a company careers page, only when the page changed (§9.14).
  extractCareersPage: 'claude-haiku-5-5',
} as const;

// Effort for models that have it (Haiku 5.5 and later); null = a model without effort levels.
// Thinking is on by default on those models and counts toward max_tokens. `low` for all three:
// they're short structured readings, the closest to Haiku 4.5 without thinking, and the
// cheapest; raise one only if compare:analysis (or production) shows it misses things.
export type AiEffort = 'low' | 'medium' | 'high';
export const AI_EFFORT: Record<'analyzeJob' | 'extractEmail' | 'extractCareersPage', AiEffort | null> = {
  analyzeJob: 'low',
  extractEmail: 'low',
  extractCareersPage: 'low',
};

// USD per million tokens. Batch API halves these (not used — §12.6). Haiku 4.5 stays for
// pricing the AiUsage rows it already wrote.
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Prompts up to 100K tokens (every Shortlist prompt); longer ones cost $0.50 / $2.50.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export function costUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): number {
  // The API reports the full model ID (e.g. "claude-haiku-4-5-20251001"); price by alias prefix.
  const key = Object.keys(MODEL_PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  const p = key ? MODEL_PRICES[key] : undefined;
  if (!p) throw new Error(`No price for model ${model}`);
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      (usage.cacheReadTokens ?? 0) * p.cacheRead +
      (usage.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

// ── Budget guard settings (docs/ai-scoring.md §12.3) ───────────────────────────────────
export const AiSettingsSchema = z
  .object({
    maxAnalysesPerDay: z.number().int().min(0).max(500),
    monthlyBudgetUsd: z.number().min(0).max(1000),
    // Share of a job's requirements a stored, approved resume must have been built for to
    // be offered for reuse instead of tailoring a new one (docs/resume.md §13.2).
    resumeReuseMinOverlap: z.number().min(0.5).max(1),
  })
  .strict();
export type AiSettingsInput = z.infer<typeof AiSettingsSchema>;

// What a user may change themselves. Not the monthly budget: on hosted Shortlist the server's
// Anthropic key pays for every call, so only an admin sets it (SetAiBudgetSchema, Agents.md
// §2.1). Sending it here is a 400, not silently ignored. The daily limit and the reuse
// threshold can't spend past the budget, so they stay the user's.
export const UpdateAiSettingsSchema = AiSettingsSchema.omit({ monthlyBudgetUsd: true })
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' });
export type UpdateAiSettingsInput = z.infer<typeof UpdateAiSettingsSchema>;

// Admin-only (PUT /admin/users/:id/ai-budget).
export const SetAiBudgetSchema = AiSettingsSchema.pick({ monthlyBudgetUsd: true }).strict();
export type SetAiBudgetInput = z.infer<typeof SetAiBudgetSchema>;

// A new account's allowance: $1 a month — about 50 scored jobs and 5 tailored resumes at
// measured costs (docs/ai-scoring.md §12.2) — until an admin (later, a plan) raises it.
// Accounts that existed before 2026-11-15 kept their $4.50 as a row. Behind every user's
// cap sit AI_SERVER_MONTHLY_BUDGET_USD and the Console's prepaid balance (§12.3).
export const DEFAULT_AI_SETTINGS: AiSettingsInput = {
  maxAnalysesPerDay: 40,
  monthlyBudgetUsd: 1,
  resumeReuseMinOverlap: 0.85,
};

// Prisma row (Decimals as objects) → settings, defaulting for a user without a row.
export function aiSettingsFromRow(
  row: { maxAnalysesPerDay: number; monthlyBudgetUsd: unknown; resumeReuseMinOverlap: unknown } | null,
): AiSettingsInput {
  return row
    ? {
        maxAnalysesPerDay: row.maxAnalysesPerDay,
        monthlyBudgetUsd: Number(row.monthlyBudgetUsd),
        resumeReuseMinOverlap: Number(row.resumeReuseMinOverlap),
      }
    : DEFAULT_AI_SETTINGS;
}

// ── What the model returns for one job (validated before anything is stored) ──
export const SeniorityEnum = z.enum(['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'UNKNOWN']);
export const ImportanceEnum = z.enum(['REQUIRED', 'PREFERRED', 'BONUS']);

export const MAX_SKILL_REFS = 100;

export const JobAnalysisOutputSchema = z.object({
  seniority: SeniorityEnum,
  yearsRequired: z.number().int().min(0).max(40).nullable(),
  redFlags: z.array(z.string().max(200)).max(10),
  requirements: z
    .array(
      z.object({
        skill: z.string().min(1).max(80),
        importance: ImportanceEnum,
        isCore: z.boolean(),
        yearsRequired: z.number().int().min(0).max(40).nullable(),
        // Short references ("S3") into the verified-skill list sent with the request.
        // Unknown refs are dropped later, so the cap is only a sanity bound: a broad
        // requirement ("Full stack development") can relate to more than 10 of the
        // candidate's skills, and a cap of 10 failed the whole job (2026-10-13).
        sameAs: z.array(z.string().max(10)).max(MAX_SKILL_REFS),
        relatedTo: z.array(z.string().max(10)).max(MAX_SKILL_REFS),
      }),
    )
    .max(40),
});
export type JobAnalysisOutput = z.infer<typeof JobAnalysisOutputSchema>;

// Hand-written JSON Schema for the API's structured output. Written by hand rather than
// converted from Zod because the converter turned enums into descriptions, so the API
// would not have enforced them. Kept in sync with JobAnalysisOutputSchema by a test.
const refList = { type: 'array', items: { type: 'string' } };
export const JOB_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['seniority', 'yearsRequired', 'redFlags', 'requirements'],
  properties: {
    seniority: { type: 'string', enum: SeniorityEnum.options },
    yearsRequired: { type: ['integer', 'null'] },
    redFlags: { type: 'array', items: { type: 'string' } },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['skill', 'importance', 'isCore', 'yearsRequired', 'sameAs', 'relatedTo'],
        properties: {
          skill: { type: 'string' },
          importance: { type: 'string', enum: ImportanceEnum.options },
          isCore: { type: 'boolean' },
          yearsRequired: { type: ['integer', 'null'] },
          sameAs: refList,
          relatedTo: refList,
        },
      },
    },
  },
} as const;
