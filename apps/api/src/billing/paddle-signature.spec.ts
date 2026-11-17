import { createHmac } from 'node:crypto';
import { signPaddleBody, verifyPaddleSignature } from './paddle-signature.js';

const SECRET = 'pdl_ntfset_test_secret';
const body = '{"event_id":"evt_1","event_type":"subscription.created"}';
const now = 1_763_380_000_000; // ms
const ts = Math.floor(now / 1000);

describe('verifyPaddleSignature', () => {
  it('accepts a body signed with the secret, within the tolerance', () => {
    expect(verifyPaddleSignature(signPaddleBody(body, SECRET, ts), Buffer.from(body), SECRET, now)).toEqual({
      ok: true,
    });
    expect(verifyPaddleSignature(signPaddleBody(body, SECRET, ts - 4), Buffer.from(body), SECRET, now).ok).toBe(true);
  });

  it('computes h1 exactly as Paddle documents: HMAC-SHA256 over "ts:body", hex', () => {
    const h1 = createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex');
    expect(verifyPaddleSignature(`ts=${ts};h1=${h1}`, Buffer.from(body), SECRET, now).ok).toBe(true);
  });

  it('refuses a changed body, another secret, or a replay', () => {
    const header = signPaddleBody(body, SECRET, ts);
    expect(verifyPaddleSignature(header, Buffer.from(body.replace('created', 'canceled')), SECRET, now)).toEqual({
      ok: false,
      reason: 'signature does not match',
    });
    expect(verifyPaddleSignature(header, Buffer.from(body), 'pdl_ntfset_other', now).ok).toBe(false);
    expect(verifyPaddleSignature(signPaddleBody(body, SECRET, ts - 60), Buffer.from(body), SECRET, now)).toEqual({
      ok: false,
      reason: expect.stringMatching(/tolerance/),
    });
  });

  it('accepts any of several signatures (secret rotation)', () => {
    const good = signPaddleBody(body, SECRET, ts).split('h1=')[1];
    expect(verifyPaddleSignature(`ts=${ts};h1=${'0'.repeat(64)};h1=${good}`, Buffer.from(body), SECRET, now).ok).toBe(
      true,
    );
  });

  it('refuses missing or malformed headers without throwing', () => {
    for (const header of [
      undefined,
      '',
      'h1=abc',
      `ts=${ts}`,
      `ts=soon;h1=ab`,
      `ts=${ts};h1=not-hex`,
      `ts=${ts};h1=abcd`,
    ]) {
      expect(verifyPaddleSignature(header, Buffer.from(body), SECRET, now).ok).toBe(false);
    }
  });
});
