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
let nextWindowId = 0;
const windowOrder: number[] = [];
const windowListeners = new Map<number, (z: number) => void>();

function zForWindow(id: number): number {
  const index = windowOrder.indexOf(id);
  return Math.min(Z_FLOOR + Math.max(index, 0) + 1, Z_CEILING);
}

function notifyWindowOrder(): void {
  for (const [id, listener] of windowListeners) listener(zForWindow(id));
}

function registerWindow(id: number, listener: (z: number) => void): () => void {
  windowOrder.push(id);
  windowListeners.set(id, listener);
  listener(zForWindow(id));
  return () => {
    const index = windowOrder.indexOf(id);
    if (index >= 0) windowOrder.splice(index, 1);
    windowListeners.delete(id);
    notifyWindowOrder();
  };
}

function bringWindowToFront(id: number): void {
  const index = windowOrder.indexOf(id);
  if (index >= 0) windowOrder.splice(index, 1);
  windowOrder.push(id);
  notifyWindowOrder();
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
  const idRef = useRef<number | undefined>(undefined);
  if (idRef.current === undefined) idRef.current = ++nextWindowId;
  const windowId = idRef.current;
  const [position, setPosition] = useState(() => ({
    x: Math.round(Math.max(MARGIN, window.innerWidth * initial.x - width / 2)),
    y: Math.round(Math.max(MARGIN, window.innerHeight * initial.y)),
  }));
  const [z, setZ] = useState(Z_FLOOR + 1);

  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);

  const bringToFront = useCallback(() => bringWindowToFront(windowId), [windowId]);

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
    const unregister = registerWindow(windowId, setZ);

    function onKeyDown(event: KeyboardEvent) {
      const topWindowId = windowOrder[windowOrder.length - 1];
      if (event.key === 'Escape' && windowId === topWindowId) onClose();
    }
    function onResize() {
      setPosition((current) => clamp(current.x, current.y));
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      unregister();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [windowId, onClose, clamp]);

  return (
    <div
      ref={windowRef}
      role="dialog"
      aria-label={title}
      onPointerDown={bringToFront}
      style={{ left: position.x, top: position.y, width, zIndex: z }}
      className={cx(
        'fixed flex max-h-[min(70vh,700px)] flex-col overflow-hidden rounded-card',
        'border border-line-bright bg-paper-0/95 shadow-2xl shadow-black/20 backdrop-blur-md',
      )}
    >
      {accent && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: accent }}
        />
      )}

      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex shrink-0 cursor-grab items-start justify-between gap-3 border-b border-line bg-paper-50/90 px-4 py-2.5 active:cursor-grabbing"
      >
        <div className="min-w-0 select-none">
          <h2 className="truncate text-sm font-bold tracking-wide uppercase">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="-mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-paper-100 hover:text-ink"
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </div>
  );
}
