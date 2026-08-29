import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { RegisterInputSchema } from '@rmc/shared';
import { useAuth } from './AuthProvider';
import { AuthLayout } from './AuthLayout';
import { fieldErrorsFrom } from './LoginPage';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { errorMessage } from '@/lib/api/errors';

export function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = RegisterInputSchema.safeParse({ displayName, email, password });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      await register(parsed.data);
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(errorMessage(error, 'Could not create your account.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Take the planner's chair"
      subtitle="One hundred blocks. Seven residents. No perfect layout."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-honey-deep hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label="Display name"
          autoComplete="nickname"
          value={displayName}
          error={fieldErrors.displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
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
          autoComplete="new-password"
          hint="At least 8 characters."
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
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
