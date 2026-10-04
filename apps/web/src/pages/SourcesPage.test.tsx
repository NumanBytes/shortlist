import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SourcesPage } from './SourcesPage';

// The page header shows the account button, which needs a signed-in user.
vi.mock('../auth/AuthProvider', () => import('../test/signed-in'));

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
          ? { configured: false, connection: null, last30Days: { alerts: 0, notAlerts: 0, deferred: 0, failed: 0, portals: [] } }
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
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('href', '/profile');
  });
});
