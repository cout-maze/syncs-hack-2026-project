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
  nudge,
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
  type RoofStyle,
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
/** Carriageway. Neutral and a shade darker than the plots either side of it, so a
 *  street channel reads as road surface rather than as a gap between tiles. */
const ASPHALT = 0xdedbd2;
/** Arterials, a further shade down - the hierarchy is what makes it a network. */
const ROAD_MAJOR = 0xc9c6bc;
const LANE_MARK = 0xfdfcf7;
/** Buildable ground. One tone: the old light/dark alternation read as a chessboard. */
const GROUND = 0xe7ebda;
const KERB = 0xf7f5ee;
/** Every Nth grid line is an arterial rather than a side street. */
const ARTERIAL_EVERY = 4;
const GRASS = 0x9ed49a;
/** Windows read as cool glass against the near-white walls, the way the reference
 *  isometric city maps do - a near-white pane on a white wall is invisible. */
const WINDOW = 0xbed2e2;
const WINDOW_LIT = 0xffd98a;
const WINDOW_GLASS = 0x7fc8e8;
const HONEY = 0xe8a532;
const FLOOD = 0x2f6fc4;
const BAD = 0xd1373f;
/** Roof palette - every building gets a parapet rim, a recessed deck and a little
 *  mechanical clutter; the accessory on top is what identifies the service. */
const ROOF_UNIT = 0xb4bfcc;
const ROOF_GARDEN = 0x8ecb9a;
const ROOF_WHITE = 0xfbf8ef;
const ROOF_RED = 0xd1373f;
const FLAG_RED = 0xd1373f;
const METAL = 0x8f96a3;
/** How far a flat roof's surface sits below the top of its parapet. */
const DECK_DROP = 3;
/** Thickness of the parapet wall around a roof deck. */
const PARAPET_W = 5;

/** Pointer slop before a press counts as a pan rather than a click. */
const DRAG_THRESHOLD = 6;
/** Exported so the zoom buttons know when to disable themselves. */
export const MIN_ZOOM = 0.28;
export const MAX_ZOOM = 2.6;
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
  /** Access mode's static route trace. Below `trail`, so a live walk still reads on top. */
  route: 3400,
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
  /** Roof accessory - see RoofStyle in props.ts. Defaults to 'plain'. */
  roofStyle?: RoofStyle;
  /** Extra margin shaved off the footprint, beyond BUILDING_INSET. */
  footprintInset?: number;
  /** Lit windows read as cool glass instead of warm amber - technology hub. */
  glass?: boolean;
  /** Stable per-cell value, so rooftop clutter is the same on every redraw. */
  seed?: number;
}

export interface CitySceneCallbacks {
  onCellClick?: (cell: Cell, block: PlacedBlock | null) => void;
  onCellHover?: (cell: Cell | null, block: PlacedBlock | null) => void;
  /** Fires whenever the camera's zoom changes, so the zoom buttons can show the level. */
  onZoomChange?: (zoom: number) => void;
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
  private routeGfx!: Phaser.GameObjects.Graphics;

  private residents: Phaser.GameObjects.Container[] = [];
  private hoverCell: Cell | null = null;
  private selectedCell: Cell | null = null;
  private ghost: { x: number; y: number; typeId: string; valid: boolean } | null = null;
  /** Proposal-mode change preview. Draws over the city without altering it. */
  private preview: BlockChange[] = [];
  /** Loops the ghost preview's opacity while a preview with an addition is active. */
  private previewPulse: Phaser.Tweens.Tween | null = null;
  /** Per-house service accessibility scores from the latest simulation run. */
  private zoneScores: Record<string, number> = {};
  /** Access mode's active route trace, or null. Non-endpoint blocks dim while this is set. */
  private routeTrace: { cells: Cell[]; endpoints: Set<string> } | null = null;

  /** In-flight drag-to-pan gesture, or null when the pointer is up / still. */
  private pan: {
    pointerX: number;
    pointerY: number;
    scrollX: number;
    scrollY: number;
    moved: boolean;
  } | null = null;

  private callbacks: CitySceneCallbacks = {};
  private readonly registerScene: boolean;
  /** create() has run and the graphics objects exist. */
  private ready = false;

  constructor(registerScene = true) {
    super(CityScene.KEY);
    this.registerScene = registerScene;
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
    this.routeGfx = this.add.graphics().setDepth(DEPTH.route);
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
        this.zoomTo(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1), { x: pointer.x, y: pointer.y });
      },
    );

    this.ready = true;

    // Registering here (rather than at construction) means anyone who gets a scene
    // back from the registry gets one that has actually drawn itself. The intro
    // curtain uses exactly that as its "map is ready" signal.
    if (this.registerScene) registerCityScene(this);
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
    this.callbacks.onZoomChange?.(zoom);
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
    if (gridChanged) {
      this.drawGround();
      // The old zoom/pan was tuned for the previous city's size - most visibly wrong
      // when Proposal mode swaps in the much smaller council city. Re-fit to match.
      this.fitCameraToCity();
    }
    // No-op unless a preview is active - see applyPreviewDimming()'s doc comment for
    // why this has to run again here, not just from previewChanges().
    this.applyPreviewDimming();
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
    this.applyPreviewDimming();
    if (this.ready) {
      this.drawPreview();
      this.startPreviewPulse();
    }
  }

  clearPreview(): void {
    for (const change of this.preview) {
      if (change.op === 'place') continue;
      const blockId = change.blockId ?? this.blockAt({ x: change.x, y: change.y })?.id;
      if (blockId) this.setBlockState(blockId, 'normal');
    }
    this.preview = [];
    this.previewPulse?.stop();
    this.previewPulse = null;
    if (this.ready) {
      this.previewGfx.clear();
      this.previewGfx.setAlpha(1);
    }
  }

  /**
   * The ghost of an added or moved-to block breathes in and out continuously, so a
   * proposal's change reads as "look here" rather than sitting flat on the map. Existing
   * blocks affected by a remove/move pulse too - see the routeTrace-style check in
   * createBlockNode.
   */
  private startPreviewPulse(): void {
    this.previewPulse?.stop();
    this.previewGfx.setAlpha(1);
    if (!this.preview.some((change) => change.op !== 'remove')) {
      this.previewPulse = null;
      return;
    }
    this.previewPulse = this.tweens.add({
      targets: this.previewGfx,
      alpha: { from: 1, to: 0.4 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Removals and moves dim the block that would go; additions are drawn as ghosts by
   * `drawPreview()`. Seed proposals describe a remove/move by cell rather than a real
   * blockId (they're authored data, not something drawn out of a live layout), so fall
   * back to whatever block currently sits at (x, y).
   *
   * Called from `previewChanges()`, and again from `setCity()` whenever a preview is
   * active: `proposal.changes` and the council city's blocks load from two independent
   * requests, so `previewChanges` can run before `setCity` has delivered the blocks it
   * needs to resolve against. Re-running this once the real blocks arrive is what makes
   * the dimming show up either way, regardless of which request wins the race.
   */
  private applyPreviewDimming(): void {
    for (const change of this.preview) {
      if (change.op === 'place') continue;
      const blockId = change.blockId ?? this.blockAt({ x: change.x, y: change.y })?.id;
      if (blockId) this.setBlockState(blockId, 'dimmed');
    }
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

  traceRoute(route: { cells: Cell[]; endpointBlockIds: string[] } | null): void {
    this.routeTrace = route ? { cells: route.cells, endpoints: new Set(route.endpointBlockIds) } : null;
    if (!this.ready) return;
    this.drawRouteTrace();
    // Every block's alpha depends on routeTrace now, not just its own state.
    this.renderCity();
  }

  private drawRouteTrace(): void {
    this.routeGfx.clear();
    if (!this.routeTrace || this.routeTrace.cells.length < 2) return;

    const points = this.routeTrace.cells.map((cell) => {
      const screen = cellToScreen(cell.x, cell.y);
      // Walk the street in front of the plot, not over the roof - matches animateResident.
      return v(screen.x, screen.y + TILE_HEIGHT / 4);
    });

    this.routeGfx.lineStyle(4, HONEY, 0.7);
    this.routeGfx.strokePoints(points, false);
  }

  /* ------------------------------------------------------- ground + streets */

  private drawGround(): void {
    this.groundGfx.clear();

    // The whole grid is carriageway, and the plots are laid back down on top of it -
    // so the strip left showing between them is the street. Laying the surface once
    // here rather than once per tile is what leaves budget for the road furniture
    // below; the per-tile pass is then just kerb + plot, the same two fills as before.
    const north = cellToScreen(-0.5, -0.5);
    const east = cellToScreen(this.gridWidth - 0.5, -0.5);
    const south = cellToScreen(this.gridWidth - 0.5, this.gridHeight - 0.5);
    const west = cellToScreen(-0.5, this.gridHeight - 0.5);
    const perimeter = [
      v(north.x, north.y),
      v(east.x, east.y),
      v(south.x, south.y),
      v(west.x, west.y),
    ];

    this.groundGfx.fillStyle(ASPHALT, 1);
    this.groundGfx.fillPoints(perimeter, true);

    // Arterials, drawn full-length under the plots. Only the part crossing a street
    // channel survives being covered, which is exactly the road - so one cheap band
    // per arterial buys a continuous main road instead of per-tile linework.
    this.groundGfx.fillStyle(ROAD_MAJOR, 1);
    for (let x = ARTERIAL_EVERY; x < this.gridWidth; x += ARTERIAL_EVERY) {
      this.fillRoadBand(x - 0.5, true);
    }
    for (let y = ARTERIAL_EVERY; y < this.gridHeight; y += ARTERIAL_EVERY) {
      this.fillRoadBand(y - 0.5, false);
    }

    // Kerb ring, then the plot inside it.
    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const centre = cellToScreen(x, y);
        this.groundGfx.fillStyle(KERB, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, PLOT_INSET);
        this.groundGfx.fillStyle(GROUND, 1);
        this.fillDiamond(this.groundGfx, centre.x, centre.y, PLOT_INSET + 2);
      }
    }

    // Lane markings down the middle of each arterial. Drawn last so they stay crisp,
    // and as one dashed run per road rather than per tile.
    this.groundGfx.lineStyle(1.5, LANE_MARK, 0.8);
    for (let x = ARTERIAL_EVERY; x < this.gridWidth; x += ARTERIAL_EVERY) {
      dashedLine(
        this.groundGfx,
        cellToScreen(x - 0.5, -0.5),
        cellToScreen(x - 0.5, this.gridHeight - 0.5),
        13,
        11,
      );
    }
    for (let y = ARTERIAL_EVERY; y < this.gridHeight; y += ARTERIAL_EVERY) {
      dashedLine(
        this.groundGfx,
        cellToScreen(-0.5, y - 0.5),
        cellToScreen(this.gridWidth - 0.5, y - 0.5),
        13,
        11,
      );
    }

    // Outer silhouette.
    this.groundGfx.lineStyle(3, OUTLINE, 0.35);
    this.groundGfx.strokePoints(perimeter, true);
  }

  /**
   * A full-length band half a cell either side of one grid line, used for arterials.
   * Deliberately wider than the street channel - the plots drawn over it trim it back
   * to the channel, which keeps the geometry here trivial.
   */
  private fillRoadBand(at: number, vertical: boolean): void {
    const far = vertical ? this.gridHeight - 0.5 : this.gridWidth - 0.5;
    const corner = (offset: number, along: number) =>
      vertical ? cellToScreen(at + offset, along) : cellToScreen(along, at + offset);

    const a = corner(-0.5, -0.5);
    const b = corner(0.5, -0.5);
    const c = corner(0.5, far);
    const d = corner(-0.5, far);
    this.groundGfx.fillPoints(
      [v(a.x, a.y), v(b.x, b.y), v(c.x, c.y), v(d.x, d.y)],
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
    const profile = buildingProfile(
      block.typeId,
      block.x,
      block.y,
      this.housingDensity(block.x, block.y),
    );
    // Housing drifts a touch warmer or cooler per cell, so a street of white houses
    // reads as many buildings rather than one flat cutout - see props.ts's `tint`.
    const base =
      profile.tint !== undefined
        ? nudge(toPhaserColor(blockColor(block.typeId)), profile.tint)
        : toPhaserColor(blockColor(block.typeId));

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
        // Left at full alpha here on purpose - the pulse tween below animates the
        // container's own alpha instead, so it can reach true full contrast at its
        // peak rather than a baked-in dim value multiplying the range down further.
        break;
      case 'invalid':
        color = BAD;
        glow = BAD;
        break;
      default:
        break;
    }

    // Access mode's route trace: everything except the home and the destination
    // recedes to half opacity, so those two read at full contrast against the rest.
    if (this.routeTrace && !this.routeTrace.endpoints.has(block.id)) {
      alpha *= 0.5;
    }

    const gfx = this.add.graphics();
    const height = profile.floors * FLOOR_HEIGHT;

    if (glow !== null) {
      gfx.fillStyle(glow, 0.16);
      this.fillDiamond(gfx, 0, 0, PLOT_INSET + 1);
    }

    if (profile.floors === 0) {
      this.paintParkland(gfx, block, alpha);
    } else if (block.typeId === 'transport') {
      this.paintTransportHub(gfx, color, alpha, block.x * 73 + block.y * 149, false);
    } else {
      this.paintBuilding(gfx, {
        color,
        floors: profile.floors,
        windowCols: profile.windowCols,
        roof: profile.roof,
        roofStyle: profile.roofStyle,
        footprintInset: profile.footprintInset,
        glass: profile.glass,
        seed: block.x * 73 + block.y * 149,
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

    // A dimmed block is only ever a proposal's removal or move-away (see
    // applyPreviewDimming) - pulsing it the same way the ghost preview pulses reads as
    // "this is what's changing" rather than a flat, easy-to-miss fade.
    if (state === 'dimmed') {
      this.tweens.add({
        targets: node,
        alpha: { from: 1, to: 0.4 },
        duration: 700,
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
    const inset = BUILDING_INSET + (style.footprintInset ?? 0);
    const halfW = TILE_WIDTH / 2 - inset;
    const halfH = TILE_HEIGHT / 2 - inset / 2;
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

    this.paintRoof(gfx, style, inset, height, front);

    // Cartoon silhouette.
    gfx.lineStyle(1.6, OUTLINE, 0.55 * style.alpha);
    gfx.lineBetween(left.x, left.y, left.x, left.y - height);
    gfx.lineBetween(right.x, right.y, right.x, right.y - height);
    gfx.lineBetween(front.x, front.y, front.x, front.y - height);
    gfx.strokePoints([v(left.x, left.y), v(front.x, front.y), v(right.x, right.y)], false);
  }

  /**
   * A flat roof, the way the reference isometric city maps draw one: a parapet rim
   * around the edge with the deck recessed inside it, some mechanical clutter, and
   * then the accessory that identifies the service - a hospital's helipad cross, a
   * school flag, a hub's dome, a broadcast mast, workshop skylights, a museum's
   * raised attic. The old plain lid is what made every building read as a box.
   *
   * `front` is the wall corner `paintBuilding` already computed, so anything drawn
   * against the facade (heritage's columns) lines up with the footprint beneath it.
   */
  private paintRoof(
    gfx: Phaser.GameObjects.Graphics,
    style: BuildingStyle,
    inset: number,
    height: number,
    front: { x: number; y: number },
  ): void {
    const alpha = style.alpha;
    const roofStyle = style.roofStyle ?? 'plain';
    const deckY = -height + DECK_DROP;
    const deckInset = inset + PARAPET_W;

    // Parapet rim first, then the deck recessed inside and slightly below it. That
    // offset alone is what reads as a low wall around a flat roof.
    gfx.fillStyle(tint(style.color, 0.3), alpha);
    this.fillDiamond(gfx, 0, -height, inset);
    gfx.fillStyle(
      style.roof === 'light' ? tint(style.color, 0.1) : shade(style.color, 0.84),
      alpha,
    );
    this.fillDiamond(gfx, 0, deckY, deckInset);

    gfx.lineStyle(1.6, OUTLINE, 0.55 * alpha);
    this.strokeDiamond(gfx, 0, -height, inset);

    if (!style.flat) this.paintRoofClutter(gfx, deckY, deckInset, style);

    switch (roofStyle) {
      case 'cross': {
        // A helipad marking, not the wall colour - reads instantly as a hospital.
        gfx.fillStyle(ROOF_WHITE, alpha);
        gfx.fillCircle(0, deckY, 8);
        gfx.lineStyle(1, OUTLINE, 0.35 * alpha);
        gfx.strokeCircle(0, deckY, 8);
        gfx.fillStyle(ROOF_RED, alpha);
        gfx.fillRect(-1.6, deckY - 5, 3.2, 10);
        gfx.fillRect(-5, deckY - 1.6, 10, 3.2);
        break;
      }
      case 'flagpole': {
        const poleTop = deckY - 20;
        gfx.lineStyle(1.6, METAL, alpha);
        gfx.lineBetween(7, deckY, 7, poleTop);
        gfx.fillStyle(FLAG_RED, alpha);
        gfx.fillPoints([v(7, poleTop), v(7, poleTop + 6), v(15, poleTop + 3)], true);
        break;
      }
      case 'dome': {
        gfx.fillStyle(tint(style.color, 0.35), alpha);
        gfx.fillEllipse(0, deckY - 5, 20, 13);
        gfx.fillStyle(tint(style.color, 0.55), alpha * 0.9);
        gfx.fillEllipse(-3, deckY - 8, 9, 6);
        gfx.lineStyle(1.2, OUTLINE, 0.4 * alpha);
        gfx.strokeEllipse(0, deckY - 5, 20, 13);
        break;
      }
      case 'antenna': {
        const mastTop = deckY - 24;
        gfx.lineStyle(1.6, METAL, alpha);
        gfx.lineBetween(0, deckY - 2, 0, mastTop);
        gfx.lineBetween(-5, mastTop + 8, 5, mastTop + 8);
        gfx.lineBetween(-3, mastTop + 14, 3, mastTop + 14);
        gfx.fillStyle(FLAG_RED, alpha);
        gfx.fillCircle(0, mastTop, 2.6);
        break;
      }
      case 'skylight': {
        // Two glazed lanterns - a workshop lit from above, not another flat lid.
        for (const offset of [-8, 8]) {
          this.paintRoofBox(gfx, offset, deckY + offset * 0.14, 7, 3.4, 5, WINDOW_GLASS, alpha);
        }
        break;
      }
      case 'pediment': {
        // A raised attic storey with columns down the facade - the museum look,
        // built from real massing rather than a triangle pasted on the deck.
        this.paintRoofBox(gfx, 0, deckY, 15, 7.5, 8, tint(style.color, 0.24), alpha);
        gfx.lineStyle(1.6, ROOF_WHITE, 0.75 * alpha);
        for (const offset of [-6, 0, 6]) {
          gfx.lineBetween(front.x + offset, front.y - 2, front.x + offset, front.y - height + 4);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * A small isometric box standing on a roof deck - plant rooms, lift overruns,
   * skylights. Drawn as three faces so it keeps the same light direction as the
   * building under it.
   */
  private paintRoofBox(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    halfW: number,
    halfH: number,
    boxHeight: number,
    color: number,
    alpha: number,
  ): void {
    const top = cy - boxHeight;

    gfx.fillStyle(shade(color, 0.72), alpha);
    gfx.fillPoints(
      [v(cx - halfW, cy), v(cx, cy + halfH), v(cx, top + halfH), v(cx - halfW, top)],
      true,
    );
    gfx.fillStyle(shade(color, 0.55), alpha);
    gfx.fillPoints(
      [v(cx, cy + halfH), v(cx + halfW, cy), v(cx + halfW, top), v(cx, top + halfH)],
      true,
    );
    gfx.fillStyle(color, alpha);
    gfx.fillPoints(
      [v(cx, top - halfH), v(cx + halfW, top), v(cx, top + halfH), v(cx - halfW, top)],
      true,
    );
  }

  /**
   * Plant rooms and the occasional planted roof. Deterministic per cell, so a roof
   * does not reshuffle on redraw, and skipped on single-storey buildings - a
   * cottage with an air handler on it looks wrong, and it keeps the draw cost down
   * on the dense end of the grid.
   */
  private paintRoofClutter(
    gfx: Phaser.GameObjects.Graphics,
    deckY: number,
    deckInset: number,
    style: BuildingStyle,
  ): void {
    const seed = style.seed ?? 0;
    const roll = hash2(seed, 7, 3);

    if (roll > 0.82) {
      // A planted roof. The reference maps use these to break up a white skyline.
      gfx.fillStyle(ROOF_GARDEN, 0.85 * style.alpha);
      this.fillDiamond(gfx, 0, deckY, deckInset + 5);
      return;
    }

    if (style.floors < 2) return;

    const units = roll > 0.55 ? 2 : 1;
    for (let unit = 0; unit < units; unit += 1) {
      const offsetX = (hash2(seed, unit, 11) - 0.5) * 17;
      const offsetY = (hash2(seed, unit, 13) - 0.5) * 7;
      this.paintRoofBox(
        gfx,
        offsetX,
        deckY + offsetY,
        5,
        2.5,
        4 + hash2(seed, unit, 17) * 3,
        ROOF_UNIT,
        style.alpha,
      );
    }
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
        const litColor = style.glass ? WINDOW_GLASS : WINDOW_LIT;

        gfx.fillStyle(lit ? litColor : WINDOW, (lit ? 0.95 : 0.8) * style.alpha);
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

  /**
   * Transport is a concourse building with an entrance awning, not a canopy on
   * posts. A wide canopy is the honest shape for a bus stop, but from this camera
   * angle its roof covers everything under it, so it read as a plate laid over the
   * tile. Building the mass first and hanging a small awning off the facade keeps
   * the station legible as a building while still saying "you catch things here".
   */
  private paintTransportHub(
    gfx: Phaser.GameObjects.Graphics,
    color: number,
    alpha: number,
    seed: number,
    flat: boolean,
  ): void {
    this.paintBuilding(gfx, {
      color,
      floors: 2,
      windowCols: 4,
      roof: 'dark',
      roofStyle: 'plain',
      glass: true,
      seed,
      alpha,
      flat,
    });

    const halfW = TILE_WIDTH / 2 - BUILDING_INSET;
    const halfH = TILE_HEIGHT / 2 - BUILDING_INSET / 2;
    const left = { x: -halfW, y: 0 };
    const front = { x: 0, y: halfH };
    const right = { x: halfW, y: 0 };

    // Awning slab, projecting out over the pavement along both visible facades.
    const awningY = -15;
    const outX = 8;
    const outY = 4;
    const fascia = 3;

    const leftOuter = { x: left.x - outX, y: left.y + outY + awningY };
    const frontLeftOuter = { x: front.x - outX, y: front.y + outY + awningY };
    const frontRightOuter = { x: front.x + outX, y: front.y + outY + awningY };
    const rightOuter = { x: right.x + outX, y: right.y + outY + awningY };

    // Undersides first, so the top surfaces overlap them cleanly.
    gfx.fillStyle(shade(color, 0.5), alpha);
    gfx.fillPoints(
      [
        v(leftOuter.x, leftOuter.y),
        v(frontLeftOuter.x, frontLeftOuter.y),
        v(frontLeftOuter.x, frontLeftOuter.y + fascia),
        v(leftOuter.x, leftOuter.y + fascia),
      ],
      true,
    );
    gfx.fillStyle(shade(color, 0.4), alpha);
    gfx.fillPoints(
      [
        v(frontRightOuter.x, frontRightOuter.y),
        v(rightOuter.x, rightOuter.y),
        v(rightOuter.x, rightOuter.y + fascia),
        v(frontRightOuter.x, frontRightOuter.y + fascia),
      ],
      true,
    );

    gfx.fillStyle(tint(color, 0.18), alpha);
    gfx.fillPoints(
      [
        v(left.x, left.y + awningY),
        v(front.x, front.y + awningY),
        v(frontLeftOuter.x, frontLeftOuter.y),
        v(leftOuter.x, leftOuter.y),
      ],
      true,
    );
    gfx.fillStyle(tint(color, 0.3), alpha);
    gfx.fillPoints(
      [
        v(front.x, front.y + awningY),
        v(right.x, right.y + awningY),
        v(rightOuter.x, rightOuter.y),
        v(frontRightOuter.x, frontRightOuter.y),
      ],
      true,
    );

    // Honey band along the leading edge, like a route sign.
    gfx.lineStyle(2, HONEY, 0.9 * alpha);
    gfx.lineBetween(leftOuter.x, leftOuter.y + fascia, frontLeftOuter.x, frontLeftOuter.y + fascia);
    gfx.lineBetween(
      frontRightOuter.x,
      frontRightOuter.y + fascia,
      rightOuter.x,
      rightOuter.y + fascia,
    );

    gfx.lineStyle(1.2, OUTLINE, 0.4 * alpha);
    gfx.strokePoints(
      [
        v(leftOuter.x, leftOuter.y),
        v(frontLeftOuter.x, frontLeftOuter.y),
        v(frontRightOuter.x, frontRightOuter.y),
        v(rightOuter.x, rightOuter.y),
      ],
      false,
    );

    // Slender props under the awning corners, and a stop pylon on the kerb.
    gfx.lineStyle(1.6, METAL, 0.9 * alpha);
    gfx.lineBetween(leftOuter.x, leftOuter.y + fascia, leftOuter.x, left.y + outY);
    gfx.lineBetween(rightOuter.x, rightOuter.y + fascia, rightOuter.x, right.y + outY);

    const pylonX = right.x + outX + 5;
    const pylonBase = right.y + outY + 4;
    gfx.lineStyle(1.6, METAL, alpha);
    gfx.lineBetween(pylonX, pylonBase, pylonX, pylonBase - 17);
    gfx.fillStyle(color, alpha);
    gfx.fillRect(pylonX - 3.5, pylonBase - 24, 7, 8);
    gfx.lineStyle(1, OUTLINE, 0.4 * alpha);
    gfx.strokeRect(pylonX - 3.5, pylonBase - 24, 7, 8);
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
    if (this.ghost.typeId === 'transport') {
      this.paintTransportHub(this.ghostGfx, color, 0.55, 0, true);
    } else {
      this.paintBuilding(this.ghostGfx, {
        color,
        floors: Math.max(profile.floors, 1),
        windowCols: profile.windowCols || 3,
        roof: profile.roof,
        roofStyle: profile.roofStyle,
        footprintInset: profile.footprintInset,
        glass: profile.glass,
        alpha: 0.55,
        flat: true,
      });
    }
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
      // Full alpha here, not a baked-in translucency - startPreviewPulse() tweens the
      // whole previewGfx object's alpha, and a value baked in here would cap how far
      // that pulse can ever reach instead of letting it hit true full contrast.
      if (typeId === 'transport') {
        this.paintTransportHub(this.previewGfx, color, 1, 0, true);
      } else {
        this.paintBuilding(this.previewGfx, {
          color,
          floors: Math.max(profile.floors, 1),
          windowCols: profile.windowCols || 3,
          roof: profile.roof,
          roofStyle: profile.roofStyle,
          footprintInset: profile.footprintInset,
          glass: profile.glass,
          alpha: 1,
          flat: true,
        });
      }
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

  /** Current camera zoom. 1 before the scene is ready. */
  getZoom(): number {
    return this.ready ? this.cameras.main.zoom : 1;
  }

  /** Multiply the current zoom, keeping the viewport centred. What a zoom button does. */
  zoomBy(factor: number): void {
    if (this.ready) this.zoomTo(this.cameras.main.zoom * factor);
  }

  /**
   * Zoom to an absolute level, keeping `screenPoint` (canvas pixels, defaults to the
   * viewport centre) pinned to the same place on screen - otherwise zooming walks the
   * city out from under the cursor.
   */
  private zoomTo(zoom: number, screenPoint?: { x: number; y: number }): void {
    const camera = this.cameras.main;
    const next = Phaser.Math.Clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    if (next === camera.zoom) return;

    const point = screenPoint ?? { x: camera.width / 2, y: camera.height / 2 };
    const before = camera.getWorldPoint(point.x, point.y);
    camera.setZoom(next);
    const after = camera.getWorldPoint(point.x, point.y);
    camera.setScroll(camera.scrollX + (before.x - after.x), camera.scrollY + (before.y - after.y));
    this.callbacks.onZoomChange?.(next);
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
