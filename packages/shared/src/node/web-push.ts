import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type ECDH } from 'node:crypto';

// Web Push, hand-rolled (docs/notifications.md §19.2) — the same choice as the hand-rolled JWT
// auth and Google OAuth: the mechanism is the point. Two standards:
// - VAPID (RFC 8292): the server proves who it is to the push service with a short ES256 JWT,
//   signed by a key pair whose public half the browser was given when it subscribed.
// - Message encryption (RFC 8291, aes128gcm from RFC 8188): the payload is encrypted for the
//   one browser, so the push service (Google's, Mozilla's, Apple's) only carries ciphertext.

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

// ── VAPID keys ───────────────────────────────────────────────────────────────────
// publicKey: the uncompressed P-256 point (65 bytes), the browser's `applicationServerKey`.
// privateKey: the 32-byte scalar. Both base64url, as the browser and the env file want them.
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

export function vapidKeysValid(keys: VapidKeys): boolean {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(fromB64u(keys.privateKey));
    return ecdh.getPublicKey().equals(fromB64u(keys.publicKey));
  } catch {
    return false;
  }
}

// The `Authorization` header for one push request: "vapid t=<jwt>, k=<public key>".
// `aud` is the push service's origin; `sub` a contact for the push service (mailto: or https:).
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = new Date()): string {
  const pub = fromB64u(keys.publicKey);
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 3600, // push services accept at most 24 h
        sub: subject,
      }),
    ),
  );
  // JWS wants the raw r||s signature (64 bytes), not Node's default DER encoding.
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

// ── Message encryption (RFC 8291) ────────────────────────────────────────────────
export interface PushTarget {
  endpoint: string;
  p256dh: string; // the browser's ECDH public key, base64url
  auth: string; // the browser's 16-byte auth secret, base64url
}

const RECORD_SIZE = 4096;

// Encrypts one message for one browser. `salt` and `serverKeys` are fresh per message; tests
// pass fixed ones to reproduce the RFC's worked example.
export function encryptPush(
  plaintext: Buffer,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  test?: { salt: Buffer; serverKeys: ECDH },
): Buffer {
  const uaPublic = fromB64u(target.p256dh);
  const authSecret = fromB64u(target.auth);
  const salt = test?.salt ?? randomBytes(16);
  const server =
    test?.serverKeys ??
    (() => {
      const e = createECDH('prime256v1');
      e.generateKeys();
      return e;
    })();
  const asPublic = server.getPublicKey();

  // A shared secret only this server message and that browser can compute…
  const ecdhSecret = server.computeSecret(uaPublic);
  // …mixed with the browser's auth secret, bound to both public keys (RFC 8291 §3.3).
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));
  // The content key and nonce for aes128gcm (RFC 8188 §2.2).
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // One record: the message, then the 0x02 "last record" delimiter (no extra padding).
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Header: salt (16) | record size (4, big-endian) | key id length (1) | key id = server public key.
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body, tag]);
}

// Room left for the message: a push service accepts 4096 bytes of body, of which the header
// takes 86 and the tag and delimiter 17.
export const MAX_PUSH_PLAINTEXT = 3993;

// ── Sending ──────────────────────────────────────────────────────────────────────
export interface PushOptions {
  vapid: VapidKeys;
  subject: string;
  ttlSeconds: number; // how long the push service keeps it for an offline device
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string; // a newer message with the same topic replaces an undelivered older one
}

// Status codes, so the caller can act: 201 delivered to the push service; 404/410 the
// subscription is gone (delete it); 429/5xx try later.
export async function sendPush(
  target: PushTarget,
  payload: unknown,
  opts: PushOptions,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: number }> {
  const plaintext = Buffer.from(JSON.stringify(payload));
  if (plaintext.length > MAX_PUSH_PLAINTEXT) throw new Error(`Push payload too large (${plaintext.length} bytes)`);
  const headers: Record<string, string> = {
    Authorization: vapidAuthorization(target.endpoint, opts.vapid, opts.subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttlSeconds),
    Urgency: opts.urgency ?? 'normal',
  };
  if (opts.topic) headers.Topic = opts.topic;
  const res = await fetchFn(target.endpoint, {
    method: 'POST',
    headers,
    body: new Uint8Array(encryptPush(plaintext, target)),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status };
}

// The push-service allow-list lives with the request schema (notification.schema.ts).
export { isPushEndpoint } from '../notification.schema.js';
