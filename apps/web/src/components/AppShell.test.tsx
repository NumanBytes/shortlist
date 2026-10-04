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

describe('AppShell navigation', () => {
  it('brings the Jobs tab back to the job you left, not the top of the list', async () => {
    mockFetch([]);
    renderWithProviders(<AppShell />, { path: '*', route: '/jobs/j1?tab=interested' });
    // On the job, Jobs leads to the list (keeping its tab).
    expect(screen.getAllByRole('link', { name: 'Jobs' })[0]).toHaveAttribute('href', '/?tab=interested');
    await userEvent.click(screen.getAllByRole('link', { name: 'Evidence' })[0]!);
    expect(screen.getAllByRole('link', { name: 'Jobs' })[0]).toHaveAttribute('href', '/jobs/j1?tab=interested');
  });

  it('shows a resume being tailored on every page, linking back to its job', async () => {
    mockFetch(undefined, (url) =>
      url === '/api/v1/resumes/active'
        ? [{ jobId: 'j9', title: 'Full Stack Engineer', company: 'Kwanso', queuedAt: new Date().toISOString() }]
        : [],
    );
    renderWithProviders(<AppShell />, { path: '*', route: '/evidence' });
    const bar = await screen.findByRole('link', { name: /Tailoring resume/ });
    expect(bar).toHaveAttribute('href', '/jobs/j9');
    expect(bar).toHaveTextContent('Kwanso');
  });
});
