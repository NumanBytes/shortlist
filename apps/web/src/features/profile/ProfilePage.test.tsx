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
  createdAt: new Date().toISOString(),
};
const usage = {
  settings: { maxAnalysesPerDay: 40, monthlyBudgetUsd: 4.5, resumeReuseMinOverlap: 0.85 },
  monthToDateUsd: 0.12,
  callsThisMonth: 20,
  analysesLast24h: 20,
  last24hUsd: 0.05,
  jobs: { pending: 1, done: 20, deferred: 0, failed: 0 },
};
const roles = [{ id: 'r1', company: 'CloudCard Inc.', title: 'Software Engineer', startDate: '2024-05-01T00:00:00Z', endDate: null, isCurrent: true, location: null }];

const setup = () =>
  mockFetch(undefined, (url) =>
    url.endsWith('/education') || url.endsWith('/projects') ? [] : url.endsWith('/work-experiences') ? roles : url.endsWith('/ai/usage') ? usage : url.endsWith('/gmail') ? { connection: null } : profile,
  );
const patches = (fetchMock: ReturnType<typeof setup>) =>
  fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([url, i]) => ({ url, body: JSON.parse(i!.body as string) }));

describe('ProfilePage', () => {
  it('shows who you are, your roles, and the account actions', async () => {
    setup();
    renderWithProviders(<ProfilePage />);
    expect(await screen.findByText('Numan Razzaq')).toBeInTheDocument();
    expect(screen.getByText('Lahore, Pakistan · numan@example.com')).toBeInTheDocument();
    expect(await screen.findByText('Software Engineer')).toBeInTheDocument();
    expect(screen.getByText('CloudCard Inc. · 2024 – Present')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeInTheDocument();
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
    expect(patches(fetchMock)[0]!.body).toMatchObject({ phone: null, linkedinUrl: 'https://linkedin.com/in/numan-razzaq', name: 'Numan Razzaq' });
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

  it('steps the monthly AI cap', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />);
    await userEvent.click(await screen.findByRole('button', { name: /Raise the cap/ }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ url: '/api/v1/ai/settings', body: { monthlyBudgetUsd: 5.5 } }]));
  });

  it('does not turn an emptied budget field into a $0 budget', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />);
    const input = await screen.findByLabelText('Monthly budget in dollars');
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.tab();
    expect(patches(fetchMock)).toHaveLength(0);
  });

  it('saves a typed budget', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />);
    const input = await screen.findByLabelText('Monthly budget in dollars');
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, '3{Enter}');
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ url: '/api/v1/ai/settings', body: { monthlyBudgetUsd: 3 } }]));
  });
});
