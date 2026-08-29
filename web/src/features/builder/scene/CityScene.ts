import Phaser from 'phaser';
import type { BlockChange, PlacedBlock } from '@rmc/shared';
import { blockColor, blockGlyph, personaGlyph, toPhaserColor } from '@/lib/visuals';
import {
  BLOCK_HEIGHT,
  TILE_HEIGHT,
  TILE_WIDTH,
  cellToScreen,
  depthOf,
  isWithinGrid,
  screenToCell,
  shade,
  tint,
  type Cell,
} from './isometric';
import type { AnimateResidentOptions, BlockVisualState, CitySceneApi } from './sceneApi';

/**
 * The 2.5D city map.
 *
 * Owned by FE #1. Everything other features need goes through CitySceneApi -
 * see scene/sceneApi.ts for the contract and why it exists.
 */

const OUTLINE = 0x0a1020;
const TURF_LIGHT = 0xcfe3c8;
const TURF_DARK = 0xc2d9ba;
const TURF_LINE = 0xa4c39a;
const APRICOT = 0xffb347;
const FLOOD = 0x3f7fd0;

const DEPTH = { ground: 0, overlay: 1, blocks: 10, trail: 3500, residents: 4000, ghost: 5000 };

/** Phaser's Graphics point APIs are typed for Vector2, not plain {x, y}. */
const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

export interface CitySceneCallbacks {
  onCellClick?: (cell: Cell, block: PlacedBlock | null) => void;
  onCellHover?: (cell: Cell | null, block: PlacedBlock | null) => void;
}

export class CityScene extends Phaser.Scene implements CitySceneApi {
  static readonly KEY = 'city';

  private gridWidth = 10;
  private gridHeight = 10;
  private blocks: PlacedBlock[] = [];

  private readonly states = new Map<string, BlockVisualState>();
  private readonly highlighted = new Set<string>();
  private readonly nodes = new Map<string, Phaser.GameObjects.Container>();

  private groundGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private previewGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics;

  private residents: Phaser.GameObjects.Container[] = [];
  private hoverCell: Cell | null = null;
  private selectedCell: Cell | null = null;
  private ghost: { x: number; y: number; typeId: string; valid: boolean } | null = null;
  /** Proposal-mode change preview. Draws over the city without altering it. */
  private preview: BlockChange[] = [];

  private callbacks: CitySceneCallbacks = {};
  /** create() has run and the graphics objects exist. */
  private ready = false;

  constructor() {
    super(CityScene.KEY);
  }

  setCallbacks(callbacks: CitySceneCallbacks): void {
    this.callbacks = callbacks;
  }

  create(): void {
    this.groundGfx = this.add.graphics().setDepth(DEPTH.ground);
    this.overlayGfx = this.add.graphics().setDepth(DEPTH.overlay);
    this.trailGfx = this.add.graphics().setDepth(DEPTH.trail);
    this.ghostGfx = this.add.graphics().setDepth(DEPTH.ghost);
    this.previewGfx = this.add.graphics().setDepth(DEPTH.ghost - 1);

    this.drawGround();
    this.renderBlocks();

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      const cell = this.pointerToCell(pointer.worldX, pointer.worldY);
      if (cell?.x === this.hoverCell?.x && cell?.y === this.hoverCell?.y) return;
      this.hoverCell = cell;
      this.drawOverlay();
      this.callbacks.onCellHover?.(cell, cell ? this.blockAt(cell) : null);
    });

    this.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.hoverCell = null;
      this.drawOverlay();
      this.callbacks.onCellHover?.(null, null);
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const cell = this.pointerToCell(pointer.worldX, pointer.worldY);
      if (!cell) return;
      this.callbacks.onCellClick?.(cell, this.blockAt(cell));
    });

    this.ready = true;
  }

  /* ------------------------------------------------------------- FE #1 API */

  setCity(city: { gridWidth: number; gridHeight: number; blocks: PlacedBlock[] }): void {
    const gridChanged = city.gridWidth !== this.gridWidth || city.gridHeight !== this.gridHeight;
    this.gridWidth = city.gridWidth;
    this.gridHeight = city.gridHeight;
    this.blocks = city.blocks;

    if (!this.ready) return; // create() replays the stored layout when it runs
    if (gridChanged) this.drawGround();
    this.renderBlocks();
  }

  setGhost(ghost: { x: number; y: number; typeId: string; valid: boolean } | null): void {
    this.ghost = ghost;
    if (this.ready) this.drawGhost();
  }

  setSelectedCell(cell: Cell | null): void {
    this.selectedCell = cell;
    if (this.ready) this.drawOverlay();
  }

  /* --------------------------------------------------------- FE #2 API */

  highlightPath(blockIds: string[]): void {
    this.highlighted.clear();
    for (const id of blockIds) this.highlighted.add(id);
    if (this.ready) this.renderBlocks();
  }

  setBlockState(blockId: string, state: BlockVisualState): void {
    if (state === 'normal') this.states.delete(blockId);
    else this.states.set(blockId, state);
    if (this.ready) this.redrawBlock(blockId);
  }

  clearStates(): void {
    this.states.clear();
    this.highlighted.clear();
    if (!this.ready) return;
    this.trailGfx.clear();
    this.renderBlocks();
  }

  async animateResident(options: AnimateResidentOptions): Promise<void> {
    if (!this.ready) return;
    const points = options.pathBlockIds
      .map((id) => this.blocks.find((block) => block.id === id))
      .filter((block): block is PlacedBlock => Boolean(block))
      .map((block) => {
        const screen = cellToScreen(block.x, block.y);
        return { x: screen.x, y: screen.y - BLOCK_HEIGHT - 10 };
      });

    if (points.length === 0) return;

    const walker = this.createResident(options.personaId, points[0] as Phaser.Types.Math.Vector2Like);
    this.residents.push(walker);

    if (points.length === 1) {
      await this.wait(500);
      this.removeResident(walker);
      return;
    }

    if (options.trail !== false) this.drawTrail(points);

    const duration = options.durationMs ?? (points.length - 1) * 240;
    const legs = points.length - 1;

    await new Promise<void>((resolve) => {
      const cursor = { t: 0 };
      this.tweens.add({
        targets: cursor,
        t: 1,
        duration,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          const scaled = cursor.t * legs;
          const index = Math.min(Math.floor(scaled), legs - 1);
          const local = scaled - index;
          const from = points[index] as { x: number; y: number };
          const to = points[index + 1] as { x: number; y: number };
          walker.setPosition(
            from.x + (to.x - from.x) * local,
            // A small arc per hop reads as a step rather than a slide.
            from.y + (to.y - from.y) * local - Math.sin(local * Math.PI) * 6,
          );
        },
        onComplete: () => resolve(),
      });
    });

    await this.wait(250);
    this.removeResident(walker);
  }

  clearResidents(): void {
    for (const walker of this.residents) walker.destroy();
    this.residents = [];
    this.trailGfx.clear();
  }

  /* --------------------------------------------------------- FE #3 API */

  previewChanges(changes: BlockChange[]): void {
    this.preview = changes;
    // Removals and moves dim the block that would go; additions are drawn as ghosts.
    for (const change of changes) {
      if (change.op === 'place' || !change.blockId) continue;
      this.setBlockState(change.blockId, 'dimmed');
    }
    if (this.ready) this.drawPreview();
  }

  clearPreview(): void {
    for (const change of this.preview) {
      if (change.blockId) this.setBlockState(change.blockId, 'normal');
    }
    this.preview = [];
    if (this.ready) this.previewGfx.clear();
  }

  pulseCell(cell: Cell, options: { color?: string; repeats?: number } = {}): void {
    if (!this.ready) return;
    const color = options.color ? toPhaserColor(options.color) : APRICOT;
    const centre = cellToScreen(cell.x, cell.y);

    const ring = this.add.graphics().setDepth(DEPTH.ghost);
    ring.lineStyle(3, color, 1);
    this.strokeDiamond(ring, 0, 0, 0);
    ring.setPosition(centre.x, centre.y);

    this.tweens.add({
      targets: ring,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 900,
      repeat: options.repeats ?? 2,
      onComplete: () => ring.destroy(),
    });
  }

  /* ------------------------------------------------------------- drawing */

  private drawGround(): void {
    this.groundGfx.clear();

    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const centre = cellToScreen(x, y);
        // Faint checker so the grid reads as blocks, not graph paper.
        this.groundGfx.fillStyle((x + y) % 2 === 0 ? TURF_LIGHT : TURF_DARK, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, 0);
        this.groundGfx.lineStyle(1, TURF_LINE, 0.9);
        this.strokeDiamond(this.groundGfx, centre.x, centre.y, 0);
      }
    }

    // Outer silhouette.
    this.groundGfx.lineStyle(3, OUTLINE, 0.85);
    const corners = [
      cellToScreen(0, 0),
      cellToScreen(this.gridWidth - 1, 0),
      cellToScreen(this.gridWidth - 1, this.gridHeight - 1),
      cellToScreen(0, this.gridHeight - 1),
    ];
    this.groundGfx.strokePoints(
      [
        v(corners[0]!.x, corners[0]!.y - TILE_HEIGHT / 2),
        v(corners[1]!.x + TILE_WIDTH / 2, corners[1]!.y),
        v(corners[2]!.x, corners[2]!.y + TILE_HEIGHT / 2),
        v(corners[3]!.x - TILE_WIDTH / 2, corners[3]!.y),
      ],
      true,
    );
  }

  private renderBlocks(): void {
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();

    for (const block of [...this.blocks].sort((a, b) => depthOf(a.x, a.y) - depthOf(b.x, b.y))) {
      this.nodes.set(block.id, this.createBlockNode(block));
    }
  }

  private redrawBlock(blockId: string): void {
    const block = this.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    this.nodes.get(blockId)?.destroy();
    this.nodes.set(blockId, this.createBlockNode(block));
  }

  private effectiveState(blockId: string): BlockVisualState {
    if (this.highlighted.has(blockId)) return 'highlighted';
    return this.states.get(blockId) ?? 'normal';
  }

  private createBlockNode(block: PlacedBlock): Phaser.GameObjects.Container {
    const centre = cellToScreen(block.x, block.y);
    const state = this.effectiveState(block.id);
    const base = toPhaserColor(blockColor(block.typeId));

    let top = base;
    let alpha = 1;
    let glow: number | null = null;

    switch (state) {
      case 'highlighted':
        top = tint(base, 0.3);
        glow = APRICOT;
        break;
      case 'flooded':
        top = FLOOD;
        alpha = 0.85;
        glow = FLOOD;
        break;
      case 'offline':
        top = shade(base, 0.42);
        alpha = 0.8;
        break;
      case 'dimmed':
        alpha = 0.32;
        break;
      case 'invalid':
        top = 0xf2616b;
        glow = 0xf2616b;
        break;
      default:
        break;
    }

    const gfx = this.add.graphics();
    this.paintBlock(gfx, top, alpha);
    if (glow !== null) {
      gfx.lineStyle(3, glow, 0.95);
      this.strokeDiamond(gfx, 0, -BLOCK_HEIGHT, 0);
    }

    const glyph = this.add
      .text(0, -BLOCK_HEIGHT - 1, blockGlyph(block.typeId), { fontSize: '19px' })
      .setOrigin(0.5)
      .setAlpha(state === 'dimmed' ? 0.4 : 1);

    const node = this.add
      .container(centre.x, centre.y, [gfx, glyph])
      .setDepth(DEPTH.blocks + depthOf(block.x, block.y));

    if (state === 'flooded') {
      this.tweens.add({
        targets: node,
        y: centre.y + 2,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    return node;
  }

  /** Draws the three visible faces of an extruded block, in local container space. */
  private paintBlock(gfx: Phaser.GameObjects.Graphics, color: number, alpha: number): void {
    const halfW = TILE_WIDTH / 2;
    const halfH = TILE_HEIGHT / 2;

    // Left-front face
    gfx.fillStyle(shade(color, 0.66), alpha);
    gfx.fillPoints(
      [v(-halfW, 0), v(0, halfH), v(0, halfH - BLOCK_HEIGHT), v(-halfW, -BLOCK_HEIGHT)],
      true,
    );

    // Right-front face
    gfx.fillStyle(shade(color, 0.48), alpha);
    gfx.fillPoints(
      [v(0, halfH), v(halfW, 0), v(halfW, -BLOCK_HEIGHT), v(0, halfH - BLOCK_HEIGHT)],
      true,
    );

    // Top face
    gfx.fillStyle(color, alpha);
    this.fillDiamond(gfx, 0, -BLOCK_HEIGHT, 0);

    // Cartoon silhouette
    gfx.lineStyle(2, OUTLINE, 0.9 * alpha);
    this.strokeDiamond(gfx, 0, -BLOCK_HEIGHT, 0);
    gfx.lineBetween(-halfW, 0, -halfW, -BLOCK_HEIGHT);
    gfx.lineBetween(halfW, 0, halfW, -BLOCK_HEIGHT);
    gfx.lineBetween(0, halfH, 0, halfH - BLOCK_HEIGHT);
    gfx.strokePoints([v(-halfW, 0), v(0, halfH), v(halfW, 0)], false);
  }

  private drawOverlay(): void {
    this.overlayGfx.clear();

    if (this.hoverCell && !this.ghost) {
      const centre = cellToScreen(this.hoverCell.x, this.hoverCell.y);
      this.overlayGfx.fillStyle(0xffffff, 0.18);
      this.fillDiamond(this.overlayGfx, centre.x, centre.y, 0);
    }

    if (this.selectedCell) {
      const centre = cellToScreen(this.selectedCell.x, this.selectedCell.y);
      this.overlayGfx.lineStyle(3, APRICOT, 1);
      this.strokeDiamond(this.overlayGfx, centre.x, centre.y, 2);
    }
  }

  private drawGhost(): void {
    this.ghostGfx.clear();
    if (!this.ghost) {
      this.drawOverlay();
      return;
    }

    const centre = cellToScreen(this.ghost.x, this.ghost.y);
    const color = this.ghost.valid ? toPhaserColor(blockColor(this.ghost.typeId)) : 0xf2616b;

    this.ghostGfx.setPosition(centre.x, centre.y);
    this.paintBlock(this.ghostGfx, color, 0.55);
    this.ghostGfx.lineStyle(3, this.ghost.valid ? APRICOT : 0xf2616b, 1);
    this.strokeDiamond(this.ghostGfx, 0, -BLOCK_HEIGHT, 0);
  }

  /**
   * Draw the proposal preview: a translucent block wherever the change would place or
   * move something. Reuses the ghost painting so a previewed block reads the same as one
   * being dragged in.
   */
  private drawPreview(): void {
    this.previewGfx.clear();
    if (this.preview.length === 0) return;

    // paintBlock draws around the origin, so translate the canvas per cell rather than
    // moving the Graphics object - one object has to cover every previewed change.
    for (const change of this.preview) {
      if (change.op === 'remove') continue;

      const typeId =
        change.typeId ??
        this.blocks.find((block) => block.id === change.blockId)?.typeId ??
        'housing';
      const centre = cellToScreen(change.x, change.y);

      this.previewGfx.save();
      this.previewGfx.translateCanvas(centre.x, centre.y);
      this.paintBlock(this.previewGfx, toPhaserColor(blockColor(typeId)), 0.45);
      this.previewGfx.lineStyle(2, APRICOT, 0.8);
      this.strokeDiamond(this.previewGfx, 0, -BLOCK_HEIGHT, 0);
      this.previewGfx.restore();
    }
  }

  private drawTrail(points: Array<{ x: number; y: number }>): void {
    this.trailGfx.clear();
    this.trailGfx.lineStyle(4, APRICOT, 0.55);
    this.trailGfx.strokePoints(
      points.map((point) => v(point.x, point.y)),
      false,
    );
  }

  private createResident(
    personaId: string,
    at: Phaser.Types.Math.Vector2Like,
  ): Phaser.GameObjects.Container {
    const bubble = this.add.graphics();
    bubble.fillStyle(0x0d1423, 0.92);
    bubble.fillCircle(0, 0, 13);
    bubble.lineStyle(2, APRICOT, 1);
    bubble.strokeCircle(0, 0, 13);

    const glyph = this.add.text(0, 0, personaGlyph(personaId), { fontSize: '14px' }).setOrigin(0.5);

    return this.add
      .container(at.x ?? 0, at.y ?? 0, [bubble, glyph])
      .setDepth(DEPTH.residents);
  }

  private removeResident(walker: Phaser.GameObjects.Container): void {
    this.residents = this.residents.filter((candidate) => candidate !== walker);
    walker.destroy();
  }

  /* -------------------------------------------------------------- helpers */

  private blockAt(cell: Cell): PlacedBlock | null {
    return this.blocks.find((block) => block.x === cell.x && block.y === cell.y) ?? null;
  }

  /** Game-space point to a grid cell, or null when it lands off the grid. */
  pointerToCell(screenX: number, screenY: number): Cell | null {
    const cell = screenToCell(screenX, screenY);
    return isWithinGrid(cell, this.gridWidth, this.gridHeight) ? cell : null;
  }

  private fillDiamond(gfx: Phaser.GameObjects.Graphics, cx: number, cy: number, inset: number) {
    const halfW = TILE_WIDTH / 2 - inset;
    const halfH = TILE_HEIGHT / 2 - inset / 2;
    gfx.fillPoints(
      [v(cx, cy - halfH), v(cx + halfW, cy), v(cx, cy + halfH), v(cx - halfW, cy)],
      true,
    );
  }

  private strokeDiamond(gfx: Phaser.GameObjects.Graphics, cx: number, cy: number, inset: number) {
    const halfW = TILE_WIDTH / 2 - inset;
    const halfH = TILE_HEIGHT / 2 - inset / 2;
    gfx.strokePoints(
      [v(cx, cy - halfH), v(cx + halfW, cy), v(cx, cy + halfH), v(cx - halfW, cy)],
      true,
    );
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.time.delayedCall(ms, resolve);
    });
  }
}
