import { cx } from '@/lib/format';
import { useCityWorkspace } from './CityWorkspace';
import { getCityScene } from './scene/sceneApi';

/**
 * Blocks used against the budget, plus a dot for the autosave state.
 *
 * Lives in the top-right cluster next to the mode buttons. The recentre control sits
 * with it because both answer "where am I?" - one in budget, one on the map.
 */
export function BudgetPill() {
  const { layout } = useCityWorkspace();
  const { blocksUsed: used, budget, saveState } = layout;

  const ratio = budget === 0 ? 0 : Math.min(1, used / budget);
  const failed = saveState === 'error';
  const saving = saveState === 'saving';
  const dirty = saveState === 'dirty';
  const tone = failed || ratio > 0.95 ? 'bg-bad' : ratio > 0.8 ? 'bg-warn' : 'bg-honey';

  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-line-bright bg-paper-0/90 py-2 pr-2 pl-3 shadow-lg shadow-black/15 backdrop-blur-md">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold tracking-wide text-muted uppercase">Blocks</span>
          <span
            className="font-display text-sm font-bold text-ink tabular-nums"
            role="meter"
            aria-valuenow={used}
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-label="Blocks used"
          >
            {used}
            <span className="text-muted"> / {budget}</span>
          </span>
          <span
            aria-hidden="true"
            title={failed ? 'Save failed' : saving ? 'Saving' : dirty ? 'Unsaved' : 'Saved'}
            className={cx(
              'size-1.5 rounded-full transition-colors',
              failed ? 'bg-bad' : saving ? 'animate-pulse bg-warn' : dirty ? 'bg-muted' : 'bg-good',
            )}
          />
        </div>
        <div className="mt-1.5 h-1 w-32 overflow-hidden rounded-pill bg-paper-200">
          <div
            className={cx('h-full rounded-pill transition-[width] duration-300', tone)}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => getCityScene()?.resetView()}
        title="Recentre the map"
        aria-label="Recentre the map"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-paper-100 hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="none">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
