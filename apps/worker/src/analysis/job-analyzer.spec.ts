import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall } from './job-analyzer.js';

// A fake client: records the request and answers with one text block (no network, no cost).
function fakeClient() {
  const create = vi.fn(async (_body: Record<string, unknown>) => ({
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    // Haiku 5.5 thinks by default: the answer can follow a thinking block.
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: '{"ok":true}' },
    ],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null },
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const base = { model: 'claude-haiku-5-5', maxTokens: 4096, system: 's', user: 'u', schema: { type: 'object' } };

describe('structuredCall', () => {
  it('sends effort only when one is set (models without effort levels reject it)', async () => {
    const { client, create } = fakeClient();
    await structuredCall(client, { ...base, effort: 'low' });
    await structuredCall(client, { ...base, effort: null });
    await structuredCall(client, base);
    const configs = create.mock.calls.map(([body]) => body.output_config);
    expect(configs[0]).toEqual({ format: { type: 'json_schema', schema: base.schema }, effort: 'low' });
    expect(configs[1]).toEqual({ format: { type: 'json_schema', schema: base.schema } });
    expect(configs[2]).toEqual({ format: { type: 'json_schema', schema: base.schema } });
  });

  it('reads the answer from text blocks, skipping thinking blocks before it', async () => {
    const { client } = fakeClient();
    const result = await structuredCall(client, base);
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});
