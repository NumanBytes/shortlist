import type { z } from 'zod';

export type ModelOutput<T> = { ok: true; value: T } | { ok: false; reason: string };

// Every model answer goes through the same three checks before anything uses it: did it
// finish, is it JSON, does it match the schema. Structured output makes the last two rare,
// but the response is still untrusted input — validated here, like any other boundary.
// `task` finishes "Model declined to …" for a refusal.
export function parseModelOutput<S extends z.ZodType>(
  text: string,
  stopReason: string | null,
  schema: S,
  task: string,
): ModelOutput<z.infer<S>> {
  if (stopReason === 'max_tokens') return { ok: false, reason: 'Model output was cut off (max_tokens)' };
  if (stopReason === 'refusal') return { ok: false, reason: `Model declined to ${task}` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Model output was not valid JSON' };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  // Say WHERE it failed ("experience.0.bullets.2.evidence.1"): "too big" alone isn't actionable.
  const issue = result.error.issues[0];
  return { ok: false, reason: `Model output failed validation at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'unknown'}` };
}
