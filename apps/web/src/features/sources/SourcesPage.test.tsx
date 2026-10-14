import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SourcesPage } from './SourcesPage';

// The page header shows the account button, which needs a signed-in user.
vi.mock('../auth/AuthProvider', () => import('../../test/signed-in'));

const usage = {
  settings: { maxAnalysesPerDay: 40, monthlyBudgetUsd: 4.5, resumeReuseMinOverlap: 0.85 },
  monthToDateUsd: 0.12,
  callsThisMonth: 20,
  analysesLast24h: 20,
  last24hUsd: 0.05,
  jobs: { pending: 1, done: 20, deferred: 0, failed: 0 },
};

function setup() {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = url.endsWith('/ai/usage')
      ? usage
      : url.endsWith('/discovery/sources')
        ? []
        : url.endsWith('/gmail')
          ? {
              configured: false,
              connection: null,
              last30Days: { alerts: 0, notAlerts: 0, deferred: 0, failed: 0, portals: [] },
            }
          : {};
    return new Response(JSON.stringify(init.method === 'PATCH' ? usage.settings : body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SourcesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('SourcesPage', () => {
  it("shows this month's AI spend against the budget, today's spend, and links to the budget", async () => {
    setup();
    expect(await screen.findByText('$0.12')).toBeInTheDocument();
    expect(screen.getByText('of $4.50')).toBeInTheDocument();
    expect(screen.getByText('$0.05')).toBeInTheDocument(); // today
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('href', '/profile?tab=settings');
  });

  // docs/discovery.md §9.15: a company's jobs page is added from the app, not in code.
  it('adds a company jobs page, checking the fields first', async () => {
    const fetchMock = setup();
    await userEvent.click(await screen.findByRole('button', { name: /Add a company's jobs page/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(screen.getByText('Give the company a name')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);

    await userEvent.type(screen.getByLabelText('Company'), 'BrainX');
    await userEvent.type(screen.getByLabelText('Jobs page link'), 'careers.brainxtech.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
      expect(post![0]).toBe('/api/v1/discovery/sources');
      expect(JSON.parse(post![1]!.body as string)).toEqual({ name: 'BrainX', link: 'careers.brainxtech.com' });
    });
  });
});
