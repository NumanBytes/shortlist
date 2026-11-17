import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openCheckout } from '../../lib/paddle';
import type { BillingInfo } from '../../lib/types';
import { mockFetch, renderWithProviders } from '../../test/render';
import { PlanBilling } from './PlanBilling';

// Paddle.js itself is never loaded in tests.
vi.mock('../../lib/paddle', () => ({ openCheckout: vi.fn(async () => undefined) }));

const client = { environment: 'sandbox' as const, token: 'test_token' };
const billing = (over: Partial<BillingInfo> = {}): BillingInfo => ({
  enabled: true,
  client,
  plan: 'FREE',
  subscription: null,
  ...over,
});
const subscribed = (sub: Partial<NonNullable<BillingInfo['subscription']>> = {}) =>
  billing({
    plan: 'STARTER',
    subscription: {
      plan: 'STARTER',
      status: 'ACTIVE',
      currentPeriodEndsAt: '2026-12-17T00:00:00Z',
      cancelsAt: null,
      ...sub,
    },
  });

const setup = (info: BillingInfo) =>
  mockFetch(undefined, (url) =>
    url.endsWith('/billing/checkout')
      ? { checkoutId: 'txn_1' }
      : url.endsWith('/billing/portal')
        ? { overview: 'https://portal.test/o', cancel: null }
        : url.endsWith('/billing')
          ? info
          : {},
  );
const posted = (fetchMock: ReturnType<typeof setup>) =>
  fetchMock.mock.calls
    .filter(([, i]) => i?.method === 'POST')
    .map(([url, i]) => ({ url, body: i?.body ? JSON.parse(i.body as string) : undefined }));

describe('PlanBilling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows nothing on a server without payments', async () => {
    const fetchMock = setup(billing({ enabled: false, client: null }));
    renderWithProviders(<PlanBilling />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Choose/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Upgrade any time/)).not.toBeInTheDocument();
  });

  it('offers both plans and opens Paddle checkout for a transaction the server made', async () => {
    const fetchMock = setup(billing());
    renderWithProviders(<PlanBilling />);
    expect(await screen.findByText(/\$20\/month · 1,000 jobs scored, 100 tailored resumes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose Pro' }));
    await waitFor(() => expect(openCheckout).toHaveBeenCalledWith(client, 'txn_1', expect.any(Function)));
    expect(posted(fetchMock)).toEqual([{ url: '/api/v1/billing/checkout', body: { plan: 'PRO' } }]);
  });

  it('shows when a subscription renews, and switches plan after asking', async () => {
    const fetchMock = setup(subscribed());
    renderWithProviders(<PlanBilling />);
    expect(await screen.findByText(/Renews on/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Pro' }));
    expect(screen.getByText(/You pay the difference for the rest of this month today/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Switch to Pro' }).at(-1)!);
    await waitFor(() =>
      expect(posted(fetchMock)).toEqual([{ url: '/api/v1/billing/change-plan', body: { plan: 'PRO' } }]),
    );
  });

  it('says when a cancellation takes effect, and offers no switch then', async () => {
    setup(subscribed({ cancelsAt: '2026-12-17T00:00:00Z' }));
    renderWithProviders(<PlanBilling />);
    expect(await screen.findByText(/Cancels on .* You keep Starter until then\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument();
  });

  it('asks for a new card after a failed payment, through the portal', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, href: 'http://localhost/profile' });
    const fetchMock = setup(subscribed({ status: 'PAST_DUE' }));
    renderWithProviders(<PlanBilling />);
    expect(await screen.findByText(/Your last payment didn't go through/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update card' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://portal.test/o'));
    expect(posted(fetchMock).map((c) => c.url)).toEqual(['/api/v1/billing/portal']);
  });
});
