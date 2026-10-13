import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { OnboardingGate } from '../../App';
import { mockFetch } from '../../test/render';
import { ONBOARDING_DONE_KEY } from './WelcomePage';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<OnboardingGate />}>
            <Route path="/" element={<p>Jobs</p>} />
            <Route path="/welcome" element={<p>Welcome</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingGate', () => {
  afterEach(() => localStorage.clear());

  it('sends a brand-new account to /welcome', async () => {
    mockFetch({ needed: true, hasPreferences: false, hasCareerData: false, hasSources: false });
    renderAt('/');
    expect(await screen.findByText('Welcome')).toBeInTheDocument();
  });

  it('leaves an account with anything saved alone', async () => {
    mockFetch({ needed: false, hasPreferences: false, hasCareerData: true, hasSources: true });
    renderAt('/');
    expect(await screen.findByText('Jobs')).toBeInTheDocument();
  });

  it('never sends the user back once onboarding was finished, even with every step skipped', async () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    mockFetch({ needed: true, hasPreferences: false, hasCareerData: false, hasSources: false });
    renderAt('/');
    expect(await screen.findByText('Jobs')).toBeInTheDocument();
  });
});
