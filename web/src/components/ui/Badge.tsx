import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-800 text-fog border-line-bright',
  good: 'bg-good/15 text-good border-good/35',
  warn: 'bg-warn/15 text-warn border-warn/35',
  bad: 'bg-bad/15 text-bad border-bad/35',
  accent: 'bg-apricot/15 text-apricot border-apricot/35',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5',
        'text-[11px] font-semibold tracking-wide whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
