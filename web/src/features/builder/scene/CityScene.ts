import Phaser from 'phaser';
import type { BlockChange, PlacedBlock } from '@rmc/shared';
import { blockColor, blockGlyph, personaGlyph, toPhaserColor, zoneColor } from '@/lib/visuals';
import {
  BUILDING_INSET,
  FLOOR_HEIGHT,
  PLOT_INSET,
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
import {
  buildingProfile,
  drawBush,
  drawCar,
  drawPerson,
  drawTree,
  hash2,
} from './props';
import {
  registerCityScene,
  type AnimateResidentOptions,
  type BlockVisualState,
  type CitySceneApi,
} from './sceneApi';

/**
 * The 2.5D city map.
 *
 * A tile is one plot: the outer margin of every tile is street, so placed blocks
 * read as buildings lining a road grid rather than tiles on a chessboard. Empty
 * plots grow deterministic scenery (see props.ts) so the city looks inhabited
 * before the resident simulation runs.
 *
 * Owned by FE #1. Everything other features need goes through CitySceneApi -
 * see scene/sceneApi.ts for the contract and why it exists.
 */

/** Map surface palette - mirrors the map tokens in src/styles/index.css. */
const OUTLINE = 0x2a2213;
const ASPHALT = 0xece2ce;
const PLOT_LIGHT = 0xeef1e2;
const PLOT_DARK = 0xe1e8cf;
const KERB = 0xfbf8ef;
const GRASS = 0x9ed49a;
const WINDOW = 0xfdfbf5;
const WINDOW_LIT = 0xffcf6b;
const HONEY = 0xe8a532;
const FLOOD = 0x2f6fc4;
const BAD = 0xd1373f;

/** Pointer slop before a press counts as a pan rather than a click. */
const DRAG_THRESHOLD = 6;
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 2.6;
/** Extra room the camera may travel past the drawn world before it stops. */
const PAN_PADDING = 200;
/** Screen-space room kept clear for the floating chrome. */
const MARGIN = { x: 48, top: 72, bottom: 140 };
/** Tallest thing that can stick up out of a tile, so the fit leaves headroom. */
const MAX_BUILDING_HEIGHT = 96;

const DEPTH = {
  ground: 0,
  overlay: 1,
  zone: 2,
  blocks: 10,
  trail: 3500,
  residents: 4000,
  /** Selection and hover rings sit above the massing, or a tall building hides them. */
  marker: 4500,
  ghost: 5000,
};

/** Phaser's Graphics point APIs are typed for Vector2, not plain {x, y}. */
const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

interface BuildingStyle {
  color: number;
  floors: number;
  windowCols: number;
  roof: 'light' | 'dark';
  alpha: number;
  /** Draw windows unlit and skip detail - used for the drag ghost. */
  flat?: boolean;
}

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
  private readonly decor = new Map<string, Phaser.GameObjects.Container>();

  private groundGfx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private previewGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics;

  private residents: Phaser.GameObjects.Container[] = [];
  private hoverCell: Cell | null = null;
  private selectedCell: Cell | null = null;
  private ghost: { x: number; y: number; typeId: string; valid: boolean } | null = null;
  /** Proposal-mode change preview. Draws over the city without altering it. */
  private preview: BlockChange[] = [];
  /** Per-house service accessibility scores from the latest simulation run. */
  private zoneScores: Record<string, number> = {};

  /** In-flight drag-to-pan gesture, or null when the pointer is up / still. */
  private pan: {
    pointerX: number;
    pointerY: number;
    scrollX: number;
    scrollY: number;
    moved: boolean;
  } | null = null;

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
    this.zoneGfx = this.add.graphics().setDepth(DEPTH.zone);
    this.overlayGfx = this.add.graphics().setDepth(DEPTH.overlay);
    this.markerGfx = this.add.graphics().setDepth(DEPTH.marker);
    this.trailGfx = this.add.graphics().setDepth(DEPTH.trail);
    this.ghostGfx = this.add.graphics().setDepth(DEPTH.ghost);
    this.previewGfx = this.add.graphics().setDepth(DEPTH.ghost - 1);

    this.drawGround();
    this.renderCity();
    this.fitCameraToCity();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const camera = this.cameras.main;
      this.pan = {
        pointerX: pointer.x,
        pointerY: pointer.y,
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        moved: false,
      };
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (this.pan && pointer.isDown) {
        const dx = pointer.x - this.pan.pointerX;
        const dy = pointer.y - this.pan.pointerY;

        // A press only becomes a pan once it clears the slop threshold, so a slightly
        // shaky click still places a block.
        if (!this.pan.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.pan.moved = true;

        if (this.pan.moved) {
          const camera = this.cameras.main;
          camera.setScroll(
            this.pan.scrollX - dx / camera.zoom,
            this.pan.scrollY - dy / camera.zoom,
          );
          this.game.canvas.style.cursor = 'grabbing';
          return;
        }
      }

      const cell = this.pointerToCell(pointer.worldX, pointer.worldY);
      if (cell?.x === this.hoverCell?.x && cell?.y === this.hoverCell?.y) return;
      this.hoverCell = cell;
      this.drawOverlay();
      this.callbacks.onCellHover?.(cell, cell ? this.blockAt(cell) : null);
    });

    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const wasPan = this.pan?.moved ?? false;
      this.pan = null;
      this.game.canvas.style.cursor = '';
      if (wasPan) return;

      const cell = this.pointerToCell(pointer.worldX, pointer.worldY);
      if (!cell) return;
      this.callbacks.onCellClick?.(cell, this.blockAt(cell));
    });

    this.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.pan = null;
      this.hoverCell = null;
      this.drawOverlay();
      this.callbacks.onCellHover?.(null, null);
    });

    // Wheel zooms about the cursor, which is what makes panning worth having.
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        const camera = this.cameras.main;
        const next = Phaser.Math.Clamp(camera.zoom * (dy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM);
        if (next === camera.zoom) return;

        // Keep the world point under the cursor pinned while the zoom changes.
        const before = camera.getWorldPoint(pointer.x, pointer.y);
        camera.setZoom(next);
        const after = camera.getWorldPoint(pointer.x, pointer.y);
        camera.setScroll(
          camera.scrollX + (before.x - after.x),
          camera.scrollY + (before.y - after.y),
        );
      },
    );

    this.ready = true;

    // Registering here (rather than at construction) means anyone who gets a scene
    // back from the registry gets one that has actually drawn itself. The intro
    // curtain uses exactly that as its "map is ready" signal.
    registerCityScene(this);
  }

  /** World-space box the editable grid occupies, with room to breathe around it. */
  private cityBounds() {
    const left = cellToScreen(0, this.gridHeight - 1).x - TILE_WIDTH / 2;
    const right = cellToScreen(this.gridWidth - 1, 0).x + TILE_WIDTH / 2;
    const top = cellToScreen(0, 0).y - TILE_HEIGHT / 2 - MAX_BUILDING_HEIGHT;
    const bottom = cellToScreen(this.gridWidth - 1, this.gridHeight - 1).y + TILE_HEIGHT / 2;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  /**
   * Size the view so a readable chunk of the grid fills the screen, leaving margins
   * for the dock at the bottom and the chrome along the top. On a big grid the fit
   * zoom clamps at MIN_ZOOM rather than shrinking further, so the camera shows a
   * MIN_ZOOM-sized window centred on the grid - the rest is reachable by panning,
   * exactly like the grid is bigger than one screen can hold, because it is.
   */
  private fitCameraToCity(): void {
    const camera = this.cameras.main;
    const bounds = this.cityBounds();

    const availableWidth = Math.max(200, camera.width - MARGIN.x * 2);
    const availableHeight = Math.max(200, camera.height - MARGIN.top - MARGIN.bottom);

    const zoom = Phaser.Math.Clamp(
      Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    camera.setBounds(
      bounds.left - PAN_PADDING,
      bounds.top - PAN_PADDING,
      bounds.width + PAN_PADDING * 2,
      bounds.height + PAN_PADDING * 2,
    );
    camera.setZoom(zoom);

    // Bias upward so the dock does not sit over the southern edge of the city.
    camera.centerOn(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2 + (MARGIN.bottom - MARGIN.top) / 2 / zoom,
    );
  }

  private handleResize(): void {
    if (!this.ready) return;
    this.fitCameraToCity();
  }

  /* ------------------------------------------------------------- FE #1 API */

  setCity(city: { gridWidth: number; gridHeight: number; blocks: PlacedBlock[] }): void {
    const gridChanged = city.gridWidth !== this.gridWidth || city.gridHeight !== this.gridHeight;
    this.gridWidth = city.gridWidth;
    this.gridHeight = city.gridHeight;
    this.blocks = city.blocks;

    if (!this.ready) return; // create() replays the stored layout when it runs
    // Scores belong to the prior layout, not a city that has just been edited.
    this.zoneScores = {};
    this.zoneGfx.clear();
    if (gridChanged) this.drawGround();
    this.renderCity();
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
    if (this.ready) this.renderCity();
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
    this.renderCity();
  }

  setZoneScores(scores: Record<string, number>): void {
    this.zoneScores = scores;
    if (this.ready) this.drawZones();
  }

  clearZoneScores(): void {
    this.zoneScores = {};
    if (this.ready) this.zoneGfx.clear();
  }

  async animateResident(options: AnimateResidentOptions): Promise<void> {
    if (!this.ready) return;
    const points = options.pathBlockIds
      .map((id) => this.blocks.find((block) => block.id === id))
      .filter((block): block is PlacedBlock => Boolean(block))
      .map((block) => {
        const screen = cellToScreen(block.x, block.y);
        // Residents walk the street in front of the plot, not over the roof.
        return { x: screen.x, y: screen.y + TILE_HEIGHT / 4 };
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
    const color = options.color ? toPhaserColor(options.color) : HONEY;
    const centre = cellToScreen(cell.x, cell.y);

    const ring = this.add.graphics().setDepth(DEPTH.ghost);
    ring.lineStyle(3, color, 1);
    this.strokeDiamond(ring, 0, 0, PLOT_INSET);
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

  /* ------------------------------------------------------- ground + streets */

  private drawGround(): void {
    this.groundGfx.clear();

    // One pass: pavement, then the plot cut back out of it. The gap between an
    // inset plot and its tile edge is what reads as "street" - that geometry alone
    // carries the grid without needing per-cell linework (dashed centrelines, a kerb
    // ring), which gets expensive fast as the grid grows and buys little at the zoom
    // this map is usually viewed at.
    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const centre = cellToScreen(x, y);
        this.groundGfx.fillStyle(ASPHALT, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, 0);
        this.groundGfx.fillStyle((x + y) % 2 === 0 ? PLOT_LIGHT : PLOT_DARK, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, PLOT_INSET);
      }
    }

    // Outer silhouette.
    this.groundGfx.lineStyle(3, OUTLINE, 0.35);
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

  /* ---------------------------------------------------------------- render */

  private renderCity(): void {
    for (const node of this.nodes.values()) this.destroyNode(node);
    this.nodes.clear();

    for (const block of [...this.blocks].sort((a, b) => depthOf(a.x, a.y) - depthOf(b.x, b.y))) {
      this.nodes.set(block.id, this.createBlockNode(block));
    }

    this.syncDecor();
    if (Object.keys(this.zoneScores).length > 0) this.drawZones();
  }

  private drawZones(): void {
    this.zoneGfx.clear();

    for (const block of this.blocks) {
      if (block.typeId !== 'housing') continue;
      const score = this.zoneScores[block.id];
      if (score === undefined) continue;

      const centre = cellToScreen(block.x, block.y);
      const color = toPhaserColor(zoneColor(score));
      this.zoneGfx.save();
      this.zoneGfx.translateCanvas(centre.x, centre.y);
      this.zoneGfx.fillStyle(color, 0.72);
      this.fillDiamond(this.zoneGfx, 0, 0, -12);
      this.zoneGfx.lineStyle(2, color, 0.7);
      this.strokeDiamond(this.zoneGfx, 0, 0, -12);
      this.zoneGfx.restore();
    }
  }

  /**
   * Keep decor (trees, cars, passers-by) in sync with which plots are empty, without
   * touching plots that did not change. Blocks are few (bounded by the block budget,
   * not the grid), so rebuilding all of them every time is cheap - but decor covers
   * every empty cell, and a destroy-and-recreate pass over the whole editable grid on
   * every single placement is real, visible jank once that grid is big.
   */
  private syncDecor(): void {
    const occupied = new Set(this.blocks.map((block) => `${block.x},${block.y}`));

    for (const [key, node] of this.decor) {
      if (!occupied.has(key)) continue;
      this.destroyNode(node);
      this.decor.delete(key);
    }

    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const key = `${x},${y}`;
        if (occupied.has(key) || this.decor.has(key)) continue;
        const node = this.createDecorNode(x, y);
        if (node) this.decor.set(key, node);
      }
    }
  }

  private redrawBlock(blockId: string): void {
    const block = this.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    const existing = this.nodes.get(blockId);
    if (existing) this.destroyNode(existing);
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
    const profile = buildingProfile(
      block.typeId,
      block.x,
      block.y,
      this.housingDensity(block.x, block.y),
    );

    let color = base;
    let alpha = 1;
    let glow: number | null = null;

    switch (state) {
      case 'highlighted':
        color = tint(base, 0.22);
        glow = HONEY;
        break;
      case 'flooded':
        color = tint(FLOOD, 0.1);
        alpha = 0.9;
        glow = FLOOD;
        break;
      case 'offline':
        color = shade(base, 0.55);
        alpha = 0.85;
        break;
      case 'dimmed':
        alpha = 0.35;
        break;
      case 'invalid':
        color = BAD;
        glow = BAD;
        break;
      default:
        break;
    }

    const gfx = this.add.graphics();
    const height = profile.floors * FLOOR_HEIGHT;

    if (glow !== null) {
      gfx.fillStyle(glow, 0.16);
      this.fillDiamond(gfx, 0, 0, PLOT_INSET + 1);
    }

    if (profile.floors === 0) {
      this.paintParkland(gfx, block, alpha);
    } else {
      this.paintBuilding(gfx, {
        color,
        floors: profile.floors,
        windowCols: profile.windowCols,
        roof: profile.roof,
        alpha,
      });
    }

    if (state === 'flooded') {
      gfx.fillStyle(FLOOD, 0.45);
      this.fillDiamond(gfx, 0, 0, PLOT_INSET + 1);
    }

    // Drawn last so the ring reads around the base of the building, not under it.
    if (glow !== null) {
      gfx.lineStyle(3, glow, 0.95);
      this.strokeDiamond(gfx, 0, 0, PLOT_INSET + 1);
    }

    const children: Phaser.GameObjects.GameObject[] = [gfx];

    // Housing repeats across whole streets; pinning every house buries the map in
    // markers, so only the services people travel *to* get one.
    if (state !== 'dimmed' && (block.typeId !== 'housing' || state !== 'normal')) {
      const pinY = -height - 26;
      const pin = this.add.graphics();
      this.paintPin(pin, 0, pinY, glow ?? base, alpha);
      const glyph = this.add
        .text(0, pinY - 12, blockGlyph(block.typeId), { fontSize: '15px' })
        .setOrigin(0.5)
        .setAlpha(alpha);
      children.push(pin, glyph);
    }

    const node = this.add
      .container(centre.x, centre.y, children)
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

  /** Nearby homes make the centre of a neighbourhood denser and taller than its edge. */
  private housingDensity(x: number, y: number): number {
    let homes = 0;
    let cells = 0;

    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        const atX = x + offsetX;
        const atY = y + offsetY;
        if (!isWithinGrid({ x: atX, y: atY }, this.gridWidth, this.gridHeight)) continue;
        cells += 1;
        if (this.blockAt({ x: atX, y: atY })?.typeId === 'housing') homes += 1;
      }
    }

    return cells === 0 ? 0 : homes / cells;
  }

  /** Trees, parked cars and passers-by on an empty plot. */
  private createDecorNode(x: number, y: number): Phaser.GameObjects.Container | null {
    const roll = hash2(x, y, 1);
    if (roll > 0.62) return null;

    const centre = cellToScreen(x, y);
    const gfx = this.add.graphics();

    if (roll < 0.3) {
      drawTree(gfx, -8 + hash2(x, y, 2) * 16, 2, 3);
      if (hash2(x, y, 4) > 0.5) drawBush(gfx, 10, 6, 5);
    } else if (roll < 0.46) {
      drawBush(gfx, -6, 4, 6);
      drawBush(gfx, 8, 7, 7);
    } else if (roll < 0.56) {
      // Park it on one of the two streets that meet at the plot's front corner.
      const axis = hash2(x, y, 8) > 0.5 ? 'x' : 'y';
      const offset = axis === 'x' ? -TILE_WIDTH / 4 : TILE_WIDTH / 4;
      drawCar(gfx, offset, TILE_HEIGHT / 4, axis, 9);
    } else {
      drawPerson(gfx, -6, TILE_HEIGHT / 2, 10);
      if (hash2(x, y, 11) > 0.45) drawPerson(gfx, 7, TILE_HEIGHT / 2 + 3, 12);
    }

    return this.add
      .container(centre.x, centre.y, [gfx])
      .setDepth(DEPTH.blocks + depthOf(x, y));
  }

  /* -------------------------------------------------------------- painting */

  /** Draws an extruded building with windowed faces, in local container space. */
  private paintBuilding(gfx: Phaser.GameObjects.Graphics, style: BuildingStyle): void {
    const halfW = TILE_WIDTH / 2 - BUILDING_INSET;
    const halfH = TILE_HEIGHT / 2 - BUILDING_INSET / 2;
    const height = style.floors * FLOOR_HEIGHT;

    const left = { x: -halfW, y: 0 };
    const front = { x: 0, y: halfH };
    const right = { x: halfW, y: 0 };

    // Contact shadow keeps the mass from floating off the plot.
    gfx.fillStyle(0x000000, 0.1 * style.alpha);
    gfx.fillEllipse(2, halfH * 0.55, halfW * 2.1, halfH * 1.5);

    const leftColor = shade(style.color, 0.7);
    const rightColor = shade(style.color, 0.52);

    gfx.fillStyle(leftColor, style.alpha);
    gfx.fillPoints(
      [
        v(left.x, left.y),
        v(front.x, front.y),
        v(front.x, front.y - height),
        v(left.x, left.y - height),
      ],
      true,
    );

    gfx.fillStyle(rightColor, style.alpha);
    gfx.fillPoints(
      [
        v(front.x, front.y),
        v(right.x, right.y),
        v(right.x, right.y - height),
        v(front.x, front.y - height),
      ],
      true,
    );

    this.paintWindows(gfx, left, front, height, style, 0);
    this.paintWindows(gfx, front, right, height, style, 50);

    // Roof: the block colour, with a deck inset so tall buildings read as boxes.
    gfx.fillStyle(style.color, style.alpha);
    this.fillDiamond(gfx, 0, -height, BUILDING_INSET);
    gfx.fillStyle(
      style.roof === 'light' ? tint(style.color, 0.28) : shade(style.color, 0.82),
      style.alpha,
    );
    this.fillDiamond(gfx, 0, -height, BUILDING_INSET + 7);

    // Cartoon silhouette.
    gfx.lineStyle(1.6, OUTLINE, 0.55 * style.alpha);
    this.strokeDiamond(gfx, 0, -height, BUILDING_INSET);
    gfx.lineBetween(left.x, left.y, left.x, left.y - height);
    gfx.lineBetween(right.x, right.y, right.x, right.y - height);
    gfx.lineBetween(front.x, front.y, front.x, front.y - height);
    gfx.strokePoints([v(left.x, left.y), v(front.x, front.y), v(right.x, right.y)], false);
  }

  /**
   * Rows of windows across one face. `a` and `b` are the face's base corners;
   * the face extends `height` upward from that edge.
   */
  private paintWindows(
    gfx: Phaser.GameObjects.Graphics,
    a: { x: number; y: number },
    b: { x: number; y: number },
    height: number,
    style: BuildingStyle,
    salt: number,
  ): void {
    const point = (u: number, w: number) => ({
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u - w * height,
    });

    for (let floor = 0; floor < style.floors; floor += 1) {
      const bottom = (floor + 0.28) / style.floors;
      const top = (floor + 0.78) / style.floors;

      for (let col = 0; col < style.windowCols; col += 1) {
        const from = (col + 0.24) / style.windowCols;
        const to = (col + 0.76) / style.windowCols;
        const lit = !style.flat && hash2(col + salt, floor, Math.round(a.x + b.y)) > 0.72;

        gfx.fillStyle(lit ? WINDOW_LIT : WINDOW, (lit ? 0.95 : 0.8) * style.alpha);
        gfx.fillPoints(
          [
            v(point(from, bottom).x, point(from, bottom).y),
            v(point(to, bottom).x, point(to, bottom).y),
            v(point(to, top).x, point(to, top).y),
            v(point(from, top).x, point(from, top).y),
          ],
          true,
        );
      }
    }
  }

  /** Parks have no massing - grass, trees and a path instead. */
  private paintParkland(
    gfx: Phaser.GameObjects.Graphics,
    block: PlacedBlock,
    alpha: number,
  ): void {
    gfx.fillStyle(GRASS, alpha);
    this.fillDiamond(gfx, 0, 0, PLOT_INSET + 2);
    gfx.lineStyle(1.4, OUTLINE, 0.3 * alpha);
    this.strokeDiamond(gfx, 0, 0, PLOT_INSET + 2);

    gfx.lineStyle(4, KERB, 0.85 * alpha);
    gfx.lineBetween(-TILE_WIDTH / 2 + PLOT_INSET + 4, 0, TILE_WIDTH / 2 - PLOT_INSET - 4, 0);

    drawTree(gfx, -12, -3, block.x + 20);
    drawTree(gfx, 11, 5, block.y + 40);
    drawBush(gfx, 0, 9, block.x + block.y + 60);
  }

  /** The map-pin marker that floats above a plot, carrying the service glyph. */
  private paintPin(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    color: number,
    alpha: number,
  ): void {
    gfx.fillStyle(color, alpha);
    gfx.fillPoints([v(x - 6, y - 8), v(x + 6, y - 8), v(x, y + 2)], true);
    gfx.fillCircle(x, y - 12, 13);
    gfx.fillStyle(0xffffff, alpha);
    gfx.fillCircle(x, y - 12, 10.5);
    gfx.lineStyle(1.5, OUTLINE, 0.25 * alpha);
    gfx.strokeCircle(x, y - 12, 13);
  }

  private drawOverlay(): void {
    this.overlayGfx.clear();
    this.markerGfx.clear();

    if (this.hoverCell && !this.ghost) {
      const centre = cellToScreen(this.hoverCell.x, this.hoverCell.y);
      this.overlayGfx.fillStyle(HONEY, 0.3);
      this.fillDiamond(this.overlayGfx, centre.x, centre.y, PLOT_INSET);
      this.markerGfx.lineStyle(2, HONEY, 0.75);
      this.strokeDiamond(this.markerGfx, centre.x, centre.y, PLOT_INSET);
    }

    if (this.selectedCell) {
      const centre = cellToScreen(this.selectedCell.x, this.selectedCell.y);
      this.markerGfx.lineStyle(3, HONEY, 1);
      this.strokeDiamond(this.markerGfx, centre.x, centre.y, PLOT_INSET);
    }
  }

  private drawGhost(): void {
    this.ghostGfx.clear();
    if (!this.ghost) {
      this.drawOverlay();
      return;
    }

    const centre = cellToScreen(this.ghost.x, this.ghost.y);
    const profile = buildingProfile(this.ghost.typeId);
    const color = this.ghost.valid ? toPhaserColor(blockColor(this.ghost.typeId)) : BAD;

    this.ghostGfx.setPosition(centre.x, centre.y);
    this.ghostGfx.fillStyle(color, 0.22);
    this.fillDiamond(this.ghostGfx, 0, 0, PLOT_INSET);
    this.paintBuilding(this.ghostGfx, {
      color,
      floors: Math.max(profile.floors, 1),
      windowCols: profile.windowCols || 3,
      roof: profile.roof,
      alpha: 0.55,
      flat: true,
    });
    this.ghostGfx.lineStyle(3, this.ghost.valid ? HONEY : BAD, 1);
    this.strokeDiamond(this.ghostGfx, 0, 0, PLOT_INSET);
  }

  /**
   * Draw the proposal preview: a translucent block wherever the change would place or
   * move something. Reuses the ghost painting so a previewed block reads the same as one
   * being dragged in.
   */
  private drawPreview(): void {
    this.previewGfx.clear();
    if (this.preview.length === 0) return;

    // paintBuilding draws around the origin, so translate the canvas per cell rather
    // than moving the Graphics object - one object has to cover every previewed change.
    for (const change of this.preview) {
      if (change.op === 'remove') continue;

      const typeId =
        change.typeId ??
        this.blocks.find((block) => block.id === change.blockId)?.typeId ??
        'housing';
      const centre = cellToScreen(change.x, change.y);
      const profile = buildingProfile(typeId);
      const color = toPhaserColor(blockColor(typeId));

      this.previewGfx.save();
      this.previewGfx.translateCanvas(centre.x, centre.y);
      this.previewGfx.fillStyle(color, 0.18);
      this.fillDiamond(this.previewGfx, 0, 0, PLOT_INSET);
      this.paintBuilding(this.previewGfx, {
        color,
        floors: Math.max(profile.floors, 1),
        windowCols: profile.windowCols || 3,
        roof: profile.roof,
        alpha: 0.45,
        flat: true,
      });
      this.previewGfx.lineStyle(2, HONEY, 0.8);
      this.strokeDiamond(this.previewGfx, 0, 0, PLOT_INSET);
      this.previewGfx.restore();
    }
  }

  private drawTrail(points: Array<{ x: number; y: number }>): void {
    this.trailGfx.clear();
    this.trailGfx.lineStyle(4, HONEY, 0.55);
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
    bubble.fillStyle(0x2a2213, 0.92);
    bubble.fillCircle(0, 0, 13);
    bubble.lineStyle(2, HONEY, 1);
    bubble.strokeCircle(0, 0, 13);

    const glyph = this.add.text(0, 0, personaGlyph(personaId), { fontSize: '14px' }).setOrigin(0.5);

    return this.add.container(at.x ?? 0, at.y ?? 0, [bubble, glyph]).setDepth(DEPTH.residents);
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
  pointerToCell(worldX: number, worldY: number): Cell | null {
    const cell = screenToCell(worldX, worldY);
    return isWithinGrid(cell, this.gridWidth, this.gridHeight) ? cell : null;
  }

  /**
   * Canvas-relative pixels to a grid cell. The HTML drag-and-drop bridge only knows
   * where the pointer is on the canvas, so the camera transform is applied here.
   */
  canvasPointToCell(canvasX: number, canvasY: number): Cell | null {
    const world = this.cameras.main.getWorldPoint(canvasX, canvasY);
    return this.pointerToCell(world.x, world.y);
  }

  /** Re-centre and re-fit the city. Used by the "recentre" control. */
  resetView(): void {
    if (this.ready) this.fitCameraToCity();
  }

  private destroyNode(node: Phaser.GameObjects.Container): void {
    this.tweens.killTweensOf(node);
    node.destroy();
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
