import Phaser from 'phaser';
import type { BlockChange, PlacedBlock } from '@rmc/shared';
import { blockColor, blockGlyph, personaGlyph, toPhaserColor } from '@/lib/visuals';
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
  dashedLine,
  drawBush,
  drawCar,
  drawPerson,
  drawTree,
  hash2,
} from './props';
import type {
  AnimateResidentOptions,
  BlockVisualState,
  CitySceneApi,
  JourneyOverlay,
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
const OUTLINE = 0x1b2a3a;
const ASPHALT = 0xd6dde2;
const ASPHALT_EDGE = 0xc3ccd4;
const ROAD_LINE = 0xfbfdff;
const PLOT_LIGHT = 0xe4ece0;
const PLOT_DARK = 0xd8e4d4;
const KERB = 0xf3f6f4;
const GRASS = 0xa8d9a5;
const WINDOW = 0xf7fbff;
const WINDOW_LIT = 0xffd98a;
const APRICOT = 0xffb347;
const FLOOD = 0x3f7fd0;

/** Journey overlay - mirrors --color-good / --color-bad / the transport block colour. */
const ROUTE_OK = 0x57c98a;
const ROUTE_FAIL = 0xf2616b;
const ROUTE_TRANSPORT = 0x46a6d6;
const CHIP_INK = 'rgba(13, 20, 35, 0.92)';

const DEPTH = {
  ground: 0,
  overlay: 1,
  blocks: 10,
  trail: 3500,
  journey: 3600,
  residents: 4000,
  /** Journey chips sit above the walker so a resident never hides its own cost. */
  journeyLabel: 4600,
  /** Selection and hover rings sit above the massing, or a tall building hides them. */
  marker: 4500,
  ghost: 5000,
};

/**
 * Camera limits. The floor lets a 10x10 grid sit comfortably inside the viewport with
 * room around it; the ceiling is where one plot fills enough of the screen to read the
 * building detail without the art falling apart.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** How much of the map must stay on screen when panning, in world pixels. */
const PAN_MARGIN = 160;
/** A pointer that travels further than this between down and up was a pan, not a click. */
const CLICK_SLOP = 5;

/** Phaser's Graphics point APIs are typed for Vector2, not plain {x, y}. */
const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

/** Journey costs land on halves at most, so one decimal is the whole story. */
const formatMinutes = (minutes: number): string =>
  Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);

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
  /** Fires whenever the camera zooms, so the UI can show the level and enable buttons. */
  onViewChange?: (zoom: number) => void;
}

export class CityScene extends Phaser.Scene implements CitySceneApi {
  static readonly KEY = 'city';

  private gridWidth = 10;
  private gridHeight = 10;
  private blocks: PlacedBlock[] = [];

  private readonly states = new Map<string, BlockVisualState>();
  /**
   * Proposal mode's preview dimming, kept apart from `states`.
   *
   * Three modes can be open at once and all of them write block states. If the preview
   * wrote into `states`, closing a proposal would reset blocks to `normal` and wipe
   * whatever Simulation or Access had marked. Layering them means each owner only ever
   * clears its own.
   */
  private readonly previewStates = new Map<string, BlockVisualState>();
  private readonly highlighted = new Set<string>();
  private readonly nodes = new Map<string, Phaser.GameObjects.Container>();
  private readonly decor = new Map<string, Phaser.GameObjects.Container>();

  private groundGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private previewGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private journeyGfx!: Phaser.GameObjects.Graphics;

  /** The journey currently drawn over the streets, with its per-leg costs. */
  private journey: JourneyOverlay | null = null;
  /** Chips and markers belonging to that journey - destroyed together. */
  private journeyMarks: Phaser.GameObjects.GameObject[] = [];

  private residents: Phaser.GameObjects.Container[] = [];
  private hoverCell: Cell | null = null;
  private selectedCell: Cell | null = null;
  private ghost: { x: number; y: number; typeId: string; valid: boolean } | null = null;
  /** Proposal-mode change preview. Draws over the city without altering it. */
  private preview: BlockChange[] = [];

  private callbacks: CitySceneCallbacks = {};
  /** create() has run and the graphics objects exist. */
  private ready = false;

  /** Pointer-drag panning. Null when no drag is in progress. */
  private pan: { pointerX: number; pointerY: number; scrollX: number; scrollY: number } | null =
    null;
  /** Where the pointer went down, so a drag does not also count as a click. */
  private pressedAt: { x: number; y: number } | null = null;

  constructor() {
    super(CityScene.KEY);
  }

  setCallbacks(callbacks: CitySceneCallbacks): void {
    this.callbacks = callbacks;
  }

  create(): void {
    this.groundGfx = this.add.graphics().setDepth(DEPTH.ground);
    this.overlayGfx = this.add.graphics().setDepth(DEPTH.overlay);
    this.markerGfx = this.add.graphics().setDepth(DEPTH.marker);
    this.trailGfx = this.add.graphics().setDepth(DEPTH.trail);
    this.journeyGfx = this.add.graphics().setDepth(DEPTH.journey);
    this.ghostGfx = this.add.graphics().setDepth(DEPTH.ghost);
    this.previewGfx = this.add.graphics().setDepth(DEPTH.ghost - 1);

    this.drawGround();
    this.renderCity();

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (this.pan && pointer.isDown) {
        // Drag the map itself. Dividing by zoom keeps the grab point under the cursor.
        const camera = this.cameras.main;
        camera.setScroll(
          this.pan.scrollX + (this.pan.pointerX - pointer.x) / camera.zoom,
          this.pan.scrollY + (this.pan.pointerY - pointer.y) / camera.zoom,
        );
        this.clampScroll();
        return;
      }

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

    // Placing happens on release, not on press: otherwise the first pixel of a pan
    // would drop a block before the map had moved.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const camera = this.cameras.main;
      this.pressedAt = { x: pointer.x, y: pointer.y };
      this.pan = {
        pointerX: pointer.x,
        pointerY: pointer.y,
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
      };
    });

    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const pressed = this.pressedAt;
      this.pressedAt = null;
      this.pan = null;
      if (!pressed) return;

      const travelled = Math.hypot(pointer.x - pressed.x, pointer.y - pressed.y);
      if (travelled > CLICK_SLOP) return; // that was a pan

      const cell = this.pointerToCell(pointer.worldX, pointer.worldY);
      if (!cell) return;
      this.callbacks.onCellClick?.(cell, this.blockAt(cell));
    });

    this.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.pan = null;
      this.pressedAt = null;
    });

    this.ready = true;
    this.drawJourney(); // a journey set before create() replays here
  }

  /* ---------------------------------------------------------------- camera */

  /**
   * Zoom and pan.
   *
   * The map is the product and it fills the screen, so it has to behave like a map:
   * pinch or scroll to zoom, drag to move, and a way back to the whole city. Everything
   * here works in the game's fixed logical space; the camera transform is the only thing
   * between that and what is on screen, which is why `screenPointToCell` exists.
   */

  getZoom(): number {
    return this.ready ? this.cameras.main.zoom : 1;
  }

  /**
   * Zoom to an absolute level, keeping `focus` (a point in game space, usually the
   * cursor) pinned to the same place on screen - otherwise zooming walks the city away
   * from whatever you were looking at.
   */
  setZoom(zoom: number, focus?: { x: number; y: number }): void {
    if (!this.ready) return;
    const camera = this.cameras.main;
    const next = Phaser.Math.Clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    if (next === camera.zoom) return;

    const anchor = focus ?? { x: camera.width / 2, y: camera.height / 2 };
    const before = camera.getWorldPoint(anchor.x, anchor.y);

    camera.setZoom(next);

    const after = camera.getWorldPoint(anchor.x, anchor.y);
    camera.setScroll(
      camera.scrollX + (before.x - after.x),
      camera.scrollY + (before.y - after.y),
    );

    this.clampScroll();
    this.callbacks.onViewChange?.(camera.zoom);
  }

  /** Multiply the current zoom - what a wheel notch or a button press does. */
  zoomBy(factor: number, focus?: { x: number; y: number }): void {
    this.setZoom(this.getZoom() * factor, focus);
  }

  /** Move the camera by a screen-space delta. */
  panBy(dx: number, dy: number): void {
    if (!this.ready) return;
    const camera = this.cameras.main;
    camera.setScroll(camera.scrollX + dx / camera.zoom, camera.scrollY + dy / camera.zoom);
    this.clampScroll();
  }

  /** Back to the whole city, centred. The escape hatch from any lost view. */
  resetView(): void {
    if (!this.ready) return;
    const camera = this.cameras.main;
    camera.setZoom(1);
    camera.setScroll(0, 0);
    this.callbacks.onViewChange?.(camera.zoom);
  }

  /** Game-space point (from a DOM event) to a grid cell, through the camera. */
  screenPointToCell(gameX: number, gameY: number): Cell | null {
    if (!this.ready) return this.pointerToCell(gameX, gameY);
    const world = this.cameras.main.getWorldPoint(gameX, gameY);
    return this.pointerToCell(world.x, world.y);
  }

  /**
   * Keep the city reachable. The grid's own bounds plus a margin, so you can push the
   * map aside to see a panel behind it but never lose it off the edge of the world.
   */
  private clampScroll(): void {
    const camera = this.cameras.main;
    const bounds = this.gridBounds();
    const halfW = camera.width / (2 * camera.zoom);
    const halfH = camera.height / (2 * camera.zoom);

    const centreX = camera.scrollX + halfW;
    const centreY = camera.scrollY + halfH;

    camera.setScroll(
      Phaser.Math.Clamp(centreX, bounds.left - PAN_MARGIN, bounds.right + PAN_MARGIN) - halfW,
      Phaser.Math.Clamp(centreY, bounds.top - PAN_MARGIN, bounds.bottom + PAN_MARGIN) - halfH,
    );
  }

  /** The diamond's bounding box in world space. */
  private gridBounds(): { left: number; right: number; top: number; bottom: number } {
    const corners = [
      cellToScreen(0, 0),
      cellToScreen(this.gridWidth - 1, 0),
      cellToScreen(0, this.gridHeight - 1),
      cellToScreen(this.gridWidth - 1, this.gridHeight - 1),
    ];
    return {
      left: Math.min(...corners.map((point) => point.x)) - TILE_WIDTH,
      right: Math.max(...corners.map((point) => point.x)) + TILE_WIDTH,
      top: Math.min(...corners.map((point) => point.y)) - TILE_HEIGHT * 2,
      bottom: Math.max(...corners.map((point) => point.y)) + TILE_HEIGHT * 2,
    };
  }

  /* ------------------------------------------------------------- FE #1 API */

  setCity(city: { gridWidth: number; gridHeight: number; blocks: PlacedBlock[] }): void {
    const gridChanged = city.gridWidth !== this.gridWidth || city.gridHeight !== this.gridHeight;
    this.gridWidth = city.gridWidth;
    this.gridHeight = city.gridHeight;
    this.blocks = city.blocks;

    if (!this.ready) return; // create() replays the stored layout when it runs
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

  /** Clears the simulation/access layer. The proposal preview is cleared separately. */
  clearStates(): void {
    this.states.clear();
    this.highlighted.clear();
    this.showJourney(null);
    if (!this.ready) return;
    this.trailGfx.clear();
    this.renderCity();
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

    await this.tweenAlong(walker, points, options.durationMs ?? (points.length - 1) * 240);

    await this.wait(250);
    this.removeResident(walker);
  }

  clearResidents(): void {
    for (const walker of this.residents) walker.destroy();
    this.residents = [];
    this.trailGfx.clear();
  }

  showJourney(overlay: JourneyOverlay | null): void {
    this.journey = overlay;
    if (this.ready) this.drawJourney();
  }

  async walkJourney(): Promise<void> {
    const overlay = this.journey;
    if (!this.ready || !overlay || overlay.cells.length < 2) return;

    const points = this.journeyPoints(overlay);
    const walker = this.createResident(
      overlay.personaId,
      points[0] as Phaser.Types.Math.Vector2Like,
    );
    this.residents.push(walker);

    // Time the walk by the journey's own cost, so a slow route looks slow:
    // 90ms of animation per simulated minute, clamped to something watchable.
    const duration = Math.min(Math.max(overlay.totalMinutes * 90, 900), 6000);
    await this.tweenAlong(walker, points, duration);
    await this.wait(200);
    this.removeResident(walker);
  }

  /* --------------------------------------------------------- FE #3 API */

  previewChanges(changes: BlockChange[]): void {
    this.clearPreviewStates();
    this.preview = changes;

    // Removals and moves dim the block that would go; additions are drawn as ghosts.
    for (const change of changes) {
      if (change.op === 'place' || !change.blockId) continue;
      this.previewStates.set(change.blockId, 'dimmed');
      if (this.ready) this.redrawBlock(change.blockId);
    }

    if (this.ready) this.drawPreview();
  }

  clearPreview(): void {
    this.clearPreviewStates();
    this.preview = [];
    if (this.ready) this.previewGfx.clear();
  }

  /** Drop only the preview's own dimming, leaving other modes' states intact. */
  private clearPreviewStates(): void {
    const dimmed = [...this.previewStates.keys()];
    this.previewStates.clear();
    if (!this.ready) return;
    for (const blockId of dimmed) this.redrawBlock(blockId);
  }

  pulseCell(cell: Cell, options: { color?: string; repeats?: number } = {}): void {
    if (!this.ready) return;
    const color = options.color ? toPhaserColor(options.color) : APRICOT;
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

    // Ground slab: the whole grid is paved, then each plot is cut back out of it,
    // so the leftover margins form a continuous street grid.
    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const centre = cellToScreen(x, y);
        this.groundGfx.fillStyle(ASPHALT, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, 0);
      }
    }

    // Street centre markings along every other seam - main streets read as wider.
    this.groundGfx.lineStyle(1.6, ROAD_LINE, 0.9);
    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const centre = cellToScreen(x, y);
        const right = { x: centre.x + TILE_WIDTH / 2, y: centre.y };
        const bottom = { x: centre.x, y: centre.y + TILE_HEIGHT / 2 };
        const left = { x: centre.x - TILE_WIDTH / 2, y: centre.y };
        if (x % 2 === 1 && x < this.gridWidth - 1) dashedLine(this.groundGfx, right, bottom, 7, 6);
        if (y % 2 === 1 && y < this.gridHeight - 1) dashedLine(this.groundGfx, left, bottom, 7, 6);
      }
    }

    // Plots: kerb ring, then the plot surface.
    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const centre = cellToScreen(x, y);
        this.groundGfx.fillStyle(KERB, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, PLOT_INSET - 2);
        this.groundGfx.fillStyle((x + y) % 2 === 0 ? PLOT_LIGHT : PLOT_DARK, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, PLOT_INSET + 1);
        this.groundGfx.lineStyle(1, ASPHALT_EDGE, 0.7);
        this.strokeDiamond(this.groundGfx, centre.x, centre.y, PLOT_INSET - 2);
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
    for (const node of this.decor.values()) this.destroyNode(node);
    this.nodes.clear();
    this.decor.clear();

    for (const block of [...this.blocks].sort((a, b) => depthOf(a.x, a.y) - depthOf(b.x, b.y))) {
      this.nodes.set(block.id, this.createBlockNode(block));
    }

    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        if (this.blockAt({ x, y })) continue;
        const node = this.createDecorNode(x, y);
        if (node) this.decor.set(`${x},${y}`, node);
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
    return this.previewStates.get(blockId) ?? this.states.get(blockId) ?? 'normal';
  }

  private createBlockNode(block: PlacedBlock): Phaser.GameObjects.Container {
    const centre = cellToScreen(block.x, block.y);
    const state = this.effectiveState(block.id);
    const base = toPhaserColor(blockColor(block.typeId));
    const profile = buildingProfile(block.typeId);

    let color = base;
    let alpha = 1;
    let glow: number | null = null;

    switch (state) {
      case 'highlighted':
        color = tint(base, 0.22);
        glow = APRICOT;
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
        color = 0xf2616b;
        glow = 0xf2616b;
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
    gfx.fillStyle(0xfdfaf3, alpha);
    gfx.fillCircle(x, y - 12, 10.5);
    gfx.lineStyle(1.5, OUTLINE, 0.25 * alpha);
    gfx.strokeCircle(x, y - 12, 13);
  }

  private drawOverlay(): void {
    this.overlayGfx.clear();
    this.markerGfx.clear();

    if (this.hoverCell && !this.ghost) {
      const centre = cellToScreen(this.hoverCell.x, this.hoverCell.y);
      this.overlayGfx.fillStyle(APRICOT, 0.3);
      this.fillDiamond(this.overlayGfx, centre.x, centre.y, PLOT_INSET);
      this.markerGfx.lineStyle(2, APRICOT, 0.75);
      this.strokeDiamond(this.markerGfx, centre.x, centre.y, PLOT_INSET);
    }

    if (this.selectedCell) {
      const centre = cellToScreen(this.selectedCell.x, this.selectedCell.y);
      this.markerGfx.lineStyle(3, APRICOT, 1);
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
    const color = this.ghost.valid ? toPhaserColor(blockColor(this.ghost.typeId)) : 0xf2616b;

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
    this.ghostGfx.lineStyle(3, this.ghost.valid ? APRICOT : 0xf2616b, 1);
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
      this.previewGfx.lineStyle(2, APRICOT, 0.8);
      this.strokeDiamond(this.previewGfx, 0, 0, PLOT_INSET);
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

  /* -------------------------------------------------------------- journeys */

  /** Route points sit on the street in front of each plot, not on the roofs. */
  private journeyPoints(overlay: JourneyOverlay): Array<{ x: number; y: number }> {
    return overlay.cells.map((cell) => {
      const screen = cellToScreen(cell.x, cell.y);
      return { x: screen.x, y: screen.y + TILE_HEIGHT / 4 };
    });
  }

  /**
   * The journey cost model, drawn. Each leg is stroked in its own colour and
   * labelled with what it cost, so the route explains its own total: a long
   * detour around a building, or a short blue hop on transport.
   */
  private drawJourney(): void {
    this.journeyGfx.clear();
    for (const mark of this.journeyMarks) mark.destroy();
    this.journeyMarks = [];

    const overlay = this.journey;
    if (!overlay || overlay.cells.length === 0) return;

    const points = this.journeyPoints(overlay);
    const routeColor = overlay.accessible ? ROUTE_OK : ROUTE_FAIL;
    const routeHex = overlay.accessible ? '#57c98a' : '#f2616b';

    // A dark casing under the route keeps it readable over asphalt and grass alike.
    if (points.length > 1) {
      this.journeyGfx.lineStyle(9, 0x0d1423, 0.3);
      this.journeyGfx.strokePoints(
        points.map((point) => v(point.x, point.y)),
        false,
      );
    }

    overlay.steps.forEach((step, index) => {
      const from = points[index];
      const to = points[index + 1];
      if (!from || !to) return;
      this.journeyGfx.lineStyle(
        step.transport ? 6 : 4,
        step.transport ? ROUTE_TRANSPORT : routeColor,
        0.95,
      );
      this.journeyGfx.strokePoints([v(from.x, from.y), v(to.x, to.y)], false);
    });

    // Every leg carries its minutes. Long routes would collide, so on those only
    // the transport legs and every other walked leg are labelled.
    const thin = overlay.steps.length > 10;
    overlay.steps.forEach((step, index) => {
      if (thin && !step.transport && index % 2 === 1) return;
      const from = points[index];
      const to = points[index + 1];
      if (!from || !to) return;
      this.journeyMarks.push(
        this.chip(
          (from.x + to.x) / 2,
          (from.y + to.y) / 2,
          formatMinutes(step.minutes),
          step.transport ? '#46a6d6' : routeHex,
          9,
        ),
      );
    });

    const start = points[0];
    const end = points[points.length - 1];
    if (!start || !end) return;

    // Origin: who is walking. Destination: what the whole trip cost.
    this.journeyMarks.push(
      this.createResident(overlay.personaId, start).setDepth(DEPTH.journeyLabel),
    );

    if (points.length > 1) {
      this.journeyMarks.push(
        this.chip(
          end.x,
          end.y - 26,
          overlay.accessible
            ? `${formatMinutes(overlay.totalMinutes)} min`
            : `${formatMinutes(overlay.totalMinutes)} min \u00b7 over ${overlay.thresholdMinutes}`,
          routeHex,
          12,
        ),
      );
    }
  }

  /** A small dark pill of text pinned to a point on the map. */
  private chip(
    x: number,
    y: number,
    text: string,
    color: string,
    fontSize: number,
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, {
        fontSize: `${fontSize}px`,
        fontStyle: 'bold',
        color,
        backgroundColor: CHIP_INK,
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.journeyLabel);
  }

  /** Move a container along a polyline, arcing slightly on each hop. */
  private tweenAlong(
    walker: Phaser.GameObjects.Container,
    points: Array<{ x: number; y: number }>,
    duration: number,
  ): Promise<void> {
    const legs = points.length - 1;
    if (legs < 1) return Promise.resolve();

    return new Promise<void>((resolve) => {
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
  pointerToCell(screenX: number, screenY: number): Cell | null {
    const cell = screenToCell(screenX, screenY);
    return isWithinGrid(cell, this.gridWidth, this.gridHeight) ? cell : null;
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
