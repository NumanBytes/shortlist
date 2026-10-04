import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../test/render';
import { AppShell } from './AppShell';

vi.mock('../auth/AuthProvider', () => import('../test/signed-in'));

describe('AppShell account sheet', () => {
  beforeEach(() => mockFetch([]));

  it('opens from the avatar with your details, Profile and Sign out', async () => {
    renderWithProviders(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    const sheet = screen.getByRole('dialog', { name: 'Account' });
    expect(sheet).toHaveTextContent('numan@example.com');
    expect(screen.getByRole('link', { name: /Profile/ })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
  });

  it('switches between System, Light and Dark appearance', async () => {
    renderWithProviders(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('closes when the backdrop is tapped', async () => {
    renderWithProviders(<AppShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('dialog', { name: 'Account' })); // the dialog itself = its backdrop
    expect(screen.queryByText('numan@example.com')).not.toBeInTheDocument();
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
