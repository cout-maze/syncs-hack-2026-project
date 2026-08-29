import Phaser from "phaser";

export type PlacedBlock = { id: string; typeId: string; x: number; y: number };

export type BlockState = "normal" | "flooded" | "offline";

const TILE_W = 64;
const TILE_H = 32;
const GRID = 10;

const COLORS: Record<string, number> = {
  housing: 0xf3c7ab,
  healthcare: 0xf2d0d0,
  education: 0xf0e2a8,
  transport: 0xc9d5dc,
  park: 0xc9e0b8,
  community_hub: 0xddd0ee,
  technology_hub: 0xc2dce8,
  shared_resource_hub: 0xdcc8b0,
  culture_heritage: 0xf0d6b4,
};

function iso(x: number, y: number) {
  return {
    sx: (GRID - 1) * (TILE_W / 2) + (x - y) * (TILE_W / 2),
    sy: 24 + (x + y) * (TILE_H / 2),
  };
}

export class CityScene extends Phaser.Scene {
  private blocks: PlacedBlock[] = [];
  private states = new Map<string, BlockState>();
  private graphics!: Phaser.GameObjects.Graphics;
  private selected: { x: number; y: number } | null = null;
  private pathIds = new Set<string>();
  onCellClick: ((x: number, y: number) => void) | null = null;

  constructor() {
    super("city");
  }

  create() {
    this.cameras.main.setBackgroundColor(0xf3ece1);
    this.graphics = this.add.graphics();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const cell = this.pickCell(pointer.worldX, pointer.worldY);
      if (!cell) return;
      this.selected = cell;
      this.redraw();
      this.onCellClick?.(cell.x, cell.y);
    });
    this.redraw();
    this.game.events.emit("city-scene-ready", this);
  }

  setBlocks(blocks: PlacedBlock[]) {
    this.blocks = blocks;
    this.redraw();
  }

  highlightPath(blockIds: string[]) {
    this.pathIds = new Set(blockIds);
    this.redraw();
  }

  setBlockState(id: string, state: BlockState) {
    this.states.set(id, state);
    this.redraw();
  }

  clearEffects() {
    this.states.clear();
    this.pathIds.clear();
    this.redraw();
  }

  animateResident(pathBlockIds: string[]) {
    this.highlightPath(pathBlockIds);
    const points = pathBlockIds
      .map((id) => this.blocks.find((block) => block.id === id))
      .filter((block): block is PlacedBlock => Boolean(block))
      .map((block) => iso(block.x, block.y));
    if (points.length === 0) return;
    const marker = this.add.circle(points[0].sx + TILE_W / 2, points[0].sy + TILE_H / 2, 6, 0xd96c4e);
    this.tweens.add({
      targets: marker,
      duration: Math.max(400, points.length * 280),
      ease: "Sine.easeInOut",
      x: points[points.length - 1].sx + TILE_W / 2,
      y: points[points.length - 1].sy + TILE_H / 2,
      onComplete: () => marker.destroy(),
    });
  }

  pickCell(px: number, py: number) {
    const originLeft = (GRID - 1) * (TILE_W / 2);
    const a = (px - originLeft) / (TILE_W / 2);
    const b = (py - 24) / (TILE_H / 2);
    const x = Math.round((a + b) / 2);
    const y = Math.round((b - a) / 2);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
    return { x, y };
  }

  private redraw() {
    const g = this.graphics;
    g.clear();
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const block = this.blocks.find((item) => item.x === x && item.y === y);
        const pos = iso(x, y);
        const selected = this.selected?.x === x && this.selected?.y === y;
        const state = block ? this.states.get(block.id) ?? "normal" : "normal";
        const onPath = block ? this.pathIds.has(block.id) : false;
        const fill = block ? COLORS[block.typeId] ?? 0xe7ddd0 : 0xe7ddd0;
        const tint =
          state === "flooded" ? 0x7aa0b8 : state === "offline" ? 0x8899aa : fill;
        this.diamond(g, pos.sx, pos.sy, tint, selected || onPath);
      }
    }
  }

  private diamond(g: Phaser.GameObjects.Graphics, x: number, y: number, fill: number, highlight: boolean) {
    g.fillStyle(fill, 1);
    g.lineStyle(highlight ? 3 : 1, highlight ? 0x1e2a3a : 0xc9bba8, 1);
    g.beginPath();
    g.moveTo(x + TILE_W / 2, y);
    g.lineTo(x + TILE_W, y + TILE_H / 2);
    g.lineTo(x + TILE_W / 2, y + TILE_H);
    g.lineTo(x, y + TILE_H / 2);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }
}
