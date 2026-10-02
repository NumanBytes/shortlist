import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesPage } from './SourcesPage';

const usage = {
  settings: { maxAnalysesPerDay: 40, monthlyBudgetUsd: 4.5, resumeReuseMinOverlap: 0.85 },
  monthToDateUsd: 0.12,
  callsThisMonth: 20,
  analysesLast24h: 20,
  jobs: { pending: 1, done: 20, deferred: 0, failed: 0 },
};

function setup() {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = url.endsWith('/ai/usage') ? usage : url.endsWith('/discovery/sources') ? [] : {};
    return new Response(JSON.stringify(init.method === 'PATCH' ? usage.settings : body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SourcesPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('SourcesPage AI spend card', () => {
  it('shows month-to-date spend against the budget', async () => {
    setup();
    expect(await screen.findByText(/\$0\.12 of \$4\.50 this month/)).toBeInTheDocument();
  });

  it('does not turn an emptied budget field into a $0 budget', async () => {
    const fetchMock = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Change budget' }));
    await userEvent.clear(screen.getByLabelText(/Monthly budget/));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
  });

  it('saves a real value', async () => {
    const fetchMock = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Change budget' }));
    const input = screen.getByLabelText(/Monthly budget/);
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({ monthlyBudgetUsd: 3 });
  });
});
