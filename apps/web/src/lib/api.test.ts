import { ApiError, api, refreshSession, setAccessToken, setSessionExpiredHandler } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const session = { user: { id: 'u1', name: 'N' }, accessToken: 'fresh-token' };

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((url: string, init: RequestInit = {}) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const authHeader = (init: RequestInit | undefined) => (init?.headers as Record<string, string> | undefined)?.Authorization;

beforeEach(() => {
  setAccessToken(null);
  setSessionExpiredHandler(null);
});

describe('refreshSession', () => {
  it('shares one in-flight request between concurrent callers', async () => {
    // Two parallel refreshes with the same cookie would look like token theft to the
    // API and revoke every session — so concurrent callers must share one request.
    const fetchMock = mockFetch(() => json(200, session));
    const [a, b, c] = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(session);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('allows a new refresh once the previous one has finished', async () => {
    const fetchMock = mockFetch(() => json(200, session));
    await refreshSession();
    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('takes a cross-tab Web Lock around the request when available', async () => {
    mockFetch(() => json(200, session));
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
    vi.stubGlobal('navigator', { locks: { request } });
    await refreshSession();
    expect(request).toHaveBeenCalledWith('shortlist-refresh', expect.any(Function));
  });

  it('sends credentials so the httpOnly cookie is included', async () => {
    const fetchMock = mockFetch(() => json(200, session));
    await refreshSession();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  it('returns null when there is no valid session', async () => {
    mockFetch(() => json(401, { message: 'Not signed in' }));
    expect(await refreshSession()).toBeNull();
  });
});

describe('api', () => {
  it('attaches the in-memory access token', async () => {
    setAccessToken('abc');
    const fetchMock = mockFetch(() => json(200, []));
    await api('/skills');
    expect(authHeader(fetchMock.mock.calls[0]![1])).toBe('Bearer abc');
  });

  it('on 401, refreshes once and retries with the new token', async () => {
    setAccessToken('expired');
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, session);
      return authHeader(init) === 'Bearer fresh-token' ? json(200, [{ id: 's1' }]) : json(401, {});
    });
    await expect(api('/skills')).resolves.toEqual([{ id: 's1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3); // original, refresh, retry
  });

  it('signs out and throws when the refresh also fails', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    mockFetch(() => json(401, { message: 'Invalid or expired access token' }));
    await expect(api('/skills')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not try to refresh on a 401 from an auth endpoint (wrong password)', async () => {
    const fetchMock = mockFetch(() => json(401, { message: 'Invalid email or password' }));
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toThrow('Invalid email or password');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes field-level validation errors', async () => {
    mockFetch(() => json(400, { message: 'Validation failed', errors: [{ path: 'email', message: 'Invalid email address' }] }));
    const err = await api('/auth/register', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fieldErrors).toEqual({ email: 'Invalid email address' });
  });

  it('returns undefined for 204 No Content', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});
