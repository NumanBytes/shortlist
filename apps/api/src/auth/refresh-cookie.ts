import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.js';

// The refresh token lives in a cookie the browser manages, never in JavaScript:
//
// - httpOnly: page scripts can't read it, so an XSS bug can't steal a 30-day credential.
//   (The access token is exposed to JS, but lives only in memory and expires in 15 min.)
// - SameSite=Strict: the browser never attaches it to requests started by another
//   site, which is the CSRF defense. Requires web and API on the same SITE — e.g.
//   app.getshortlist.com + api.getshortlist.com, or a same-origin /api proxy.
// - Path=/api/v1/auth: sent only to the auth endpoints, not on every API call.
// - Secure in production: HTTPS only.
export const REFRESH_COOKIE = 'shortlist_refresh';

function options(env: Env): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/api/v1/auth',
  };
}

export function setRefreshCookie(res: Response, token: string, env: Env): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...options(env),
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

// Must use the same path/flags as when it was set, or the browser keeps the old one.
export function clearRefreshCookie(res: Response, env: Env): void {
  res.clearCookie(REFRESH_COOKIE, options(env));
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
