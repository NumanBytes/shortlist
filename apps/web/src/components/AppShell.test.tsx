import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../test/render';
import { AppShell } from './AppShell';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    state: { status: 'signedIn', user: { id: 'u1', name: 'Numan Razzaq', email: 'numan@example.com' } },
    logout: vi.fn(),
  }),
}));

describe('AppShell account menu', () => {
  beforeEach(() => mockFetch([]));

  it('opens, then closes on an outside click', async () => {
    renderWithProviders(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menu')).toHaveTextContent('numan@example.com');
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderWithProviders(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
