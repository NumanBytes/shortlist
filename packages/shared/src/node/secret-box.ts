import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encrypts secrets at rest (the Gmail refresh token, docs/email-alerts.md §10.3) with AES-256-GCM:
// - GCM is authenticated: a tampered or truncated ciphertext fails to decrypt instead of
//   yielding garbage, so there's no separate MAC to get wrong.
// - A fresh random 12-byte IV per encryption; reusing an IV with the same key breaks GCM.
// - `context` is bound in as additional authenticated data (AAD): a ciphertext copied to
//   another user's row won't decrypt there, even though the key is the same.
// - Versioned format "v1.<iv>.<tag>.<ciphertext>" (base64url) so the scheme can change later.

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const TAG_BYTES = 16;

export class SecretBox {
  private readonly key: Buffer;

  // `keyBase64`: 32 random bytes, base64 — generate with `openssl rand -base64 32`.
  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64-encoded)');
  }

  seal(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  open(sealed: string, context: string): string {
    const [version, iv, tag, ciphertext] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognized sealed value');
    // Pin the full 16-byte tag: without it Node accepts a truncated tag, and a shorter tag
    // is easier to forge.
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }
}
