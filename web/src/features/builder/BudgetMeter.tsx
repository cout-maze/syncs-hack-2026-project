import { cx } from '@/lib/format';
import type { SaveState } from './useCityLayout';

const SAVE_LABELS: Record<SaveState, string> = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving...',
  saved: 'Saved',
  error: 'Save failed',
};

export function BudgetMeter({
  used,
  budget,
  saveState,
}: {
  used: number;
  budget: number;
  saveState: SaveState;
}) {
  const ratio = budget === 0 ? 0 : Math.min(1, used / budget);
  const tone = ratio > 0.95 ? 'bg-bad' : ratio > 0.8 ? 'bg-warn' : 'bg-apricot';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold tracking-wide text-muted uppercase">Block budget</span>
        <span className="font-display text-sm font-bold text-cream tabular-nums">
          {used}
          <span className="text-muted"> / {budget}</span>
        </span>
      </div>

      <div
        className="h-2.5 overflow-hidden rounded-pill bg-ink-800"
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-label="Blocks used"
      >
        <div
          className={cx('h-full rounded-pill transition-[width] duration-300', tone)}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      <p
        className={cx(
          'h-4 text-xs transition-colors',
          saveState === 'error' ? 'text-bad' : saveState === 'saved' ? 'text-good' : 'text-muted',
        )}
        aria-live="polite"
      >
        {SAVE_LABELS[saveState]}
      </p>
    </div>
  );
}
