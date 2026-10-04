import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../test/render';
import { ProfilePage } from './ProfilePage';

// The page header shows the account button, which needs a signed-in user.
vi.mock('../auth/AuthProvider', () => import('../test/signed-in'));

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

const setup = () => mockFetch(undefined, (url) => (url.endsWith('/education') ? [] : profile));

describe('ProfilePage', () => {
  it('saves contact details, sending cleared fields as null', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />);
    const phone = await screen.findByLabelText('Phone');
    expect(phone).toHaveValue('+92 300 1234567');
    await userEvent.clear(phone);
    await userEvent.type(screen.getByLabelText('LinkedIn URL'), 'https://linkedin.com/in/numan-razzaq');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')![1]!.body as string);
    expect(body).toMatchObject({ phone: null, linkedinUrl: 'https://linkedin.com/in/numan-razzaq', name: 'Numan Razzaq' });
  });

  it('rejects a non-http link before sending', async () => {
    const fetchMock = setup();
    renderWithProviders(<ProfilePage />);
    await userEvent.type(await screen.findByLabelText('LinkedIn URL'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be an http(s) URL')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);
  });
});
