import { LoginSchema, RegisterSchema } from '@shortlist/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Logo';
import { Button, TextField } from '../components/ui';
import { ApiError } from '../lib/api';

// Login and register share one form. Validation uses the same Zod schemas the API
// enforces, so the browser rejects exactly what the server would — before a round trip.
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const [fields, setFields] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === 'register';

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  // Returns a ready-to-run submit, or null (after showing field errors) if invalid.
  function withParsed<T>(
    result: { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
    action: (data: T) => Promise<void>,
  ): (() => Promise<void>) | null {
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message])));
      return null;
    }
    return () => action(result.data);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    // Each branch keeps its own typed result, so no casts are needed below.
    const submit = isRegister
      ? withParsed(RegisterSchema.safeParse(fields), register)
      : withParsed(LoginSchema.safeParse({ email: fields.email, password: fields.password }), login);
    if (!submit) return;
    setErrors({});
    setSubmitting(true);
    try {
      await submit();
      // AuthProvider flips to signedIn; the router redirects away from this page.
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo />
      <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-fg">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-1 text-sm text-muted">Finds jobs worth your time. Tailors a truthful resume. You make the final click.</p>
        </div>
        {isRegister && (
          <TextField id="name" label="Name" autoComplete="name" value={fields.name} onChange={set('name')} error={errors.name} />
        )}
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={fields.email}
          onChange={set('email')}
          error={errors.email}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          value={fields.password}
          onChange={set('password')}
          error={errors.password}
        />
        {formError && (
          <p role="alert" className="text-sm text-danger-fg">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="h-11 w-full">
          {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </Button>
        <p className="text-center text-sm text-muted">
          {isRegister ? (
            <>
              Have an account? <Link className="font-medium text-fg underline" to="/login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link className="font-medium text-fg underline" to="/register">Create an account</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
