import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GmailStatus } from '../lib/types';
import { mockFetch, renderWithProviders } from '../test/render';
import { GmailCard } from './GmailCard';

const empty = { parsed: 0, unparsed: 0, failed: 0, unparsedSenders: [] };
const notConnected: GmailStatus = { configured: true, connection: null, last30Days: empty };
const connected = (over: Partial<NonNullable<GmailStatus['connection']>> = {}): GmailStatus => ({
  configured: true,
  connection: {
    emailAddress: 'numan@gmail.com',
    labelName: 'Shortlist',
    status: 'ACTIVE',
    lastError: null,
    connectedAt: '2026-10-03T00:00:00Z',
    lastCheckedAt: new Date().toISOString(),
    lastCheckStatus: 'SUCCESS',
    lastCheckFound: 3,
    ...over,
  },
  last30Days: { parsed: 0, unparsed: 3, failed: 0, unparsedSenders: [{ sender: 'jobalerts-noreply@linkedin.com', count: 3 }] },
});

const posts = (fetch: ReturnType<typeof mockFetch>, method = 'POST') =>
  fetch.mock.calls.filter(([, init]) => init?.method === method).map(([url]) => String(url));

describe('GmailCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('explains it is not set up when the server has no Google client', async () => {
    mockFetch({ ...notConnected, configured: false });
    renderWithProviders(<GmailCard />);
    expect(await screen.findByText(/Not set up on this server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Gmail/ })).not.toBeInTheDocument();
  });

  it('states the read-only limits, then sends the browser to Google', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetch = mockFetch({}, (url) => (url.endsWith('/gmail/connect') ? { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } : notConnected));
    renderWithProviders(<GmailCard />);
    expect(await screen.findByText(/Read-only: Shortlist can’t send, delete or change mail/)).toBeInTheDocument();
    expect(screen.getByText(/Reads only messages with your “Shortlist” label/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Connect Gmail/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    expect(posts(fetch)).toEqual([expect.stringMatching(/\/gmail\/connect$/)]);
  });

  it('shows the connection, the last check and which senders have no parser yet', async () => {
    const fetch = mockFetch(connected());
    renderWithProviders(<GmailCard />);
    expect(await screen.findByText('numan@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/3 new messages/)).toBeInTheDocument();
    expect(screen.getByText('jobalerts-noreply@linkedin.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Check now/ }));
    await waitFor(() => expect(posts(fetch)).toEqual([expect.stringMatching(/\/gmail\/check$/)]));
  });

  it('asks to reconnect when Google revoked access, and shows why', async () => {
    mockFetch(connected({ status: 'NEEDS_RECONNECT', lastError: 'Google access was revoked or expired — reconnect Gmail', lastCheckStatus: 'FAILED' }));
    renderWithProviders(<GmailCard />);
    expect(await screen.findByText(/revoked or expired/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect Gmail/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check now/ })).not.toBeInTheDocument();
  });

  it('confirms before disconnecting', async () => {
    const fetch = mockFetch(connected());
    renderWithProviders(<GmailCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(posts(fetch, 'DELETE')).toEqual([]);
    expect(screen.getByText(/Disconnect and revoke access\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(posts(fetch, 'DELETE')).toEqual([expect.stringMatching(/\/gmail$/)]));
  });

  it('explains a refused connect attempt from the redirect', async () => {
    mockFetch(notConnected);
    renderWithProviders(<GmailCard />, { path: '/sources', route: '/sources?gmail=mismatch' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t start in this browser/);
  });
});
