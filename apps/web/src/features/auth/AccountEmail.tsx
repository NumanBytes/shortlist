import { ForgotPasswordSchema, ResetPasswordSchema } from '@shortlist/shared';
import { MailCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../../components/Logo';
import { Button, TextField, buttonStyles } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from './AuthProvider';

// Email verification and password reset (docs/security.md §8.7). The links in the emails
// open these pages; each reads its token once, removes it from the address bar (so it
// doesn't sit in history), and POSTs it.

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex justify-center">
        <Logo size="lg" />
      </div>
      <div className="space-y-4">
        <h1 className="text-title font-bold text-fg">{title}</h1>
        {children}
      </div>
    </main>
  );
}

// The token from ?token=, read once and then dropped from the URL.
function useLinkToken(): string | null {
  const [params, setParams] = useSearchParams();
  const [token] = useState(() => params.get('token'));
  useEffect(() => {
    if (params.has('token')) setParams({}, { replace: true });
  }, [params, setParams]);
  return token;
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

// Shown instead of the app while a signed-in account hasn't confirmed its address.
export function VerifyEmailGate() {
  const { state, logout, reload } = useAuth();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'checking'>('idle');
  const [error, setError] = useState<string>();
  const email = state.status === 'signedIn' ? state.user.email : '';
  return (
    <AuthCard title="Check your inbox">
      <div className="flex gap-3 rounded-md bg-accent-soft p-4 text-body text-fg">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-accent-fg" aria-hidden="true" />
        <p>
          We sent a link to <b className="font-semibold break-all">{email}</b>. Open it to confirm this is your address,
          then come back here.
        </p>
      </div>
      {status === 'sent' && <output className="block text-footnote text-muted">Sent again — check spam too.</output>}
      {error && <p className="text-footnote text-danger-fg">{error}</p>}
      <Button
        size="lg"
        className="w-full"
        disabled={status === 'checking'}
        onClick={() => {
          setStatus('checking');
          void reload().finally(() => setStatus('idle'));
        }}
      >
        I've confirmed it
      </Button>
      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        disabled={status === 'sending'}
        onClick={() => {
          setError(undefined);
          setStatus('sending');
          api('/auth/resend-verification', { method: 'POST' }).then(
            () => setStatus('sent'),
            (err) => {
              setError(message(err));
              setStatus('idle');
            },
          );
        }}
      >
        Send the link again
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => void logout()}>
        Sign out
      </Button>
    </AuthCard>
  );
}

// The link from the verification email. Works signed in or not (it may open on a phone).
export function VerifyEmailPage() {
  const token = useLinkToken();
  const { state, reload } = useAuth();
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return; // StrictMode mounts twice; a token works once
    sent.current = true;
    if (!token) return setResult({ ok: false, error: 'This link is incomplete — open it from the email again.' });
    api('/auth/verify-email', { method: 'POST', body: { token } }).then(
      () => setResult({ ok: true }),
      (err) => setResult({ ok: false, error: message(err) }),
    );
  }, [token]);
  const signedIn = state.status === 'signedIn';
  const navigate = useNavigate();
  return (
    <AuthCard title={result?.ok ? 'Email confirmed' : result ? "That link didn't work" : 'Confirming…'}>
      {result?.ok && (
        <>
          <p className="text-body text-muted">Thanks — your address is confirmed.</p>
          {signedIn ? (
            <Button
              size="lg"
              className="w-full"
              onClick={() => void reload().then(() => navigate('/', { replace: true }))}
            >
              Open Shortlist
            </Button>
          ) : (
            <Link to="/login" className={`${buttonStyles('primary', 'lg')} w-full`}>
              Sign in
            </Link>
          )}
        </>
      )}
      {result && !result.ok && (
        <>
          <p className="text-body text-muted">{result.error}</p>
          <Link to="/" className={`${buttonStyles('secondary', 'lg')} w-full`}>
            {signedIn ? 'Send a new link' : 'Sign in to send a new link'}
          </Link>
        </>
      )}
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ForgotPasswordSchema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    setBusy(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: parsed.data });
      setSent(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Reset your password">
      {sent ? (
        // The same answer whether or not the address has an account (docs/security.md §8.7).
        <p className="text-body text-muted">
          If <b className="font-semibold break-all text-fg">{email}</b> has a Shortlist account, a link to choose a new
          password is on its way. It works for one hour.
        </p>
      ) : (
        <form noValidate onSubmit={submit} className="space-y-4">
          <p className="text-body text-muted">Enter your account's email and we'll send you a link.</p>
          <TextField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send the link'}
          </Button>
        </form>
      )}
      <Link to="/login" className="block text-center text-body font-medium text-accent-fg">
        Back to sign in
      </Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useLinkToken();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ResetPasswordSchema.safeParse({ token: token ?? '', password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: parsed.data });
      setDone(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title={done ? 'Password changed' : 'Choose a new password'}>
      {done ? (
        <>
          <p className="text-body text-muted">You've been signed out everywhere. Sign in with your new password.</p>
          <Link to="/login" className={`${buttonStyles('primary', 'lg')} w-full`}>
            Sign in
          </Link>
        </>
      ) : (
        <form noValidate onSubmit={submit} className="space-y-4">
          <TextField
            id="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            aria-describedby="new-password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
          {!error && (
            <p id="new-password-hint" className="-mt-2 text-footnote text-muted">
              At least 8 characters.
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </Button>
          <Link to="/forgot-password" className="block text-center text-body font-medium text-accent-fg">
            Need a new link?
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
