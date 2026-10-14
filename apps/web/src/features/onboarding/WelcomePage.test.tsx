import { DEFAULT_DISCOVERY_PREFERENCES } from '@shortlist/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { ONBOARDING_DONE_KEY, WelcomePage } from './WelcomePage';

describe('WelcomePage', { timeout: 20_000 }, () => {
  it('starts a new account from neutral search settings, not the builder’s defaults', async () => {
    mockFetch(undefined, (url) =>
      url.endsWith('/discovery/preferences') ? { preferences: DEFAULT_DISCOVERY_PREFERENCES, isDefault: true } : null,
    );
    renderWithProviders(<WelcomePage />, { path: '/welcome', route: '/welcome?step=search' });
    expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument();
    expect(await screen.findByLabelText('On-site or hybrid in')).toHaveValue('');
    expect(screen.getByLabelText('Job titles')).toHaveValue('');
  });

  it('follows the remote boards in one tap', async () => {
    const fetchMock = mockFetch({ added: 7 });
    renderWithProviders(<WelcomePage />, { path: '/welcome', route: '/welcome?step=sources' });
    await userEvent.click(await screen.findByRole('button', { name: 'Follow remote boards' }));
    expect(await screen.findByRole('button', { name: 'Following them' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/v1/discovery/sources/remote-boards')).toBe(true);
  });

  it('finishes onboarding when leaving for Sources, so the gate does not send you back to step 1', async () => {
    localStorage.removeItem(ONBOARDING_DONE_KEY);
    mockFetch(null);
    renderWithProviders(<WelcomePage />, { path: '/welcome', route: '/welcome?step=sources' });
    await userEvent.click(await screen.findByRole('link', { name: 'Set up on Sources' }));
    expect(localStorage.getItem(ONBOARDING_DONE_KEY)).toBe('1');
  });
});
