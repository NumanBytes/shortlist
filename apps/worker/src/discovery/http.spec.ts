import { lookup } from 'node:dns/promises';
import { getJson, getText } from './http.js';

// Every worker fetch is public-only, source URLs included: any user can add a careers page.
describe('http', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a source whose host resolves to a private address, before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as never);
    await expect(getText('https://careers.evil.example/')).rejects.toThrow(/private address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a redirect into the cloud metadata service', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(getJson('https://boards-api.greenhouse.io/v1/boards/x/jobs')).rejects.toThrow(/non-public/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('follows a public redirect', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/careers' } }))
      .mockResolvedValueOnce(new Response('<h1>Jobs</h1>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getText('https://example.com/jobs')).toBe('<h1>Jobs</h1>');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://example.com/careers');
  });
});
