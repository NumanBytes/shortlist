import { createHmac, timingSafeEqual } from 'node:crypto';

// Paddle webhook signatures, checked by hand (docs/billing.md §20.3; no SDK hides it).
//
// Paddle sends `Paddle-Signature: ts=<unix seconds>;h1=<hex>`. h1 is HMAC-SHA256, keyed with the
// destination's secret, over `${ts}:${raw body}`. Three things make it a proof:
//   - the secret is shared only with Paddle, so nobody else can produce a valid h1;
//   - it covers the exact bytes received — so the check must run on the raw body, before any
//     JSON parsing, which could reorder or re-encode it;
//   - it covers the timestamp, and a request older than the tolerance is refused, so a captured
//     request can't be replayed later (Paddle's default tolerance is five seconds).
// During a secret rotation the header can carry more than one h1; any one matching is enough.

export const SIGNATURE_TOLERANCE_SECONDS = 5;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifyPaddleSignature(
  header: string | undefined,
  rawBody: Buffer,
  secret: string,
  now = Date.now(),
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing Paddle-Signature header' };
  let ts: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const [key, value] = part.split('=', 2).map((s) => s.trim());
    if (key === 'ts') ts = value;
    else if (key === 'h1' && value) signatures.push(value);
  }
  if (!ts || !/^\d+$/.test(ts) || signatures.length === 0)
    return { ok: false, reason: 'malformed Paddle-Signature header' };
  if (Math.abs(now / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'signature timestamp outside the tolerance (a replay, or a wrong clock)' };
  }

  const expected = createHmac('sha256', secret).update(`${ts}:`).update(rawBody).digest();
  // Constant-time comparison: comparing byte by byte and stopping at the first difference would
  // tell an attacker, through timing, how many leading bytes of a guess were right.
  const matches = signatures.some((sig) => {
    if (!/^[0-9a-f]+$/i.test(sig)) return false;
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matches ? { ok: true } : { ok: false, reason: 'signature does not match' };
}

// Signs a body the way Paddle does — for tests and for replaying a recorded event locally.
export function signPaddleBody(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  const h1 = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}
