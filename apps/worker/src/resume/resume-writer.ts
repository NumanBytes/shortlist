import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, RESUME_JSON_SCHEMA } from '@shortlist/shared';
import { structuredCall, type AnalyzerResult } from '../analysis/job-analyzer.js';

// The one place the worker asks Claude to word a resume. An interface so tests use a fake
// and never spend money.
export interface ResumeWriter {
  readonly configured: boolean;
  write(prompt: { system: string; user: string }): Promise<AnalyzerResult>;
}

export const RESUME_WRITER = Symbol('RESUME_WRITER');

export class AnthropicResumeWriter implements ResumeWriter {
  private readonly client: Anthropic | null;

  constructor(apiKey: string | undefined) {
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2 }) : null;
  }

  get configured() {
    return this.client !== null;
  }

  write({ system, user }: { system: string; user: string }): Promise<AnalyzerResult> {
    return structuredCall(this.client, {
      model: AI_MODELS.tailorResume,
      maxTokens: 6000,
      system,
      user,
      schema: RESUME_JSON_SCHEMA,
      timeoutMs: 180_000, // a full resume takes longer to write than an analysis
    });
  }
}
