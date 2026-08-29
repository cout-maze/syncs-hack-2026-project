import { useCallback, useEffect, useRef, type DragEvent } from 'react';
import Phaser from 'phaser';
import type { PlacedBlock } from '@rmc/shared';
import { CityScene } from './scene/CityScene';
import type { Cell } from './scene/isometric';
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
  /** Proposal mode uses the map as a read-only planning preview. */
  interactive?: boolean;
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
  interactive = true,
}: CityCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<CityScene | null>(null);

  // Callbacks change every render; keep the scene pointed at the latest without
  // tearing down the game.
  const handlersRef = useRef({ onCellClick, onCellHover, canPlace, onDropBlock, interactive });
  handlersRef.current = { onCellClick, onCellHover, canPlace, onDropBlock, interactive };

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;

    const scene = new CityScene();
    scene.setCallbacks({
      onCellClick: (cell, block) => {
        if (handlersRef.current.interactive) handlersRef.current.onCellClick(cell, block);
      },
      onCellHover: (cell, block) => handlersRef.current.onCellHover?.(cell, block),
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
    // The scene registers itself at the end of create(); we only clear it here.

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
