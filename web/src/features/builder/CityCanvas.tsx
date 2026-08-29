import { useCallback, useEffect, useRef, type DragEvent } from 'react';
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
 */

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

  /** Client coordinates to a grid cell, or null when the pointer is off the grid. */
  const cellFromEvent = useCallback((clientX: number, clientY: number): Cell | null => {
    const canvas = gameRef.current?.canvas;
    const scene = sceneRef.current;
    if (!canvas || !scene) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    return scene.pointerToCell(
      (clientX - rect.left) * (GAME_WIDTH / rect.width),
      (clientY - rect.top) * (GAME_HEIGHT / rect.height),
    );
  }, []);

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
    <div
      ref={hostRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={className}
      // TODO(FE#1): add arrow-key cell navigation so the grid is reachable without a
      // pointer. Click-to-place already works; only cell focus is missing.
      aria-label="City map"
      role="application"
    />
  );
}
