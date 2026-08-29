import { useEffect, useMemo, useRef, useState } from "react";
import { METRIC_LABELS, type MetricName } from "@rmc/shared";
import { api } from "../../api/client";
import { PhaserMap } from "./PhaserMap";
import { CityScene, type PlacedBlock } from "./CityScene";
import { flawedLayout } from "../simulation/engine";

type BlockType = {
  id: string;
  name: string;
  cost: number;
  description: string;
  icon: string;
};

type City = {
  id: string;
  name: string;
  gridWidth: number;
  gridHeight: number;
  blockBudget: number;
  blocksUsed: number;
  blocks: PlacedBlock[];
  lastSimulation?: { metrics: Record<MetricName, number> } | null;
};

type Props = {
  city: City;
  onCity: (city: City) => void;
  sceneRef: React.MutableRefObject<CityScene | null>;
};

export function BuilderView({ city, onCity, sceneRef }: Props) {
  const [catalog, setCatalog] = useState<BlockType[]>([]);
  const [selected, setSelected] = useState<string>("housing");
  const [tool, setTool] = useState<"place" | "remove">("place");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    api<BlockType[]>("/catalog/block-types").then(setCatalog).catch(() => undefined);
  }, []);

  const costMap = useMemo(
    () => Object.fromEntries(catalog.map((block) => [block.id, block.cost])),
    [catalog],
  );

  function used(blocks: PlacedBlock[]) {
    return blocks.reduce((sum, block) => sum + (costMap[block.typeId] ?? 1), 0);
  }

  function queueSave(next: City) {
    onCity(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const saved = await api<City>(`/cities/${next.id}/blocks`, {
          method: "PUT",
          body: JSON.stringify({
            blocks: next.blocks.map(({ typeId, x, y }) => ({ typeId, x, y })),
          }),
        });
        onCity(saved);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    }, 1000);
  }

  function place(x: number, y: number, typeId = selected, forcePlace = false) {
    if (tool === "remove" && !forcePlace) {
      queueSave({
        ...city,
        blocks: city.blocks.filter((block) => !(block.x === x && block.y === y)),
        blocksUsed: used(city.blocks.filter((block) => !(block.x === x && block.y === y))),
      });
      return;
    }
    const without = city.blocks.filter((block) => !(block.x === x && block.y === y));
    const nextBlocks = [
      ...without,
      { id: `tmp_${x}_${y}`, typeId, x, y },
    ];
    if (used(nextBlocks) > city.blockBudget) {
      setError("That placement would exceed the block budget.");
      return;
    }
    queueSave({ ...city, blocks: nextBlocks, blocksUsed: used(nextBlocks) });
  }

  async function loadFlawed() {
    const blocks = flawedLayout();
    queueSave({
      ...city,
      blocks: blocks.map((block, index) => ({ id: `tmp_${index}`, ...block })),
      blocksUsed: used(blocks.map((block, index) => ({ id: `tmp_${index}`, ...block }))),
    });
  }

  return (
    <div className="city-view">
      <p className="hint">
        {tool === "remove"
          ? "Click a block on the map to remove it."
          : `Drag ${selected.replaceAll("_", " ")} onto the grid, or click a cell.`}
      </p>
      {error ? <p className="error">{error}</p> : null}
      <PhaserMap
        blocks={city.blocks}
        onCellClick={(x, y) => place(x, y)}
        onDropType={(typeId, x, y) => {
          setSelected(typeId);
          setTool("place");
          place(x, y, typeId, true);
        }}
        onReady={(scene) => {
          sceneRef.current = scene;
          scene.setBlocks(city.blocks);
        }}
      />
      <section className="service-bar">
        <div>
          <p className="eyebrow">Block budget</p>
          <strong>
            {city.blocksUsed} / {city.blockBudget}
          </strong>
        </div>
        <div className="chips">
          {catalog.map((block) => (
            <button
              key={block.id}
              type="button"
              draggable
              className={selected === block.id && tool === "place" ? "chip active" : "chip"}
              onClick={() => {
                setSelected(block.id);
                setTool("place");
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", block.id);
                setSelected(block.id);
                setTool("place");
              }}
            >
              <strong>{block.name}</strong>
              <small>
                {block.cost === 1 ? "1 block" : `${block.cost} blocks`} · {block.description}
              </small>
            </button>
          ))}
          <button type="button" className={tool === "remove" ? "chip active dark" : "chip dark"} onClick={() => setTool("remove")}>
            <strong>Remove</strong>
            <small>Click a placed block</small>
          </button>
        </div>
        <button type="button" className="ghost" onClick={loadFlawed}>
          Load flawed city
        </button>
      </section>
      {city.lastSimulation?.metrics ? (
        <div className="metrics">
          {(Object.keys(METRIC_LABELS) as MetricName[]).map((key) => (
            <div key={key}>
              <span>{METRIC_LABELS[key]}</span>
              <strong>{city.lastSimulation?.metrics[key] ?? "—"}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
