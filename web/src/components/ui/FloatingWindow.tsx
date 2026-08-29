import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cx } from '@/lib/format';

/**
 * A draggable panel that floats over the map.
 *
 * The map is the product, so nothing gets a permanent column any more - Simulation
 * and Proposal each open one of these, they can be open at the same time, and you
 * drag them out of the way by the title bar rather than closing them.
 */

/**
 * Windows stack within a bounded band. The map's persistent chrome - the menu, the
 * dock, the mode buttons - sits above the ceiling, so a window can never bury the
 * controls you need to open or close it.
 */
const Z_FLOOR = 40;
const Z_CEILING = 180;
let topZ = Z_FLOOR;

function nextZ(): number {
  topZ = Math.min(topZ + 1, Z_CEILING);
  return topZ;
}

interface FloatingWindowProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Opening position as a fraction of the viewport, so two windows do not stack exactly. */
  initial?: { x: number; y: number };
  width?: number;
  /** Left-edge accent colour, used to tell the windows apart at a glance. */
  accent?: string;
}

const MARGIN = 12;

export function FloatingWindow({
  title,
  subtitle,
  onClose,
  children,
  initial = { x: 0.5, y: 0.14 },
  width = 400,
  accent,
}: FloatingWindowProps) {
  const [position, setPosition] = useState(() => ({
    x: Math.round(Math.max(MARGIN, window.innerWidth * initial.x - width / 2)),
    y: Math.round(Math.max(MARGIN, window.innerHeight * initial.y)),
  }));
  const [z, setZ] = useState(nextZ);

  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);

  const bringToFront = useCallback(() => setZ(nextZ()), []);

  const clamp = useCallback((x: number, y: number) => {
    const w = windowRef.current?.offsetWidth ?? width;
    return {
      // Keep at least the title bar reachable, whatever the user does.
      x: Math.min(Math.max(MARGIN - w + 80, x), window.innerWidth - 80),
      y: Math.min(Math.max(MARGIN, y), window.innerHeight - 48),
    };
  }, [width]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Ignore drags that start on the close button.
    if ((event.target as HTMLElement).closest('button')) return;

    bringToFront();
    dragRef.current = { offsetX: event.clientX - position.x, offsetY: event.clientY - position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setPosition(clamp(event.clientX - drag.offsetX, event.clientY - drag.offsetY));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Escape closes the front-most window; a resize pulls a stranded one back on screen.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && z === topZ) onClose();
    }
    function onResize() {
      setPosition((current) => clamp(current.x, current.y));
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [z, onClose, clamp]);

  return (
    <div
      ref={windowRef}
      role="dialog"
      aria-label={title}
      onPointerDown={bringToFront}
      style={{ left: position.x, top: position.y, width, zIndex: z }}
      className={cx(
        'fixed flex max-h-[min(70vh,700px)] flex-col overflow-hidden rounded-card',
        'bg-paper-0/95 shadow-2xl shadow-black/15 ring-[1.5px] ring-black/15 backdrop-blur-md',
      )}
    >
      {/* A full-width cap rather than a left edge: at this corner radius a vertical
          stripe survives only as a clipped sliver, but the cap reads as intended. */}
      {accent && (
        <span
          aria-hidden="true"
          className="h-1.5 w-full shrink-0"
          style={{ backgroundColor: accent }}
        />
      )}

      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex shrink-0 cursor-grab items-start justify-between gap-3 bg-paper-100 px-5 py-3.5 active:cursor-grabbing"
      >
        <div className="min-w-0 select-none">
          <h2 className="truncate text-sm font-extrabold tracking-[0.08em] uppercase">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="-mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-ink hover:text-paper-0"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
            <path
              d="M3 3l10 10M13 3L3 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* The panels were written for a page column, so the window supplies the padding
          they used to get from the layout. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
    </div>
  );
}
