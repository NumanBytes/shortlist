import Anthropic from '@anthropic-ai/sdk';
import { AI_EFFORT, AI_MODELS, JOB_ANALYSIS_JSON_SCHEMA, type AiEffort } from '@shortlist/shared';

export interface AnalyzerUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AnalyzerResult {
  model: string;
  text: string;
  usage: AnalyzerUsage;
  stopReason: string | null;
}

// The one place the worker talks to Claude for job analysis. An interface so tests can
// substitute a fake and never spend money.
export interface JobAnalyzer {
  readonly configured: boolean;
  analyze(prompt: { system: string; user: string }): Promise<AnalyzerResult>;
}

export const JOB_ANALYZER = Symbol('JOB_ANALYZER');

// Failures retrying can't fix (bad request, auth). Out-of-credit is NOT one of these:
// it becomes DEFERRED so the job runs again after a top-up.
export class PermanentAnalyzerError extends Error {}
export class OutOfCreditError extends Error {}

export class AnthropicJobAnalyzer implements JobAnalyzer {
  private readonly client: Anthropic | null;

  // `model`/`effort` default to the configured ones; compare:analysis passes others to measure
  // a model change on real jobs before making it (docs/ai-scoring.md §12.6).
  constructor(
    apiKey: string | undefined,
    private readonly options: { model?: string; effort?: AiEffort | null } = {},
  ) {
    // The SDK retries 429 / 5xx / connection errors twice on its own; our queue retries
    // on top of that with longer backoff.
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 }) : null;
  }

  get configured() {
    return this.client !== null;
  }

  async analyze({ system, user }: { system: string; user: string }): Promise<AnalyzerResult> {
    return structuredCall(this.client, {
      model: this.options.model ?? AI_MODELS.analyzeJob,
      effort: this.options.effort === undefined ? AI_EFFORT.analyzeJob : this.options.effort,
      // Room for Haiku 5.5's thinking and its ~30% larger token counts (docs/ai-scoring.md §12.6).
      maxTokens: 6000,
      system,
      user,
      schema: JOB_ANALYSIS_JSON_SCHEMA,
    });
  }
}

// One structured-output call, with errors sorted into permanent / out-of-credit /
// transient. Shared by every model call the worker makes (analysis, tailoring).
export async function structuredCall(
  client: Anthropic | null,
  opts: {
    model: string;
    // Models with effort levels only (docs/ai-scoring.md §12.6); null/undefined = leave it out.
    effort?: AiEffort | null;
    maxTokens: number;
    system: string;
    user: string;
    schema: Record<string, unknown>;
    timeoutMs?: number;
  },
): Promise<AnalyzerResult> {
  if (!client) throw new PermanentAnalyzerError('ANTHROPIC_API_KEY is not set');
  try {
    const response = await client.messages.create(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        // Structured output: the response is guaranteed to match this schema (enums
        // included). We still validate it with Zod before storing anything.
        output_config: {
          format: { type: 'json_schema', schema: opts.schema },
          ...(opts.effort ? { effort: opts.effort } : {}),
        },
      },
      opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
    );
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return {
      model: response.model,
      text,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
      throw new OutOfCreditError('Anthropic credit balance is too low — top up, and deferred jobs will run');
    }
    if (
      err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.PermissionDeniedError ||
      err instanceof Anthropic.NotFoundError
    ) {
      throw new PermanentAnalyzerError(`Claude API ${err.status}: ${err.message}`);
    }
    throw err; // 429 / 5xx / network: transient — let the queue retry
  }
}
