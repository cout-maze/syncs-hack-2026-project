import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginInputSchema } from '@rmc/shared';
import { useAuth } from './AuthProvider';
import { AuthLayout } from './AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { errorMessage } from '@/lib/api/errors';
import { API_MODE } from '@/lib/env';
import { DEMO_ACCOUNT } from '@/mocks/fixtures';

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState(API_MODE === 'msw' ? DEMO_ACCOUNT.email : '');
  const [password, setPassword] = useState(API_MODE === 'msw' ? DEMO_ACCOUNT.password : '');
  // Purely presentational — toggles the input type, nothing else.
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = LoginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      await login(parsed.data);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
    } catch (error) {
      setFormError(errorMessage(error, 'Could not sign you in.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back, planner"
      subtitle="Sign in to keep rebuilding."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="font-semibold text-honey-deep hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          error={fieldErrors.email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
          className="pr-12"
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="grid size-9 place-items-center rounded-full text-faint transition-colors hover:bg-paper-200 hover:text-ink"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
        />

        {formError && (
          <p
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="mt-0.5 size-4 shrink-0"
            >
              <path
                d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{formError}</span>
          </p>
        )}

        <Button type="submit" size="lg" loading={submitting} className="mt-1 group">
          Sign in
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </Button>

        {API_MODE === 'msw' && (
          <p className="flex items-center justify-center gap-1.5 rounded-pill bg-paper-100 px-3 py-1.5 text-xs font-semibold text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-honey" />
            Mock mode — the demo account is pre-filled
          </p>
        )}
      </form>
    </AuthLayout>
  );
}

export function fieldErrorsFrom(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="size-4.5"
    >
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="size-4.5"
    >
      <path d="m4 4 16 16" strokeLinecap="round" />
      <path
        d="M10.7 5.7c.4-.1.9-.2 1.3-.2 6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-2.9 3.7M6.7 6.7A16.4 16.4 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.5 4.3-1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.9 10.1a3 3 0 0 0 4.1 4.2" strokeLinecap="round" />
    </svg>
  );
}
