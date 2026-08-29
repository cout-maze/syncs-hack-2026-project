import { cx } from '@/lib/format';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cx(
          'size-4 animate-spin rounded-full border-2 border-muted border-t-honey-deep',
          className,
        )}
      />
      {label ? <span className="text-sm text-muted">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function CenteredSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-40 w-full items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}
