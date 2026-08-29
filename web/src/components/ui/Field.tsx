import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '@/lib/format';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, className, id, ...rest }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-bold text-fog">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'h-12 rounded-pill bg-paper-100 px-4 text-ink placeholder:text-faint',
          'transition-shadow focus:outline-none focus:ring-2',
          error ? 'ring-2 ring-bad' : 'ring-0 focus:ring-ink',
          className,
        )}
      />
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
