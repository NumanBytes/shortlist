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

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', USER_AGENT);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, application/rss+xml, */*');
  const res = await fetch(url, {
    ...init,
    headers,
    // A hung source must not hold a worker slot forever.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
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
