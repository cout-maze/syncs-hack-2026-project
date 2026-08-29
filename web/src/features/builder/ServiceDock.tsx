import { useState } from 'react';
import type { BlockType } from '@rmc/shared';
import { blockColor, blockGlyph } from '@/lib/visuals';
import { cx, plural } from '@/lib/format';
import { BLOCK_DRAG_MIME } from './dragTypes';

/**
 * The service dock: the only permanent chrome on the map.
 *
 * Icon with its name underneath; the block cost stays hidden until you hover or focus
 * a service, so the resting state is just nine icons. Drag onto the grid, or click to
 * arm and then click a cell - both paths exist on purpose, because drag is the nice
 * one and click is the one that survives a trackpad under demo pressure.
 */

interface ServiceDockProps {
  blockTypes: BlockType[];
  /** Type armed by clicking. Kept apart from drag state so a stray dragend cannot clear it. */
  armedTypeId: string | null;
  onArm: (typeId: string | null) => void;
  onDragStateChange: (typeId: string | null) => void;
  /** Remaining budget, used to grey out anything unaffordable. */
  remaining: number;
}

interface HoverState {
  type: BlockType;
  affordable: boolean;
  /** Viewport coordinates of the tile, so the tooltip can be positioned fixed. */
  centreX: number;
  top: number;
}

export function ServiceDock({
  blockTypes,
  armedTypeId,
  onArm,
  onDragStateChange,
  remaining,
}: ServiceDockProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  /**
   * The dock scrolls horizontally on narrow screens, and an overflow container clips
   * on both axes - so the tooltip is positioned `fixed` against the tile's rect
   * rather than living inside the bar.
   */
  function show(element: HTMLElement, type: BlockType, affordable: boolean) {
    const rect = element.getBoundingClientRect();
    setHover({ type, affordable, centreX: rect.left + rect.width / 2, top: rect.top });
  }

  function hide(type: BlockType) {
    setHover((current) => (current?.type.id === type.id ? null : current));
  }

  return (
    <>
      {hover && (
        <div
          role="tooltip"
          style={{ left: hover.centreX, top: hover.top - 10 }}
          className="pointer-events-none fixed z-[210] w-56 -translate-x-1/2 -translate-y-full rounded-2xl bg-ink px-3.5 py-2.5 text-paper-0 shadow-xl shadow-black/25"
        >
          <p
            className="font-display text-sm font-bold"
            style={{ color: blockColor(hover.type.id) }}
          >
            {plural(hover.type.cost, 'block')}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-paper-0/70">{hover.type.description}</p>
          {!hover.affordable && (
            <p className="mt-1 text-xs font-bold text-bad">Not enough budget left.</p>
          )}
          <span
            aria-hidden="true"
            className="absolute top-full left-1/2 -ml-1.5 size-3 -translate-y-1.5 rotate-45 bg-ink"
          />
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex justify-center px-3 pb-3">
        <div
          className={cx(
            'pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-card p-2.5',
            'bg-paper-0/92 shadow-2xl shadow-black/12 ring-[1.5px] ring-black/15 backdrop-blur-md',
          )}
        >
          {blockTypes.map((type) => {
            const affordable = type.cost <= remaining;
            const armed = armedTypeId === type.id;
            const color = blockColor(type.id);

            return (
              <button
                key={type.id}
                type="button"
                draggable={affordable}
                aria-pressed={armed}
                disabled={!affordable}
                onMouseEnter={(event) => show(event.currentTarget, type, affordable)}
                onMouseLeave={() => hide(type)}
                onFocus={(event) => show(event.currentTarget, type, affordable)}
                onBlur={() => hide(type)}
                onClick={() => onArm(armed ? null : type.id)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(BLOCK_DRAG_MIME, type.id);
                  event.dataTransfer.effectAllowed = 'copy';
                  onDragStateChange(type.id);
                  setHover(null);
                }}
                onDragEnd={() => onDragStateChange(null)}
                className={cx(
                  'flex w-[78px] shrink-0 flex-col items-center gap-1.5 rounded-2xl px-1.5 pt-2.5 pb-2 transition-colors',
                  affordable
                    ? 'cursor-grab active:cursor-grabbing'
                    : 'cursor-not-allowed opacity-35',
                  armed ? 'bg-ink text-paper-0' : 'hover:bg-paper-100',
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 place-items-center rounded-xl text-xl"
                  style={{
                    backgroundColor: `${color}26`,
                    boxShadow: `inset 0 0 0 1.5px ${color}`,
                  }}
                >
                  {blockGlyph(type.id)}
                </span>

                <span
                  className={cx(
                    'w-full text-center text-[11px] leading-tight font-bold',
                    armed ? 'text-paper-0' : 'text-fog',
                  )}
                >
                  {type.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
