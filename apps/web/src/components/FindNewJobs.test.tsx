import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscoveryStatus, RunNowResult } from '../lib/types';
import { mockFetch, renderWithProviders } from '../test/render';
import { FindNewJobs } from './FindNewJobs';

const status = (over: Partial<DiscoveryStatus> = {}): DiscoveryStatus => ({
  enabledSources: 12,
  lastCheckedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  running: 0,
  availableAt: null,
  nextNightlyAt: '2026-10-05T21:00:00Z',
  workerOnline: true,
  cooldownHours: 6,
  ...over,
});
const ran: RunNowResult = { queued: ['Remotive', 'Kwanso'], skipped: [], cooldownHours: 6, emailQueued: true };

describe('FindNewJobs', () => {
  it('says how fresh the list is', async () => {
    mockFetch(status());
    renderWithProviders(<FindNewJobs />);
    expect(await screen.findByText('Last checked 2d ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check for new jobs/ })).toHaveAttribute('title', expect.stringMatching(/every night/));
  });

  it('queues a check of every source and Gmail, and confirms it', async () => {
    const fetchMock = mockFetch(undefined, (url) => (url.endsWith('/discovery/run') ? ran : status()));
    renderWithProviders(<FindNewJobs />);
    await userEvent.click(await screen.findByRole('button', { name: /Check for new jobs/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/v1/discovery/run' && init?.method === 'POST')).toBe(true));
    expect(await screen.findByText('Checking 2 sources and your Gmail alerts for new jobs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Checking/ })).toBeDisabled(); // no double-queuing
  });

  it("says so when no worker is running, instead of pretending to check", async () => {
    mockFetch(status({ workerOnline: false }));
    renderWithProviders(<FindNewJobs />);
    expect(await screen.findByText(/background worker isn't running/)).toBeInTheDocument();
  });

  it('says when sources can be checked again during the cooldown (no Gmail to check)', async () => {
    mockFetch(undefined, (url) => (url.endsWith('/gmail') ? { configured: true, connection: null } : status({ availableAt: new Date(Date.now() + 3 * 3600_000).toISOString() })));
    renderWithProviders(<FindNewJobs />);
    expect(await screen.findByRole('button', { name: /Available again in 3h/ })).toBeDisabled();
  });

  it('shows a run in progress', async () => {
    mockFetch(status({ running: 3 }));
    renderWithProviders(<FindNewJobs />);
    expect(await screen.findByText('Checking 3 sources…')).toBeInTheDocument();
  });
});
