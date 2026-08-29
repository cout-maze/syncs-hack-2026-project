import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Phaser from 'phaser';
import type { PlacedBlock } from '@rmc/shared';
import { CityScene } from './scene/CityScene';
import { GAME_HEIGHT, GAME_WIDTH, type Cell } from './scene/isometric';
import { registerCityScene } from './scene/sceneApi';
import { BLOCK_DRAG_MIME } from './dragTypes';

/**
 * Mounts the Phaser scene and bridges HTML drag-and-drop into it.
 *
 * The drag path is the riskiest interaction in the build (docs/01 says to prototype
 * it first), so it is deliberately simple: HTML5 drag events land on the wrapper
 * div, we convert client coordinates into the game's fixed logical space, and the
 * scene turns that into a grid cell. Click-to-place is kept as an equal-footing
 * fallback for touch and for anyone who does not want to drag.
 *
 * It also owns the map's VIEW. The map fills the screen, so it has to behave like a
 * map: trackpad pinch and wheel zoom at the cursor, drag to pan, keyboard for anyone
 * not using a pointer, and buttons for anyone who does not know the gestures exist.
 * The wheel listener is registered natively rather than through React because it must
 * be non-passive - without preventDefault a Mac pinch zooms the whole page instead of
 * the city.
 */

/** One wheel notch or pinch step, before clamping. */
const ZOOM_PER_PIXEL = { pinch: 0.01, wheel: 0.0025 };
const MAX_STEP = 1.25;

interface CityCanvasProps {
  city: { gridWidth: number; gridHeight: number; blocks: PlacedBlock[] };
  selectedCell: Cell | null;
  /** Type id currently armed in the service bar, if any. */
  armedTypeId: string | null;
  onCellClick: (cell: Cell, block: PlacedBlock | null) => void;
  onCellHover?: (cell: Cell | null, block: PlacedBlock | null) => void;
  /** Return false to show the drop preview as invalid (occupied / over budget). */
  canPlace: (cell: Cell, typeId: string) => boolean;
  onDropBlock: (cell: Cell, typeId: string) => void;
  className?: string;
}

export function CityCanvas({
  city,
  selectedCell,
  armedTypeId,
  onCellClick,
  onCellHover,
  canPlace,
  onDropBlock,
  className = 'grid w-full place-items-center',
}: CityCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const [zoom, setZoom] = useState(1);

  // Callbacks change every render; keep the scene pointed at the latest without
  // tearing down the game.
  const handlersRef = useRef({ onCellClick, onCellHover, canPlace, onDropBlock });
  handlersRef.current = { onCellClick, onCellHover, canPlace, onDropBlock };

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;

    const scene = new CityScene();
    scene.setCallbacks({
      onCellClick: (cell, block) => handlersRef.current.onCellClick(cell, block),
      onCellHover: (cell, block) => handlersRef.current.onCellHover?.(cell, block),
      onViewChange: setZoom,
    });

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      transparent: true,
      banner: false,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [scene],
    });

    gameRef.current = game;
    sceneRef.current = scene;
    registerCityScene(scene);

    return () => {
      registerCityScene(null);
      sceneRef.current = null;
      gameRef.current = null;
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setCity(city);
  }, [city]);

  useEffect(() => {
    sceneRef.current?.setSelectedCell(selectedCell);
  }, [selectedCell]);

  /** Client coordinates to the game's fixed logical space, before the camera. */
  const gamePointFromEvent = useCallback((clientX: number, clientY: number) => {
    const canvas = gameRef.current?.canvas;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    return {
      x: (clientX - rect.left) * (GAME_WIDTH / rect.width),
      y: (clientY - rect.top) * (GAME_HEIGHT / rect.height),
    };
  }, []);

  /** Client coordinates to a grid cell, or null when the pointer is off the grid. */
  const cellFromEvent = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const scene = sceneRef.current;
      const point = gamePointFromEvent(clientX, clientY);
      // Through the camera: with the map zoomed or panned, screen and world differ.
      return scene && point ? scene.screenPointToCell(point.x, point.y) : null;
    },
    [gamePointFromEvent],
  );

  /**
   * Wheel and pinch, registered natively so it can be non-passive.
   *
   * A Mac trackpad pinch arrives as a wheel event with ctrlKey set and small deltas; a
   * mouse wheel arrives with large ones. Both zoom, at the cursor. Without
   * preventDefault the pinch would zoom the browser page instead, which is exactly the
   * "I can't zoom the map" symptom.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    function onWheel(event: WheelEvent) {
      const scene = sceneRef.current;
      if (!scene) return;
      event.preventDefault();

      // Firefox reports lines rather than pixels.
      const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const deltaX = event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX;

      // Shift is the conventional "scroll sideways" modifier - pan instead of zoom.
      if (event.shiftKey && !event.ctrlKey) {
        scene.panBy(deltaY || deltaX, 0);
        return;
      }

      const rate = event.ctrlKey ? ZOOM_PER_PIXEL.pinch : ZOOM_PER_PIXEL.wheel;
      const step = Math.min(MAX_STEP, Math.max(1 / MAX_STEP, Math.exp(-deltaY * rate)));
      scene.zoomBy(step, gamePointFromEvent(event.clientX, event.clientY) ?? undefined);
    }

    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [gamePointFromEvent]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    // getData() is blocked during dragover, so the service bar arms the type on
    // dragstart and we read it from there.
    if (!armedTypeId || !event.dataTransfer.types.includes(BLOCK_DRAG_MIME)) return;
    const typeId = armedTypeId;

    // Required, or the browser refuses the drop.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    const cell = cellFromEvent(event.clientX, event.clientY);
    sceneRef.current?.setGhost(
      cell ? { ...cell, typeId, valid: handlersRef.current.canPlace(cell, typeId) } : null,
    );
  };

  /** Keyboard equivalents, so the view is not gesture-only. */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const scene = sceneRef.current;
    if (!scene) return;

    const PAN_STEP = 60;
    switch (event.key) {
      case '+':
      case '=':
        scene.zoomBy(1.2);
        break;
      case '-':
      case '_':
        scene.zoomBy(1 / 1.2);
        break;
      case '0':
        scene.resetView();
        break;
      case 'ArrowLeft':
        scene.panBy(-PAN_STEP, 0);
        break;
      case 'ArrowRight':
        scene.panBy(PAN_STEP, 0);
        break;
      case 'ArrowUp':
        scene.panBy(0, -PAN_STEP);
        break;
      case 'ArrowDown':
        scene.panBy(0, PAN_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const handleDragLeave = () => sceneRef.current?.setGhost(null);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    sceneRef.current?.setGhost(null);

    const typeId = event.dataTransfer.getData(BLOCK_DRAG_MIME) || armedTypeId;
    if (!typeId) return;

    const cell = cellFromEvent(event.clientX, event.clientY);
    if (cell) handlersRef.current.onDropBlock(cell, typeId);
  };

  return (
    <>
      <div
        ref={hostRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDown={handleKeyDown}
        className={className}
        // TODO(FE#1): add arrow-key CELL navigation so the grid itself is reachable
        // without a pointer. The arrows currently pan the view; click-to-place works,
        // only cell focus is missing.
        tabIndex={0}
        aria-label="City map. Scroll or pinch to zoom, drag to pan, arrow keys to move."
        role="application"
      />

      <ViewControls
        zoom={zoom}
        onZoomIn={() => sceneRef.current?.zoomBy(1.25)}
        onZoomOut={() => sceneRef.current?.zoomBy(1 / 1.25)}
        onReset={() => sceneRef.current?.resetView()}
      />
    </>
  );
}

/**
 * Zoom buttons, under the menu in the top-left corner.
 *
 * Gestures are not discoverable and not available to everyone, so the same three
 * actions are always on screen: in, out, and back to the whole city.
 */
function ViewControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="fixed top-[60px] left-3 z-[200] flex flex-col items-center gap-1">
      <div className="flex flex-col overflow-hidden rounded-xl border border-line-bright bg-ink-900/85 shadow-lg shadow-black/40 backdrop-blur-md">
        <ViewButton label="Zoom in" onClick={onZoomIn} disabled={zoom >= 3}>
          <path d="M9 4.5v9M4.5 9h9" />
        </ViewButton>
        <span aria-hidden="true" className="h-px bg-line" />
        <ViewButton label="Zoom out" onClick={onZoomOut} disabled={zoom <= 0.5}>
          <path d="M4.5 9h9" />
        </ViewButton>
      </div>

      <button
        type="button"
        onClick={onReset}
        title="Fit the whole city"
        className="rounded-lg border border-line-bright bg-ink-900/85 px-1.5 py-0.5 font-display text-[10px] font-bold text-muted tabular-nums shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:text-cream"
      >
        {Math.round(zoom * 100)}%
      </button>
    </div>
  );
}

function ViewButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center text-fog transition-colors hover:bg-ink-800 hover:text-cream disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {children}
        </g>
      </svg>
    </button>
  );
}
