import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, JOB_ANALYSIS_JSON_SCHEMA } from '@shortlist/shared';

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

  constructor(apiKey: string | undefined) {
    // The SDK retries 429 / 5xx / connection errors twice on its own; our queue retries
    // on top of that with longer backoff.
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 }) : null;
  }

  get configured() {
    return this.client !== null;
  }

  async analyze({ system, user }: { system: string; user: string }): Promise<AnalyzerResult> {
    if (!this.client) throw new PermanentAnalyzerError('ANTHROPIC_API_KEY is not set');
    try {
      const response = await this.client.messages.create({
        model: AI_MODELS.analyzeJob,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
        // Structured output: the response is guaranteed to match this schema (enums
        // included). We still validate it with Zod before storing anything.
        output_config: { format: { type: 'json_schema', schema: JOB_ANALYSIS_JSON_SCHEMA } },
      });
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
}
