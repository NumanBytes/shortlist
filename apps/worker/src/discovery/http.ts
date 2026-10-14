import { assertPublicUrl } from './public-url.js';

// Identifies us honestly to every source. No browser impersonation.
const USER_AGENT = 'ShortlistBot/0.1 (personal job search; low volume, once daily)';
const TIMEOUT_MS = 20_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

// Every fetch the worker makes goes to a public address, at every redirect hop
// (public-url.ts). Sources are configured by users — anyone with an account can add a
// careers page — so a source URL is as untrusted as a link read off a page (SSRF: the
// cloud metadata service, localhost, the Docker network). Redirects are followed by hand,
// because fetch would otherwise follow one to an internal address without asking. Only
// GET/HEAD are re-sent on a redirect; a POST that redirects is an error.
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', USER_AGENT);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, application/rss+xml, */*');
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      ...init,
      headers,
      redirect: 'manual',
      // A hung source must not hold a worker slot forever.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (init.method && init.method !== 'GET') throw new HttpError(res.status, current);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, current);
    return res;
  }
  throw new Error(`Too many redirects from ${url}`);
}

export async function getJson<T>(url: string): Promise<T> {
  return (await (await request(url)).json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function getText(url: string): Promise<string> {
  return (await request(url)).text();
}

// A URL that came from a third-party page. Same checks as every other fetch now; kept as its
// own name so call sites still say where the URL came from.
export async function getPublicText(url: string): Promise<string> {
  return (await request(url, { headers: { Accept: '*/*' } })).text();
}
