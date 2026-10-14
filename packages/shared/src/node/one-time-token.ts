import { createHash, randomBytes } from 'node:crypto';

// One-time links in account emails (docs/security.md §8.7). 32 random bytes, base64url: too
// much entropy to guess, so SHA-256 (fast, deterministic — findable by a unique index) is the
// right hash, not bcrypt. Only the hash is stored; the token itself goes only into the email.
export function newOneTimeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashOneTimeToken(token) };
}

export const hashOneTimeToken = (token: string) => createHash('sha256').update(token).digest('hex');
