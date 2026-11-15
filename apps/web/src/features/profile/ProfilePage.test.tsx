import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { ProfilePage } from './ProfilePage';

// Profile shows Sign out, which needs a signed-in user.
vi.mock('../auth/AuthProvider', () => import('../../test/signed-in'));

const profile = {
  id: 'u1',
  email: 'numan@example.com',
  name: 'Numan Razzaq',
  headline: null,
  targetRole: null,
  location: 'Lahore, Pakistan',
  phone: '+92 300 1234567',
  linkedinUrl: null,
  githubUrl: 'https://github.com/NumanBytes',
  timeZone: 'Asia/Karachi',
  paperSize: 'A4',
  role: 'USER',
  createdAt: new Date().toISOString(),
};
const usage = {
  settings: { maxAnalysesPerDay: 40, monthlyBudgetUsd: 4.5, resumeReuseMinOverlap: 0.85 },
  plan: {
    name: 'STARTER',
    label: 'Starter',
    priceUsdPerMonth: 5,
    period: 'month',
    resetsAt: '2026-12-01T00:00:00Z',
    runNow: false,
    discoveryEveryDays: 1,
    scoredJobs: { used: 120, limit: 300 },
    tailoredResumes: { used: 25, limit: 25 },
  },
  monthToDateUsd: 0.12,
  callsThisMonth: 20,
  analysesLast24h: 20,
  last24hUsd: 0.05,
  jobs: { pending: 1, done: 20, deferred: 0, failed: 0 },
};
const roles = [
  {
    id: 'r1',
    company: 'CloudCard Inc.',
    title: 'Software Engineer',
    startDate: '2024-05-01T00:00:00Z',
    endDate: null,
    isCurrent: true,
    location: null,
  },
];

const setup = () =>
  mockFetch(undefined, (url) =>
    url.endsWith('/education') ||
    url.endsWith('/projects') ||
    url.endsWith('/never-claim') ||
    url.endsWith('/notifications/devices')
      ? []
      : url.endsWith('/work-experiences')
        ? roles
        : url.endsWith('/ai/usage')
          ? usage
          : url.endsWith('/gmail')
            ? { connection: null }
            : profile,
  );
const patches = (fetchMock: ReturnType<typeof setup>) =>
  fetchMock.mock.calls
    .filter(([, i]) => i?.method === 'PATCH')
    .map(([url, i]) => ({ url, body: JSON.parse(i!.body as string) }));

const SETTINGS = { route: '/?tab=settings' };

describe('ProfilePage', () => {
  it('shows who you are, your roles, and the account actions', async () => {
    setup();
    renderWithProviders(<ProfilePage />);
    expect(await screen.findByText('Numan Razzaq')).toBeInTheDocument();
    expect(screen.getByText('Lahore, Pakistan · numan@example.com')).toBeInTheDocument();
    expect(await screen.findByText('Software Engineer')).toBeInTheDocument();
    expect(screen.getByText('CloudCard Inc. · 2024 – Present')).toBeInTheDocument();
    // Settings are the other half (UI audit N2).
    expect(screen.queryByRole('button', { name: /Sign out/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('button', { name: /Sign out/ })).toBeInTheDocument();
    expect(screen.queryByText('Software Engineer')).not.toBeInTheDocument();
  });

  // UI audit N1: opened with no in-app history (a bookmark), back goes to Jobs.
  it('falls back to Jobs when there is nowhere to go back to', async () => {
    setup();
    renderWithProviders(<ProfilePage />);
    expect(await screen.findByRole('button', { name: 'Jobs' })).toBeInTheDocument();
  });

  it('opens the resume import from a link', async () => {
    setup();
    renderWithProviders(<ProfilePage />, { route: '/?open=import' });
    expect(await screen.findByRole('dialog', { name: 'Import from my resume' })).toBeInTheDocument();
  });

  it('edits contact details in a sheet, sending cleared fields as null', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const phone = await screen.findByLabelText('Phone');
    expect(phone).toHaveValue('+92 300 1234567');
    await userEvent.clear(phone);
    await userEvent.type(screen.getByLabelText('LinkedIn URL'), 'https://linkedin.com/in/numan-razzaq');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)[0]!.body).toMatchObject({
      phone: null,
      linkedinUrl: 'https://linkedin.com/in/numan-razzaq',
      name: 'Numan Razzaq',
    });
  });

  it('rejects a non-http link before sending', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(await screen.findByLabelText('LinkedIn URL'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be an http(s) URL')).toBeInTheDocument();
    expect(patches(fetchMock)).toHaveLength(0);
  });

  // Plans in the user's terms (docs/ai-scoring.md §12.5).
  it('shows the plan with what has been used of it', async () => {
    setup();
    renderWithProviders(<ProfilePage />, SETTINGS);
    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('120 of 300')).toBeInTheDocument();
    expect(screen.getByText('25 of 25')).toBeInTheDocument();
    expect(screen.getByText(/Sources are checked every night\./)).toBeInTheDocument();
  });

  // The server pays for AI, so only an admin changes the allowance (Agents.md §2.1).
  it('shows the monthly AI allowance without a way to raise it', async () => {
    setup();
    renderWithProviders(<ProfilePage />, SETTINGS);
    expect(await screen.findByText('Monthly AI allowance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Raise the cap/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Monthly budget in dollars')).not.toBeInTheDocument();
  });

  // A job the user asks about isn't held by this limit; it paces automatic scoring.
  it('raises the daily scoring limit in steps of 5', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />, SETTINGS);
    await userEvent.click(await screen.findByRole('button', { name: /Raise the daily limit/ }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ url: '/api/v1/ai/settings', body: { maxAnalysesPerDay: 45 } }]),
    );
  });

  it('saves the time zone and the resume paper on change', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />, SETTINGS);
    await userEvent.selectOptions(await screen.findByLabelText('Time zone'), 'Europe/Berlin');
    await userEvent.click(screen.getByRole('button', { name: 'US Letter' }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { url: '/api/v1/profile', body: { timeZone: 'Europe/Berlin' } },
        { url: '/api/v1/profile', body: { paperSize: 'LETTER' } },
      ]),
    );
  });
});
