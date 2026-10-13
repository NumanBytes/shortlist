import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import {
  encryptPush,
  generateVapidKeys,
  isPushEndpoint,
  sendPush,
  vapidAuthorization,
  vapidKeysValid,
} from './web-push.js';

const b = (s: string) => Buffer.from(s, 'base64url');

// RFC 8291 Appendix A: the worked example every implementation must reproduce.
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// What a browser does with the message: an independent implementation of the receiving side.
function decryptAsBrowser(message: Buffer, uaPrivate: string, authSecret: string): Buffer {
  const salt = message.subarray(0, 16);
  const idLen = message[20]!;
  const asPublic = message.subarray(21, 21 + idLen);
  const ciphertext = message.subarray(21 + idLen);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(b(uaPrivate));
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(asPublic), b(authSecret), info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([d.update(ciphertext.subarray(0, -16)), d.final()]);
  expect(padded.at(-1)).toBe(2); // the last-record delimiter
  return padded.subarray(0, -1);
}

describe('encryptPush (RFC 8291)', () => {
  it('reproduces the RFC 8291 worked example byte for byte', () => {
    const serverKeys = createECDH('prime256v1');
    serverKeys.setPrivateKey(b(RFC.asPrivate));
    const message = encryptPush(
      b(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.authSecret },
      { salt: b(RFC.salt), serverKeys },
    );
    expect(message.toString('base64url')).toBe(RFC.body);
  });

  it('a fresh message decrypts for the browser it was meant for', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7).toString('base64url');
    const text = Buffer.from(JSON.stringify({ title: 'Strong match', body: 'React Developer @ Acme (84)' }));
    const message = encryptPush(text, { p256dh: ua.getPublicKey().toString('base64url'), auth });
    expect(decryptAsBrowser(message, ua.getPrivateKey().toString('base64url'), auth).toString()).toBe(text.toString());
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a JWT for the push service origin that verifies with the public key', () => {
    const keys = generateVapidKeys();
    expect(vapidKeysValid(keys)).toBe(true);
    const now = new Date('2026-10-13T08:00:00Z');
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:me@example.com', now);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt!.split('.');
    expect(JSON.parse(b(c!).toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: 'mailto:me@example.com',
    });
    const pub = b(keys.publicKey);
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, b(s!))).toBe(true);
  });

  it('rejects a key pair that does not belong together', () => {
    expect(
      vapidKeysValid({ publicKey: generateVapidKeys().publicKey, privateKey: generateVapidKeys().privateKey }),
    ).toBe(false);
  });
});

describe('sendPush', () => {
  it('posts the encrypted message with the Web Push headers and reports the status', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.alloc(16, 1).toString('base64url');
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const res = await sendPush(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: ua.getPublicKey().toString('base64url'), auth },
      { title: 'Hi' },
      { vapid: generateVapidKeys(), subject: 'mailto:me@example.com', ttlSeconds: 3600, topic: 'digest' },
      fake,
    );
    expect(res.status).toBe(201);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '3600', Topic: 'digest', Urgency: 'normal' });
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    const body = Buffer.from(calls[0]!.init.body as Uint8Array);
    expect(JSON.parse(decryptAsBrowser(body, ua.getPrivateKey().toString('base64url'), auth).toString())).toEqual({
      title: 'Hi',
    });
  });

  it('only accepts endpoints of real push services (the worker POSTs to them)', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QG')).toBe(true);
    expect(isPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isPushEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
  });
});
