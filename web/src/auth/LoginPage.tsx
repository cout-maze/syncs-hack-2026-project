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
          type="password"
          autoComplete="current-password"
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {formError && (
          <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" loading={submitting}>
          Sign in
        </Button>

        {API_MODE === 'msw' && (
          <p className="text-center text-xs text-faint">
            Mock mode — the demo account is pre-filled.
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
