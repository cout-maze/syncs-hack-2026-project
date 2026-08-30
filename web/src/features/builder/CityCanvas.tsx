import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Phaser from 'phaser';
import type { PlacedBlock } from '@rmc/shared';
import { CityScene, MAX_ZOOM, MIN_ZOOM } from './scene/CityScene';
import type { Cell } from './scene/isometric';
import { registerCityScene, type CitySceneApi } from './scene/sceneApi';
import { BLOCK_DRAG_MIME } from './dragTypes';

/**
 * Mounts the Phaser scene and bridges HTML drag-and-drop into it.
 *
 * The drag path is the riskiest interaction in the build (docs/01 says to prototype
 * it first), so it is deliberately simple: HTML5 drag events land on the wrapper
 * div, we convert client coordinates into the game's fixed logical space, and the
 * scene turns that into a grid cell. Click-to-place is kept as an equal-footing
 * fallback for touch and for anyone who does not want to drag.
 */

interface CityCanvasProps {
  city: { gridWidth: number; gridHeight: number; blocks: PlacedBlock[] };
  selectedCell: Cell | null;
  /** Move the keyboard cursor without placing or moving a block. */
  onCellFocus?: (cell: Cell) => void;
  /** Type id currently armed in the service bar, if any. */
  armedTypeId: string | null;
  onCellClick: (cell: Cell, block: PlacedBlock | null) => void;
  onCellHover?: (cell: Cell | null, block: PlacedBlock | null) => void;
  /** Return false to show the drop preview as invalid (occupied / over budget). */
  canPlace: (cell: Cell, typeId: string) => boolean;
  onDropBlock: (cell: Cell, typeId: string) => void;
  className?: string;
  /** Proposal mode uses the map as a read-only planning preview. */
  interactive?: boolean;
  /** What the pointer is over, shown in the corner cluster next to the zoom level. */
  hoverLabel?: ReactNode;
  /** Disable global scene registration for independent read-only previews. */
  registerScene?: boolean;
  onSceneReady?: (scene: CitySceneApi | null) => void;
}

export function CityCanvas({
  city,
  selectedCell,
  onCellFocus,
  armedTypeId,
  onCellClick,
  onCellHover,
  canPlace,
  onDropBlock,
  className = 'grid w-full place-items-center',
  interactive = true,
  hoverLabel,
  registerScene = true,
  onSceneReady,
}: CityCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const [zoom, setZoom] = useState(1);

  // Callbacks change every render; keep the scene pointed at the latest without
  // tearing down the game.
  const handlersRef = useRef({ onCellClick, onCellHover, canPlace, onDropBlock, interactive });
  handlersRef.current = { onCellClick, onCellHover, canPlace, onDropBlock, interactive };

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;

    // Phaser can leave its canvas node behind during React Strict Mode's
    // development remount. Start from a clean host so a remount never stacks
    // a second canvas over the map.
    hostRef.current.replaceChildren();
    const scene = new CityScene(registerScene);
    scene.setCallbacks({
      onCellClick: (cell, block) => {
        if (handlersRef.current.interactive) handlersRef.current.onCellClick(cell, block);
      },
      onCellHover: (cell, block) => handlersRef.current.onCellHover?.(cell, block),
      onZoomChange: setZoom,
    });

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      transparent: true,
      banner: false,
      // No sound anywhere in the product; this also stops Phaser churning an
      // AudioContext every time the canvas remounts in dev.
      audio: { noAudio: true },
      // The map IS the screen: the canvas tracks the viewport and the scene's camera
      // handles fitting, panning and zooming instead of letterboxing a fixed stage.
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      scene: [scene],
    });

    gameRef.current = game;
    sceneRef.current = scene;
    onSceneReady?.(scene);
    // The scene registers itself at the end of create(); we only clear it here.

    return () => {
      if (registerScene) registerCityScene(null);
      onSceneReady?.(null);
      sceneRef.current = null;
      gameRef.current = null;
      game.destroy(true);
      hostRef.current?.replaceChildren();
    };
  }, [onSceneReady, registerScene]);

  useEffect(() => {
    sceneRef.current?.setCity(city);
  }, [city]);

  useEffect(() => {
    sceneRef.current?.setSelectedCell(selectedCell);
  }, [selectedCell]);

  /** Client coordinates to a grid cell, or null when the pointer is off the grid. */
  const cellFromEvent = useCallback((clientX: number, clientY: number): Cell | null => {
    const canvas = gameRef.current?.canvas;
    const scene = sceneRef.current;
    if (!canvas || !scene) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    // The canvas now matches the viewport 1:1, so canvas pixels go straight to the
    // scene, which applies the camera transform.
    return scene.canvasPointToCell(clientX - rect.left, clientY - rect.top);
  }, []);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!interactive) return;
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

  const handleDragLeave = () => sceneRef.current?.setGhost(null);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.preventDefault();
    sceneRef.current?.setGhost(null);

    const typeId = event.dataTransfer.getData(BLOCK_DRAG_MIME) || armedTypeId;
    if (!typeId) return;

    const cell = cellFromEvent(event.clientX, event.clientY);
    if (cell) handlersRef.current.onDropBlock(cell, typeId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focused = selectedCell ?? {
      x: Math.floor(city.gridWidth / 2),
      y: Math.floor(city.gridHeight / 2),
    };
    const movement: Record<string, Cell> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    const delta = movement[event.key];

    if (delta) {
      event.preventDefault();
      const next = {
        x: Math.max(0, Math.min(city.gridWidth - 1, focused.x + delta.x)),
        y: Math.max(0, Math.min(city.gridHeight - 1, focused.y + delta.y)),
      };
      onCellFocus?.(next);
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onCellClick(focused, city.blocks.find((block) => block.x === focused.x && block.y === focused.y) ?? null);
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
        aria-label="City map"
        role="application"
        tabIndex={0}
      />
      {/* Corner readout: where the pointer is, then how far in you are. Both answer
          "where am I on the map", so they share one cluster instead of sitting at
          opposite corners. Fixed to the viewport, so only one is ever visible even
          though Proposal mode mounts its own canvas.

          Sits above the dock's blur scrim (z-200), not under it: the scrim spans the
          full width of the viewport, so at z-30 it was frosting these controls too. */}
      <div className="pointer-events-none fixed right-3 bottom-3 z-[205] flex items-center gap-2">
        {hoverLabel && (
          <p className="rounded-pill bg-ink/90 px-3.5 py-2 text-xs whitespace-nowrap text-paper-0 shadow-lg shadow-black/20 backdrop-blur-sm">
            {hoverLabel}
          </p>
        )}
        <ZoomControls
          zoom={zoom}
          onZoomIn={() => sceneRef.current?.zoomBy(1.25)}
          onZoomOut={() => sceneRef.current?.zoomBy(1 / 1.25)}
        />
      </div>
    </>
  );
}

/** Zoom in/out buttons plus the current level. */
function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-pill bg-paper-0/90 p-1.5 shadow-lg shadow-black/12 ring-[1.5px] ring-black/15 backdrop-blur-md">
      <ZoomButton label="Zoom out" onClick={onZoomOut} disabled={zoom <= MIN_ZOOM}>
        −
      </ZoomButton>
      <span className="w-10 text-center text-xs font-semibold tabular-nums text-fog">
        {Math.round(zoom * 100)}%
      </span>
      <ZoomButton label="Zoom in" onClick={onZoomIn} disabled={zoom >= MAX_ZOOM}>
        +
      </ZoomButton>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-full text-base font-bold text-fog transition-colors hover:bg-ink hover:text-paper-0 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
