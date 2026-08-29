import { useState } from 'react';
import type { BlockType } from '@rmc/shared';
import { BlockIcon } from '@/components/BlockIcon';
import { blockIconColor } from '@/lib/visuals';
import { cx, plural } from '@/lib/format';
import { BLOCK_DRAG_MIME } from './dragTypes';

/**
 * The service dock: the only permanent chrome on the map.
 *
 * There is no bar. The icons sit straight on the map, over a blur that fades out
 * upward - enough separation to keep them readable over a dense city, without another
 * floating panel competing with the two mode windows. Each service is a cartoon icon
 * with its name underneath; the block cost stays hidden until hover or focus.
 *
 * Drag onto the grid, or click to arm and then click a cell - both paths exist on
 * purpose, because drag is the nice one and click is the one that survives a trackpad
 * under demo pressure.
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
   * rather than living inside the row.
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
          style={{ left: hover.centreX, top: hover.top - 6 }}
          className="pointer-events-none fixed z-[210] w-56 -translate-x-1/2 -translate-y-full rounded-2xl bg-ink px-3.5 py-2.5 text-paper-0 shadow-xl shadow-black/25"
        >
          <p
            className="font-display text-sm font-bold"
            style={{ color: blockIconColor(hover.type.id) }}
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

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200]">
        {/* The dock's whole background: a blur and a warm wash, both masked so they
            dissolve upward into the map instead of ending on a hard edge. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-36 backdrop-blur-[10px] [mask-image:linear-gradient(to_top,#000_30%,transparent_100%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-paper-50/85 via-paper-50/40 to-transparent"
        />

        {/* `w-max` + `mx-auto` rather than `justify-center`: a centred flex row inside
            a scroll container puts its first items out of reach once it overflows. */}
        <div className="relative overflow-x-auto px-4 pt-7 pb-3">
          {/* The row takes the pointer, not each button: the gaps between icons then
              swipe-scroll on touch too. It is only as wide as the icons, so the map
              either side of it - and the lift room above - stays clickable. */}
          <div className="pointer-events-auto mx-auto flex w-max">
            {blockTypes.map((type) => {
              const affordable = type.cost <= remaining;
              const armed = armedTypeId === type.id;
              const color = blockIconColor(type.id);

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
                    'group relative flex w-[80px] shrink-0 flex-col items-center',
                    'gap-1 rounded-2xl px-1 pt-2 pb-1.5 transition-colors duration-150',
                    affordable
                      ? 'cursor-grab active:cursor-grabbing'
                      : 'cursor-not-allowed opacity-30 grayscale',
                    // Armed is the one state that still gets a surface: it has to be
                    // unmistakable at a glance while you go hunting for a cell.
                    armed && 'bg-ink',
                  )}
                >
                  {/* Coloured glow behind the icon - the hover state, and what makes an
                      icon with no plate behind it still feel touchable. */}
                  <span
                    aria-hidden="true"
                    className={cx(
                      'pointer-events-none absolute top-3 size-11 rounded-full blur-lg transition-opacity duration-200',
                      armed
                        ? 'opacity-60'
                        : 'opacity-0 group-hover:opacity-50 group-focus-visible:opacity-50',
                    )}
                    style={{ backgroundColor: color }}
                  />

                  <BlockIcon
                    typeId={type.id}
                    className={cx(
                      'relative size-11 drop-shadow-[0_2px_3px_rgba(0,0,0,0.18)]',
                      'transition-transform duration-200 ease-out',
                      'group-hover:-translate-y-1.5 group-hover:scale-110',
                      'group-focus-visible:-translate-y-1.5 group-focus-visible:scale-110',
                      'group-active:scale-95',
                      armed && '-translate-y-0.5',
                    )}
                  />

                  <span
                    className={cx(
                      'relative w-full text-center text-[11px] leading-tight font-bold transition-colors duration-150',
                      armed ? 'text-paper-0' : 'text-muted group-hover:text-ink',
                    )}
                  >
                    {type.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
