import { STARTER_DISCOVERY_PREFERENCES } from '@shortlist/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { ONBOARDING_DONE_KEY, WelcomePage } from './WelcomePage';

describe('WelcomePage', { timeout: 20_000 }, () => {
  it('starts a new account from neutral search settings, not the builder’s defaults', async () => {
    mockFetch(undefined, (url) =>
      url.endsWith('/discovery/preferences') ? { preferences: STARTER_DISCOVERY_PREFERENCES, isDefault: true } : null,
    );
    renderWithProviders(<WelcomePage />, { path: '/welcome', route: '/welcome?step=search' });
    expect(await screen.findByText('Step 2 of 3')).toBeInTheDocument();
    expect(await screen.findByLabelText('On-site or hybrid in')).toHaveValue('');
    expect(screen.getByLabelText('Job titles')).toHaveValue('');
  });

  it('follows the remote boards in one tap', async () => {
    const fetchMock = mockFetch(undefined, (url) =>
      url.includes('/discovery/catalog')
        ? []
        : url.endsWith('/discovery/preferences')
          ? { preferences: STARTER_DISCOVERY_PREFERENCES, isDefault: true }
          : { added: 7 },
    );
    renderWithProviders(<WelcomePage />, { path: '/welcome', route: '/welcome?step=sources' });
    await userEvent.click(await screen.findByRole('button', { name: 'Follow remote boards' }));
    expect(await screen.findByRole('button', { name: 'Following them' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/v1/discovery/sources/remote-boards')).toBe(true);
  });

  // The shared catalog (docs/discovery.md §9.16): companies hiring where the user works on site.
  it('follows the catalog companies in the places the user named, in one tap', async () => {
    const entry = (name: string, regions: string[], type = 'MANUAL') => ({
      id: name,
      name,
      type,
      provider: 'careers_page',
      regions,
      following: false,
    });
    const fetchMock = mockFetch(undefined, (url) =>
      url.endsWith('/discovery/preferences')
        ? { preferences: { ...STARTER_DISCOVERY_PREFERENCES, onsiteLocations: ['lahore'] }, isDefault: false }
        : url.includes('/discovery/catalog/follow-places')
          ? { followed: 2 }
          : url.includes('/discovery/catalog')
            ? [
                entry('Acme', ['lahore', 'pakistan']),
                entry('Globex', ['lahore']),
                entry('Initech', ['berlin']),
                entry('Remote OK', ['remote'], 'AGGREGATOR_API'),
              ]
            : null,
    );
    renderWithProviders(<WelcomePage />, { path: '/welcome', route: '/welcome?step=sources' });
    expect(await screen.findByText(/2 companies hire where you work on site: Acme, Globex/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Follow 2 companies' }));
    expect(await screen.findByRole('button', { name: 'Following them' })).toBeDisabled();
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/v1/discovery/catalog/follow-places');
    expect(JSON.parse(call![1]!.body as string)).toEqual({ regions: ['lahore'] });
  });

  it('finishes onboarding when leaving for Sources, so the gate does not send you back to step 1', async () => {
    localStorage.removeItem(ONBOARDING_DONE_KEY);
    mockFetch(null);
    renderWithProviders(<WelcomePage />, { path: '/welcome', route: '/welcome?step=sources' });
    await userEvent.click(await screen.findByRole('link', { name: 'Set up on Sources' }));
    expect(localStorage.getItem(ONBOARDING_DONE_KEY)).toBe('1');
  });
});
