import { z } from 'zod';

// ── Models and prices (checked 2026-10-02, Agents.md §12.2) ───────────────────
export const AI_MODELS = {
  analyzeJob: 'claude-haiku-4-5',
  // Writing is where quality shows; still ~$0.03 per resume (Agents.md §13.1).
  tailorResume: 'claude-sonnet-5-5',
} as const;

// USD per million tokens. Batch API halves these (not used yet — §12.1).
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
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

// ── Budget guard settings (Agents.md §12.3) ───────────────────────────────────
export const AiSettingsSchema = z
  .object({
    maxAnalysesPerDay: z.number().int().min(0).max(500),
    monthlyBudgetUsd: z.number().min(0).max(1000),
    // Share of a job's requirements a stored, approved resume must have been built for to
    // be offered for reuse instead of tailoring a new one (Agents.md §13.2).
    resumeReuseMinOverlap: z.number().min(0.5).max(1),
  })
  .strict();
export type AiSettingsInput = z.infer<typeof AiSettingsSchema>;

export const UpdateAiSettingsSchema = AiSettingsSchema.partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' });
export type UpdateAiSettingsInput = z.infer<typeof UpdateAiSettingsSchema>;

// $4.50 of the initial $5 credit, leaving headroom for manual runs; the Console's
// prepaid balance (auto-reload off) is the hard stop behind this.
export const DEFAULT_AI_SETTINGS: AiSettingsInput = { maxAnalysesPerDay: 40, monthlyBudgetUsd: 4.5, resumeReuseMinOverlap: 0.85 };

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
        sameAs: z.array(z.string().max(10)).max(10),
        relatedTo: z.array(z.string().max(10)).max(10),
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
