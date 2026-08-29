import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

/**
 * Solid black is the primary call to action - against a warm page and cool grey
 * cards it outranks anything else on screen without needing a bright fill, which
 * leaves the saturated colours to mean something on the map.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-paper-0 hover:bg-fog active:translate-y-px',
  // paper-200 rather than 100: cards are filled paper-100, and a secondary button
  // the same tone as the card it sits on disappears.
  secondary: 'bg-paper-200 text-ink hover:bg-paper-300 active:translate-y-px',
  ghost: 'text-muted hover:bg-paper-100 hover:text-ink',
  danger: 'bg-bad/12 text-bad hover:bg-bad/20',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-sm gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-base gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-pill font-bold whitespace-nowrap',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
