import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { AdminPage } from './AdminPage';

vi.mock('../auth/AuthProvider', () => import('../../test/signed-in'));

const me = (role: 'USER' | 'ADMIN') => ({
  id: 'u1',
  email: 'admin@example.com',
  name: 'Admin',
  role,
  timeZone: 'UTC',
  paperSize: 'A4',
  emailVerifiedAt: '2026-11-01T00:00:00Z',
  createdAt: '2026-11-01T00:00:00Z',
});
const accounts = [
  {
    id: 'u2',
    email: 'someone@example.com',
    name: 'Someone',
    role: 'USER',
    createdAt: '2026-11-02T00:00:00Z',
    emailVerifiedAt: null,
    monthlyBudgetUsd: 1,
    monthToDateUsd: 0.42,
  },
];

const setup = (role: 'USER' | 'ADMIN') =>
  mockFetch(undefined, (url) => (url.endsWith('/admin/users') ? accounts : me(role)));
const puts = (fetchMock: ReturnType<typeof setup>) =>
  fetchMock.mock.calls
    .filter(([, i]) => i?.method === 'PUT')
    .map(([url, i]) => ({ url, body: JSON.parse(i!.body as string) }));

describe('AdminPage', () => {
  it("lists accounts with this month's spend and sets a budget", async () => {
    const fetchMock = setup('ADMIN');
    renderWithProviders(<AdminPage />);
    expect(await screen.findByText('someone@example.com · email not verified')).toBeInTheDocument();
    expect(screen.getByText('$0.42 of $1.00 this month')).toBeInTheDocument();
    const input = screen.getByLabelText('Monthly AI budget (USD)');
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(puts(fetchMock)).toEqual([{ url: '/api/v1/admin/users/u2/ai-budget', body: { monthlyBudgetUsd: 5 } }]),
    );
  });

  it('does not send an emptied budget as $0', async () => {
    const fetchMock = setup('ADMIN');
    renderWithProviders(<AdminPage />);
    await userEvent.clear(await screen.findByLabelText('Monthly AI budget (USD)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a dollar amount from 0 to 1000')).toBeInTheDocument();
    expect(puts(fetchMock)).toHaveLength(0);
  });

  it('never asks for the account list when the user is not an admin', async () => {
    const fetchMock = setup('USER');
    renderWithProviders(<AdminPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/admin/users'))).toBe(false);
  });
});
