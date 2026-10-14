import { LoginSchema, RegisterSchema } from '@shortlist/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from './AuthProvider';
import { Logo } from '../../components/Logo';
import { Eye, EyeOff } from 'lucide-react';
import { Button, INPUT, SELECTED, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';

// Login and register share one form. Validation uses the same Zod schemas the API
// enforces, so the browser rejects exactly what the server would — before a round trip.
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const [fields, setFields] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isRegister = mode === 'register';

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  // Returns a ready-to-run submit, or null (after showing field errors) if invalid.
  function withParsed<T>(
    result:
      { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
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
    // Sign in (design board 7): the mark and promise up top, the form within thumb reach.
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:justify-center sm:gap-10">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center sm:flex-none">
        <Logo size="lg" />
        <p className="max-w-[17rem] text-body text-muted">
          Jobs that fit your real skills. Resumes that stay true. You hit submit.
        </p>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <nav aria-label="Sign in or register" className="grid grid-cols-2 gap-0.5 rounded-md bg-surface-2 p-[3px]">
          {(
            [
              ['/login', 'Sign in', !isRegister],
              ['/register', 'Register', isRegister],
            ] as const
          ).map(([to, label, on]) => (
            <Link
              key={to}
              to={to}
              aria-current={on ? 'page' : undefined}
              className={`grid h-[38px] place-items-center rounded-sm text-footnote font-medium ${on ? SELECTED : 'text-muted'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <h1 className="sr-only">{isRegister ? 'Create your account' : 'Sign in'}</h1>
        {isRegister && (
          <TextField
            id="name"
            label="Name"
            autoComplete="name"
            value={fields.name}
            onChange={set('name')}
            error={errors.name}
          />
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
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-footnote font-medium text-muted">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={fields.password}
              onChange={set('password')}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : isRegister ? 'password-hint' : undefined}
              className={`${INPUT} h-12 pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 grid w-12 place-items-center text-muted"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          {/* The rule up front, not only after a failed submit (UI audit A2). Fields are all
              48px, the TextField height (A1). */}
          {errors.password ? (
            <p id="password-error" className="text-footnote text-danger-fg">
              {errors.password}
            </p>
          ) : (
            isRegister && (
              <p id="password-hint" className="text-footnote text-muted">
                At least 8 characters.
              </p>
            )
          )}
        </div>
        {formError && (
          <p role="alert" className="text-footnote text-danger-fg">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
