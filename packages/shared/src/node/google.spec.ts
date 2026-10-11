import { GMAIL_READONLY_SCOPE, GoogleApiError, SecretBox, authorizationUrl, pkcePair, senderAddress } from './index.js';
import { createHash, randomBytes } from 'node:crypto';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox (AES-256-GCM)', () => {
  const box = new SecretBox(key());

  it('round-trips, with a fresh IV every time', () => {
    const a = box.seal('1//refresh-token', 'user-1');
    const b = box.seal('1//refresh-token', 'user-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh-token');
    expect(box.open(a, 'user-1')).toBe('1//refresh-token');
  });

  it("won't open under another user's id (bound as AAD)", () => {
    expect(() => box.open(box.seal('secret', 'user-1'), 'user-2')).toThrow();
  });

  it('detects tampering and the wrong key', () => {
    const sealed = box.seal('secret', 'u');
    const [v, iv, tag, ct] = sealed.split('.');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => box.open([v, iv, tag, flipped.toString('base64url')].join('.'), 'u')).toThrow();
    expect(() => new SecretBox(key()).open(sealed, 'u')).toThrow();
  });

  it('refuses a truncated authentication tag', () => {
    const [v, iv, tag, ct] = box.seal('secret', 'u').split('.');
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => box.open([v, iv, short, ct].join('.'), 'u')).toThrow();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('Google OAuth helpers', () => {
  it('PKCE: the challenge is the base64url SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('asks for read-only Gmail and nothing else, with PKCE and a refresh token', () => {
    const url = new URL(
      authorizationUrl(
        { clientId: 'cid', clientSecret: 'x', redirectUri: 'http://localhost:5173/api/v1/gmail/callback' },
        { state: 's', codeChallenge: 'c' },
      ),
    );
    const q = url.searchParams;
    expect(q.get('scope')).toBe(GMAIL_READONLY_SCOPE);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toBe('consent');
    expect(q.get('include_granted_scopes')).toBe('false');
    expect(q.has('client_secret')).toBe(false); // never in a browser URL
  });

  it('treats invalid_grant as revoked (permanent)', () => {
    expect(new GoogleApiError('x', 400, 'invalid_grant').grantRevoked).toBe(true);
    expect(new GoogleApiError('x', 503).permanent).toBe(false);
  });

  it('extracts the sender address', () => {
    expect(senderAddress('LinkedIn Job Alerts <JobAlerts-NoReply@linkedin.com>')).toBe(
      'jobalerts-noreply@linkedin.com',
    );
    expect(senderAddress('alert@indeed.com')).toBe('alert@indeed.com');
    expect(senderAddress(null)).toBeNull();
  });
});
