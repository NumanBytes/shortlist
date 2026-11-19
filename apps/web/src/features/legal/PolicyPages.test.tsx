import { screen } from '@testing-library/react';
import type { LegalInfo } from '../../lib/types';
import { mockFetch, renderWithProviders } from '../../test/render';
import { PricingPage } from './PricingPage';
import { PrivacyPage } from './PrivacyPage';
import { RefundsPage } from './RefundsPage';
import { TermsPage } from './TermsPage';

const operator = {
  name: 'Example Operator',
  address: '1 Example Road',
  email: 'help@example.com',
  jurisdiction: 'Exampleland',
};
const legal = (over: Partial<LegalInfo> = {}): LegalInfo => ({
  operator,
  refundWindowDays: 14,
  payments: true,
  gmail: true,
  email: true,
  ...over,
});

// The public policy pages (docs/security.md §8.9). Paddle rejects a domain whose pages miss
// the seller's name, the merchant-of-record sentence, or a 14–90 day refund window.
describe('policy pages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Terms name the operator, Paddle as merchant of record, and the governing law', async () => {
    mockFetch(legal());
    renderWithProviders(<TermsPage />);
    expect(await screen.findByText(/between you and Example Operator/)).toBeInTheDocument();
    expect(screen.getByText(/Paddle.com is the Merchant of Record for all our orders/)).toBeInTheDocument();
    expect(screen.getByText(/governed by the laws of Exampleland/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'help@example.com' })).toHaveAttribute('href', 'mailto:help@example.com');
  });

  it('Refunds give the window in days and send requests through Paddle', async () => {
    mockFetch(legal());
    renderWithProviders(<RefundsPage />);
    expect(await screen.findByText('14 days')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'paddle.net' })).toHaveAttribute('href', 'https://paddle.net');
    expect(document.body.textContent).not.toMatch(/no refunds|all sales are final/i);
  });

  it('Privacy names Anthropic and Paddle, and leaves out what this server does not use', async () => {
    mockFetch(legal({ gmail: false }));
    renderWithProviders(<PrivacyPage />);
    expect(await screen.findByText('Anthropic')).toBeInTheDocument();
    expect(screen.getAllByText('Paddle').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Gmail, only if you connect it/)).not.toBeInTheDocument();
    expect(screen.getByText(/Download my data/)).toBeInTheDocument();
  });

  it('shows visible placeholders and a note for the admin while the operator is not set', async () => {
    mockFetch(legal({ operator: null }));
    renderWithProviders(<TermsPage />);
    expect(await screen.findByText(/\[the operator of this server\]/)).toBeInTheDocument();
    expect(screen.getByText('For the server admin')).toBeInTheDocument();
  });

  it('Pricing shows every plan from PLANS', async () => {
    mockFetch(legal());
    renderWithProviders(<PricingPage />);
    expect(await screen.findByRole('region', { name: 'Free' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Starter' })).toHaveTextContent('$5 / month');
    expect(screen.getByRole('region', { name: 'Pro' })).toHaveTextContent('Find new jobs any time');
    expect(screen.getByRole('region', { name: 'Free' })).toHaveTextContent('50 jobs scored to start');
  });
});
