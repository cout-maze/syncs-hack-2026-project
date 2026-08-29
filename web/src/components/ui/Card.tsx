import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/format';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cx(
        // A cool grey fill, not a border, is what separates a card from the white
        // panel it sits in - and a tighter radius than the window keeps the nesting
        // legible instead of two identical curves inside one another.
        'rounded-2xl bg-paper-100',
        className,
      )}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5',
        'border-b border-black/10 px-4 py-3',
        className,
      )}
    >
      {/* The title keeps a floor of ~9rem: without it a wide action squeezes the
          subtitle into a one-word-per-line column. Below that the action wraps. */}
      <div className="min-w-0 flex-1 basis-36">
        <h2 className="truncate text-sm font-extrabold tracking-[0.08em] uppercase">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
