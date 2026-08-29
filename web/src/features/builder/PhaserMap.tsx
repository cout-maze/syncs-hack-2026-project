import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { CityScene, type PlacedBlock } from "./CityScene";

type Props = {
  blocks: PlacedBlock[];
  onCellClick: (x: number, y: number) => void;
  onReady: (scene: CityScene) => void;
  onDropType?: (typeId: string, x: number, y: number) => void;
};

export function PhaserMap({ blocks, onCellClick, onReady, onDropType }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const clickRef = useRef(onCellClick);
  const readyRef = useRef(onReady);
  clickRef.current = onCellClick;
  readyRef.current = onReady;

  useEffect(() => {
    if (!parentRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: parentRef.current,
      width: 720,
      height: 420,
      backgroundColor: "#f3ece1",
      scene: [CityScene],
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    });
    const onSceneReady = (scene: CityScene) => {
      sceneRef.current = scene;
      scene.onCellClick = (x, y) => clickRef.current(x, y);
      readyRef.current(scene);
    };
    game.events.on("city-scene-ready", onSceneReady);
    return () => {
      game.events.off("city-scene-ready", onSceneReady);
      game.destroy(true);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setBlocks(blocks);
  }, [blocks]);

  return (
    <div
      className="phaser-host"
      ref={parentRef}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const typeId = event.dataTransfer.getData("text/plain");
        const scene = sceneRef.current;
        if (!typeId || !scene || !parentRef.current) return;
        const bounds = parentRef.current.getBoundingClientRect();
        const pointer = scene.input.activePointer;
        pointer.x = event.clientX - bounds.left;
        pointer.y = event.clientY - bounds.top;
        const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const cell = scene.pickCell(world.x, world.y);
        if (cell) onDropType?.(typeId, cell.x, cell.y);
      }}
    />
  );
}
