import { createHash, randomBytes } from 'node:crypto';

// Google OAuth 2.0 (authorization-code flow with PKCE) and the few Gmail REST calls
// Shortlist needs — hand-rolled with fetch rather than the googleapis SDK, so every request
// is visible (Agents.md §10.3). Read-only scope; nothing here can send or change mail.

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GMAIL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT_MS = 20_000;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// A failure Google reports. `invalid_grant` on refresh means the grant is gone (revoked by
// the user, password change, or expired) — retrying can't fix it; the user must reconnect.
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
  get grantRevoked() {
    return this.code === 'invalid_grant';
  }
  get permanent() {
    return this.grantRevoked || this.status === 401 || this.status === 403 || this.status === 404 || this.status === 400;
  }
}

// PKCE (RFC 7636): the authorization code alone is useless without the verifier that only
// our server holds, so a code leaked through a redirect, log or browser history can't be
// redeemed by anyone else.
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizationUrl(cfg: GoogleOAuthConfig, p: { state: string; codeChallenge: string }): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GMAIL_READONLY_SCOPE, // the only scope requested — no email, no profile, no send
    access_type: 'offline', // ask for a refresh token: the worker checks mail on a schedule
    prompt: 'consent', // always return a refresh token, even if consent was given before
    include_granted_scopes: 'false',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const b = body as { error?: string | { message?: string; status?: string }; error_description?: string } | null;
    const code = typeof b?.error === 'string' ? b.error : b?.error?.status;
    const detail = b?.error_description ?? (typeof b?.error === 'object' ? b.error.message : undefined) ?? text.slice(0, 200);
    throw new GoogleApiError(`Google ${res.status}${code ? ` ${code}` : ''}: ${detail}`, res.status, code);
  }
  return body;
}

const form = (data: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
});

export interface GoogleOAuth {
  exchangeCode(code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string | null; scope: string }>;
  refreshAccessToken(refreshToken: string): Promise<string>;
  revoke(token: string): Promise<void>;
}

export class HttpGoogleOAuth implements GoogleOAuth {
  constructor(private readonly cfg: GoogleOAuthConfig) {}

  async exchangeCode(code: string, verifier: string) {
    const r = (await call(
      TOKEN_URL,
      form({
        code,
        code_verifier: verifier,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        redirect_uri: this.cfg.redirectUri,
        grant_type: 'authorization_code',
      }),
    )) as { access_token: string; refresh_token?: string; scope?: string };
    return { accessToken: r.access_token, refreshToken: r.refresh_token ?? null, scope: r.scope ?? '' };
  }

  // Access tokens last about an hour and are never stored: each check gets a fresh one.
  async refreshAccessToken(refreshToken: string) {
    const r = (await call(
      TOKEN_URL,
      form({ refresh_token: refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: 'refresh_token' }),
    )) as { access_token: string };
    return r.access_token;
  }

  async revoke(token: string) {
    await call(REVOKE_URL, form({ token }));
  }
}

// ── Gmail (read-only) ─────────────────────────────────────────────────────────
export interface GmailMessageRef {
  id: string;
}
export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailMessagePart {
  mimeType: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}
export interface GmailMessage {
  id: string;
  internalDate: string; // epoch millis as a string
  labelIds?: string[];
  payload?: GmailMessagePart;
  raw?: string; // base64url RFC 822, with format=raw
}

export interface GmailApi {
  profile(accessToken: string): Promise<{ emailAddress: string }>;
  labels(accessToken: string): Promise<{ id: string; name: string }[]>;
  listMessages(accessToken: string, p: { labelId: string; query: string; pageToken?: string }): Promise<{ messages: GmailMessageRef[]; nextPageToken?: string }>;
  getMessage(accessToken: string, id: string, format: 'full' | 'raw' | 'metadata'): Promise<GmailMessage>;
}

export class HttpGmailApi implements GmailApi {
  private get(accessToken: string, path: string) {
    return call(`${GMAIL_URL}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  }

  async profile(accessToken: string) {
    return (await this.get(accessToken, '/profile')) as { emailAddress: string };
  }

  async labels(accessToken: string) {
    return ((await this.get(accessToken, '/labels')) as { labels?: { id: string; name: string }[] }).labels ?? [];
  }

  async listMessages(accessToken: string, p: { labelId: string; query: string; pageToken?: string }) {
    const q = new URLSearchParams({ labelIds: p.labelId, q: p.query, maxResults: '100', ...(p.pageToken ? { pageToken: p.pageToken } : {}) });
    const r = (await this.get(accessToken, `/messages?${q}`)) as { messages?: GmailMessageRef[]; nextPageToken?: string };
    return { messages: r.messages ?? [], nextPageToken: r.nextPageToken };
  }

  async getMessage(accessToken: string, id: string, format: 'full' | 'raw' | 'metadata') {
    return (await this.get(accessToken, `/messages/${encodeURIComponent(id)}?format=${format}`)) as GmailMessage;
  }
}

export const headerValue = (m: GmailMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

// "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>" → "jobalerts-noreply@linkedin.com"
export function senderAddress(from: string | null): string | null {
  if (!from) return null;
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim().toLowerCase() || null;
}
