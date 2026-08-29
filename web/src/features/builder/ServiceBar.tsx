import type { BlockType } from '@rmc/shared';
import { blockColor, blockGlyph } from '@/lib/visuals';
import { cx } from '@/lib/format';
import { BLOCK_DRAG_MIME } from './dragTypes';

/**
 * The service bar: drag a block onto the map, or click to arm it and then click a
 * cell. Both paths exist on purpose - drag is the nice one, click is the one that
 * works on a trackpad under demo pressure and on touch.
 */

interface ServiceBarProps {
  blockTypes: BlockType[];
  /** Type armed by clicking. Survives a drag so a stray dragend cannot clear it. */
  armedTypeId: string | null;
  onArm: (typeId: string | null) => void;
  onDragStateChange: (typeId: string | null) => void;
  /** Remaining budget, used to grey out anything unaffordable. */
  remaining: number;
}

export function ServiceBar({
  blockTypes,
  armedTypeId,
  onArm,
  onDragStateChange,
  remaining,
}: ServiceBarProps) {
  return (
    <ul className="grid grid-cols-2 gap-2 xl:grid-cols-1">
      {blockTypes.map((type) => {
        const affordable = type.cost <= remaining;
        const armed = armedTypeId === type.id;
        const color = blockColor(type.id);

        return (
          <li key={type.id}>
            <button
              type="button"
              draggable={affordable}
              aria-pressed={armed}
              disabled={!affordable}
              title={[type.description, ...type.tradeoffs].join('\n')}
              onClick={() => onArm(armed ? null : type.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData(BLOCK_DRAG_MIME, type.id);
                event.dataTransfer.effectAllowed = 'copy';
                onDragStateChange(type.id);
              }}
              onDragEnd={() => onDragStateChange(null)}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors',
                affordable ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-40',
                armed
                  ? 'border-apricot bg-apricot/10'
                  : 'border-line bg-ink-850 hover:border-line-bright hover:bg-ink-800',
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-md text-lg"
                style={{ backgroundColor: `${color}26`, boxShadow: `inset 0 0 0 1.5px ${color}` }}
              >
                {blockGlyph(type.id)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-cream">{type.name}</span>
                <span className="block text-xs text-muted">
                  {type.cost} {type.cost === 1 ? 'block' : 'blocks'}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
