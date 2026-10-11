import type { AuthResponse } from './types';

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }

  // Field-level errors from the API's ZodValidationPipe, keyed by field path.
  get fieldErrors(): Record<string, string> {
    const errors = (this.body as { errors?: { path: string; message: string }[] } | null)?.errors;
    return Object.fromEntries((errors ?? []).map((e) => [e.path, e.message]));
  }
}

// ── Access token: in memory only ─────────────────────────────────────────────
// Never in localStorage: anything there is readable by any script on the page, so
// one XSS bug would leak it. In memory it's gone on reload — and restored from the
// httpOnly refresh cookie, which scripts can't read at all.
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

// The auth provider registers this so a failed silent refresh signs the UI out.
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

// ── Refresh: one at a time, across calls AND across tabs ─────────────────────
// Refresh tokens rotate, and presenting an already-rotated token is treated by the
// API as theft (every session is revoked). So two refreshes racing with the same
// cookie would log the user out everywhere. Two guards:
//  1. In this tab: concurrent callers share one in-flight promise.
//  2. Across tabs: a Web Lock makes other tabs wait. By the time a waiting tab runs,
//     the browser holds the rotated cookie, so it sends the new token, not the old one.
let inFlight: Promise<AuthResponse | null> | null = null;

export function refreshSession(): Promise<AuthResponse | null> {
  inFlight ??= withRefreshLock(doRefresh).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('shortlist-refresh', fn) : fn();
}

async function doRefresh(): Promise<AuthResponse | null> {
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    setAccessToken(null);
    return null;
  }
  const session = (await res.json()) as AuthResponse;
  setAccessToken(session.accessToken);
  return session;
}

// ── Requests ─────────────────────────────────────────────────────────────────
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);

  // Expired access token: refresh once and retry. Auth endpoints are excluded —
  // a 401 from /auth/login means wrong password, not an expired session.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (!session) {
      onSessionExpired?.();
      throw await toError(res);
    }
    res = await send(path, options);
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function send(path: string, { method = 'GET', body }: RequestOptions) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Sends the refresh cookie to /auth/* (the cookie's Path scopes it there anyway).
    credentials: 'include',
  });
}

async function toError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const message = (body as { message?: unknown } | null)?.message;
  return new ApiError(res.status, typeof message === 'string' ? message : `Request failed (${res.status})`, body);
}
