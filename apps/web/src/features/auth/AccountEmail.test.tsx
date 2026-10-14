import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { renderWithProviders } from '../../test/render';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailGate, VerifyEmailPage } from './AccountEmail';

const reload = vi.fn(() => Promise.resolve());
const logout = vi.fn();
let signedIn = true;
vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    state: signedIn
      ? { status: 'signedIn', user: { id: 'u1', email: 'numan@example.com', emailVerifiedAt: null } }
      : { status: 'signedOut' },
    reload,
    logout,
  }),
}));

const TOKEN = 'a'.repeat(43);
const ok = (status = 204) => vi.fn(async () => new Response(status === 204 ? null : '{}', { status }));
const body = (m: ReturnType<typeof vi.fn>, i = 0) =>
  JSON.parse((m.mock.calls[i] as [string, RequestInit])[1].body as string);
function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}

// docs/security.md §8.7
describe('account emails', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    signedIn = true;
  });

  it('the gate resends the verification email', async () => {
    const fetchMock = ok(202);
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<VerifyEmailGate />);
    expect(screen.getByText('numan@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send the link again' }));
    expect(await screen.findByText(/Sent again/)).toBeInTheDocument();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/auth/resend-verification');
  });

  it('confirms the email from the link once, and drops the token from the address bar', async () => {
    signedIn = false;
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <>
        <VerifyEmailPage />
        <Where />
      </>,
      { route: `/?token=${TOKEN}` },
    );
    expect(await screen.findByText('Email confirmed')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body(fetchMock)).toEqual({ token: TOKEN });
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('forgot password gives the same answer whatever the email', async () => {
    const fetchMock = ok(202);
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByText(/If/)).toHaveTextContent('If someone@example.com has a Shortlist account');
    expect(body(fetchMock)).toEqual({ email: 'someone@example.com' });
  });

  it('resets the password with the token from the link', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>,
      { path: '*', route: `/reset-password?token=${TOKEN}` },
    );
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    await waitFor(() => expect(body(fetchMock)).toEqual({ token: TOKEN, password: 'a brand new passphrase' }));
  });
});
