import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

/** Flat tinted pills, no outline - the fill carries the tone on its own. */
const TONES: Record<Tone, string> = {
  neutral: 'bg-paper-200 text-fog',
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/15 text-bad',
  accent: 'bg-honey/25 text-honey-deep',
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
        'inline-flex items-center gap-1 rounded-pill px-2.5 py-1',
        'text-[11px] font-bold tracking-wide whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
