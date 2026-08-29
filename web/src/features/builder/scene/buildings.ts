import Phaser from 'phaser';
import {
  FLOOR_HEIGHT,
  TILE_HEIGHT,
  TILE_WIDTH,
  nudge,
  shade,
  tint,
} from './isometric';
import { drawBench, drawBush, drawPerson, drawTree, hash2 } from './props';

/**
 * The procedural building renderer.
 *
 * Every placed block is painted here, in the local space of its cell's container
 * (origin at the cell centre on the ground plane), from a small kit of isometric
 * primitives - `mass` (an extruded box anywhere on the plot), roof shapes, facade
 * patterns - composed into per-type ARCHETYPES. The goal is an illustrated vector
 * city map: the silhouette identifies the building first, the windows are an
 * accent, and the colours stay inside a restrained material palette.
 *
 * Everything is deterministic per cell (hash2), so the map never reshuffles on a
 * redraw, and every colour goes through `ctx.mod` so the simulation's visual
 * states (flooded, offline, invalid, highlighted) recolour whole buildings the
 * way the old single-colour renderer did.
 */

type Gfx = Phaser.GameObjects.Graphics;

interface Pt {
  x: number;
  y: number;
}

const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

const HW = TILE_WIDTH / 2; // 38
const HH = TILE_HEIGHT / 2; // 19

/** Grid-fraction offset from the cell centre to screen px. 1.0 = one full tile. */
const gp = (gx: number, gy: number): Pt => ({ x: (gx - gy) * HW, y: (gx + gy) * HH });

/** Point on a wall face: u along the base edge a->b, `lift` px above it. */
const fp = (a: Pt, b: Pt, u: number, lift: number): Pt => ({
  x: a.x + (b.x - a.x) * u,
  y: a.y + (b.y - a.y) * u - lift,
});

const quadPts = (a: Pt, b: Pt, u0: number, u1: number, y0: number, y1: number) => [
  v(fp(a, b, u0, y0).x, fp(a, b, u0, y0).y),
  v(fp(a, b, u1, y0).x, fp(a, b, u1, y0).y),
  v(fp(a, b, u1, y1).x, fp(a, b, u1, y1).y),
  v(fp(a, b, u0, y1).x, fp(a, b, u0, y1).y),
];

/** Unit normal of a face edge, pointing out of the building (down-screen). */
function outward(a: Pt, b: Pt): Pt {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  let nx = ey / len;
  let ny = -ex / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/* -------------------------------------------------------------------- palette */

const OUTLINE = 0x2a2213;
const WINDOW = 0xbccfdf;
const WINDOW_LIT = 0xffd98a;
const WINDOW_GLASS = 0x8fcbe8;
const DOOR = 0x50493f;
const METAL = 0x8f96a3;
const ROOF_UNIT = 0xb4bfcc;
const ROOF_GARDEN = 0x8ecb9a;
const ROOF_WHITE = 0xfbf8ef;
const SOLAR = 0x3a5578;
const TANK = 0xc9a86a;
const GRASS = 0x9ed49a;
const PATH = 0xf3ecdb;
const POND = 0x8ccfe0;
const COURT = 0xead9b8;

/** Housing roof accents - terracotta, slate, charcoal. */
const HOUSE_ROOFS = [0xd08663, 0x7d8894, 0x5a5f68];

/**
 * Facade materials by district: a coarse neighbourhood hash picks one family so
 * streets feel planned rather than confettied; the per-cell pick + nudge keeps
 * next-door houses from being clones.
 */
const DISTRICT_WALLS: number[][] = [
  [0xfaf1dd, 0xf2e5cc, 0xfdf8ec], // limestone / cream
  [0xe3eaf2, 0xf3f6f9, 0xd6dfe9], // cool grey-blue
  [0xf6dcc4, 0xf0cbaa, 0xfaeadb], // terracotta pastel
  [0xe8efdb, 0xf4f7ec, 0xdde8cf], // sage
];

function housingWall(x: number, y: number): number {
  const family =
    DISTRICT_WALLS[
      Math.floor(hash2(Math.floor(x / 6), Math.floor(y / 6), 97) * DISTRICT_WALLS.length)
    ] ?? DISTRICT_WALLS[0]!;
  const wall = family[Math.floor(hash2(x, y, 53) * family.length)] ?? family[0]!;
  return nudge(wall, (hash2(x, y, 54) - 0.5) * 24);
}

/** Service buildings: near-neutral walls, with the block's brand colour as accent. */
const SERVICE_STYLE: Record<string, { wall: number; accent: number }> = {
  healthcare: { wall: 0xfdfbf5, accent: 0xdd4b58 },
  education: { wall: 0xf3e9d6, accent: 0x6070e0 },
  transport: { wall: 0xe9eef3, accent: 0x1f88bd },
  community_hub: { wall: 0xf5ecd9, accent: 0xc78a1f },
  technology_hub: { wall: 0xe7ebf1, accent: 0x8858d4 },
  shared_resource_hub: { wall: 0xefeadd, accent: 0x1a9e8f },
  culture_heritage: { wall: 0xf1e5cc, accent: 0xc94488 },
};

/* ------------------------------------------------------------------- context */

export interface BlockPaintCtx {
  /** Stable per-cell seed (x * 73 + y * 149 works); 0 for the drag ghost. */
  seed: number;
  /** Local housing density 0..1 - picks the housing archetype. */
  density: number;
  alpha: number;
  /** Ghost/preview: unlit windows, no clutter, no street life. */
  flat?: boolean;
  /** State recolour (flooded, offline, invalid...) applied to every fill. */
  mod: (c: number) => number;
  cellX?: number;
  cellY?: number;
  /**
   * Grid-adjacent cells that are also a transport block, as (dx, dy) offsets - drives
   * the transport archetype's road-vs-station choice. Empty/absent everywhere else.
   */
  transportLinks?: Array<{ dx: number; dy: number }>;
}

const F = (gfx: Gfx, ctx: BlockPaintCtx, color: number, alphaMul = 1) =>
  gfx.fillStyle(ctx.mod(color), ctx.alpha * alphaMul);
const L = (gfx: Gfx, ctx: BlockPaintCtx, width: number, color: number, alphaMul = 1) =>
  gfx.lineStyle(width, ctx.mod(color), ctx.alpha * alphaMul);

/* ---------------------------------------------------------------- primitives */

interface MassSpec {
  gx?: number;
  gy?: number;
  hx: number;
  hy: number;
  /** Elevation of the base above the ground plane, px. */
  z?: number;
  /** Height of the mass, px. */
  h: number;
  wall: number;
  /** Skip the top diamond (a roof shape will cover it). */
  openTop?: boolean;
  /** Skip the cartoon outline (inner masses of a composite). */
  noOutline?: boolean;
}

interface MassGeom {
  /** Base corners at elevation z: A top, B right, C bottom, D left. */
  A: Pt;
  B: Pt;
  C: Pt;
  D: Pt;
  gx: number;
  gy: number;
  hx: number;
  hy: number;
  z: number;
  h: number;
  wall: number;
}

const raise = (p: Pt, dz: number): Pt => ({ x: p.x, y: p.y - dz });

/**
 * One extruded isometric box: two shaded wall faces and a lid. The workhorse -
 * every building is one or more of these, decorated. Returns its geometry so
 * facades and roofs can be drawn against the same corners.
 */
function mass(gfx: Gfx, ctx: BlockPaintCtx, spec: MassSpec): MassGeom {
  const { gx = 0, gy = 0, hx, hy, z = 0, h, wall } = spec;
  const A = raise(gp(gx - hx, gy - hy), z);
  const B = raise(gp(gx + hx, gy - hy), z);
  const C = raise(gp(gx + hx, gy + hy), z);
  const D = raise(gp(gx - hx, gy + hy), z);

  // Left-front face (D->C), lit; right-front face (C->B), in shadow.
  F(gfx, ctx, shade(wall, 0.9));
  gfx.fillPoints([v(D.x, D.y), v(C.x, C.y), v(C.x, C.y - h), v(D.x, D.y - h)], true);
  F(gfx, ctx, shade(wall, 0.7));
  gfx.fillPoints([v(C.x, C.y), v(B.x, B.y), v(B.x, B.y - h), v(C.x, C.y - h)], true);

  if (!spec.openTop) {
    F(gfx, ctx, tint(wall, 0.28));
    gfx.fillPoints(
      [v(A.x, A.y - h), v(B.x, B.y - h), v(C.x, C.y - h), v(D.x, D.y - h)],
      true,
    );
  }

  if (!spec.noOutline) {
    L(gfx, ctx, 1.4, OUTLINE, 0.5);
    gfx.lineBetween(D.x, D.y, D.x, D.y - h);
    gfx.lineBetween(C.x, C.y, C.x, C.y - h);
    gfx.lineBetween(B.x, B.y, B.x, B.y - h);
    gfx.strokePoints([v(D.x, D.y), v(C.x, C.y), v(B.x, B.y)], false);
    gfx.strokePoints(
      [v(A.x, A.y - h), v(B.x, B.y - h), v(C.x, C.y - h), v(D.x, D.y - h)],
      true,
    );
  }

  return { A, B, C, D, gx, gy, hx, hy, z, h, wall };
}

/** Soft contact shadow under the whole building - keeps it from floating. */
function contactShadow(gfx: Gfx, ctx: BlockPaintCtx, hx: number, hy: number): void {
  gfx.fillStyle(0x000000, 0.09 * ctx.alpha);
  gfx.fillEllipse(1, hy * TILE_HEIGHT * 0.6, (hx + hy) * TILE_WIDTH * 1.05, (hx + hy) * TILE_HEIGHT * 0.8);
}

function fillDiamondAt(
  gfx: Gfx,
  gx: number,
  gy: number,
  hx: number,
  hy: number,
  z: number,
): void {
  const A = raise(gp(gx - hx, gy - hy), z);
  const B = raise(gp(gx + hx, gy - hy), z);
  const C = raise(gp(gx + hx, gy + hy), z);
  const D = raise(gp(gx - hx, gy + hy), z);
  gfx.fillPoints([v(A.x, A.y), v(B.x, B.y), v(C.x, C.y), v(D.x, D.y)], true);
}

/** Parapet rim + recessed deck - the flat-roof treatment for urban archetypes. */
function parapetRoof(gfx: Gfx, ctx: BlockPaintCtx, m: MassGeom, deck?: number): void {
  const pw = 4.5 / TILE_WIDTH;
  const top = m.z + m.h;
  F(gfx, ctx, tint(m.wall, 0.42));
  fillDiamondAt(gfx, m.gx, m.gy, m.hx, m.hy, top);
  F(gfx, ctx, deck ?? shade(m.wall, 0.93));
  fillDiamondAt(gfx, m.gx, m.gy, m.hx - pw, m.hy - pw, top - 2.5);
  L(gfx, ctx, 1.4, OUTLINE, 0.5);
  const A = raise(gp(m.gx - m.hx, m.gy - m.hy), top);
  const B = raise(gp(m.gx + m.hx, m.gy - m.hy), top);
  const C = raise(gp(m.gx + m.hx, m.gy + m.hy), top);
  const D = raise(gp(m.gx - m.hx, m.gy + m.hy), top);
  gfx.strokePoints([v(A.x, A.y), v(B.x, B.y), v(C.x, C.y), v(D.x, D.y)], true);
}

/**
 * A pitched gable roof with a ridge along `axis`. Fills all four corners - the
 * back slope, the visible gable-end triangle and the front slope - which is the
 * bug the first pitched-roof attempt shipped (see docs/NEXT-SESSION.md).
 */
function gableRoof(
  gfx: Gfx,
  ctx: BlockPaintCtx,
  m: MassGeom,
  axis: 'x' | 'y',
  rise: number,
  roof: number,
): void {
  const og = 2.5 / TILE_WIDTH; // eave overhang
  const zb = m.z + m.h - 1;
  const hx = m.hx + og;
  const hy = m.hy + og;
  const A = raise(gp(m.gx - hx, m.gy - hy), zb);
  const B = raise(gp(m.gx + hx, m.gy - hy), zb);
  const C = raise(gp(m.gx + hx, m.gy + hy), zb);
  const D = raise(gp(m.gx - hx, m.gy + hy), zb);

  if (axis === 'x') {
    const R1 = raise(gp(m.gx - hx, m.gy), zb + rise);
    const R2 = raise(gp(m.gx + hx, m.gy), zb + rise);
    F(gfx, ctx, shade(roof, 0.8));
    gfx.fillPoints([v(A.x, A.y), v(B.x, B.y), v(R2.x, R2.y), v(R1.x, R1.y)], true);
    F(gfx, ctx, shade(m.wall, 0.72));
    gfx.fillPoints([v(B.x, B.y), v(C.x, C.y), v(R2.x, R2.y)], true);
    F(gfx, ctx, tint(roof, 0.08));
    gfx.fillPoints([v(D.x, D.y), v(C.x, C.y), v(R2.x, R2.y), v(R1.x, R1.y)], true);
    L(gfx, ctx, 1.3, OUTLINE, 0.5);
    gfx.strokePoints([v(D.x, D.y), v(R1.x, R1.y), v(R2.x, R2.y), v(C.x, C.y)], false);
    gfx.lineBetween(R2.x, R2.y, B.x, B.y);
  } else {
    const R1 = raise(gp(m.gx, m.gy - hy), zb + rise);
    const R2 = raise(gp(m.gx, m.gy + hy), zb + rise);
    F(gfx, ctx, shade(roof, 0.8));
    gfx.fillPoints([v(A.x, A.y), v(D.x, D.y), v(R2.x, R2.y), v(R1.x, R1.y)], true);
    F(gfx, ctx, shade(m.wall, 0.88));
    gfx.fillPoints([v(D.x, D.y), v(C.x, C.y), v(R2.x, R2.y)], true);
    F(gfx, ctx, tint(roof, 0.08));
    gfx.fillPoints([v(B.x, B.y), v(C.x, C.y), v(R2.x, R2.y), v(R1.x, R1.y)], true);
    L(gfx, ctx, 1.3, OUTLINE, 0.5);
    gfx.strokePoints([v(B.x, B.y), v(R1.x, R1.y), v(R2.x, R2.y), v(C.x, C.y)], false);
    gfx.lineBetween(R2.x, R2.y, D.x, D.y);
  }
}

/** North-light sawtooth roof - the workshop/maker-space silhouette. */
function sawtoothRoof(
  gfx: Gfx,
  ctx: BlockPaintCtx,
  m: MassGeom,
  teeth: number,
  rise: number,
): void {
  const top = m.z + m.h;
  const width = (m.hx * 2) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const x0 = m.gx - m.hx + i * width;
    const x1 = x0 + width;
    const s0 = raise(gp(x0, m.gy - m.hy), top);
    const s1 = raise(gp(x0, m.gy + m.hy), top);
    const t1 = raise(gp(x1, m.gy + m.hy), top + rise);
    const t0 = raise(gp(x1, m.gy - m.hy), top + rise);
    F(gfx, ctx, tint(m.wall, 0.24));
    gfx.fillPoints([v(s0.x, s0.y), v(s1.x, s1.y), v(t1.x, t1.y), v(t0.x, t0.y)], true);
    // The vertical glass face of each tooth, catching the viewer.
    const b0 = raise(gp(x1, m.gy - m.hy), top);
    const b1 = raise(gp(x1, m.gy + m.hy), top);
    F(gfx, ctx, WINDOW_GLASS, 0.95);
    gfx.fillPoints([v(b0.x, b0.y), v(b1.x, b1.y), v(t1.x, t1.y), v(t0.x, t0.y)], true);
    L(gfx, ctx, 1.1, OUTLINE, 0.4);
    gfx.strokePoints([v(s1.x, s1.y), v(t1.x, t1.y), v(t0.x, t0.y)], false);
  }
}

/** Barrel-vault roof approximated with graded strips - the station concourse. */
function vaultRoof(gfx: Gfx, ctx: BlockPaintCtx, m: MassGeom, rise: number, accent: number): void {
  const top = m.z + m.h;
  const steps: Array<[number, number, number, number]> = [
    [-m.hy, -m.hy * 0.45, 0, rise * 0.8],
    [-m.hy * 0.45, 0, rise * 0.8, rise],
    [0, m.hy * 0.45, rise, rise * 0.8],
    [m.hy * 0.45, m.hy, rise * 0.8, 0],
  ];
  steps.forEach(([gy0, gy1, z0, z1], i) => {
    const p0 = raise(gp(m.gx - m.hx, m.gy + gy0), top + z0);
    const p1 = raise(gp(m.gx + m.hx, m.gy + gy0), top + z0);
    const p2 = raise(gp(m.gx + m.hx, m.gy + gy1), top + z1);
    const p3 = raise(gp(m.gx - m.hx, m.gy + gy1), top + z1);
    F(gfx, ctx, tint(m.wall, 0.34 - i * 0.09));
    gfx.fillPoints([v(p0.x, p0.y), v(p1.x, p1.y), v(p2.x, p2.y), v(p3.x, p3.y)], true);
  });
  // Glazed arch on the visible east end.
  const arch = steps.map(([gy0, , z0]) => raise(gp(m.gx + m.hx, m.gy + gy0), top + z0));
  arch.push(raise(gp(m.gx + m.hx, m.gy + m.hy), top));
  F(gfx, ctx, WINDOW_GLASS, 0.9);
  gfx.fillPoints(
    arch.map((p) => v(p.x, p.y)),
    true,
  );
  // Accent rib along the visible arch edge - the station's signature line.
  L(gfx, ctx, 1.6, accent, 0.9);
  const e0 = raise(gp(m.gx + m.hx, m.gy - m.hy), top);
  gfx.strokePoints(
    [v(e0.x, e0.y), ...steps.map(([, gy1, , z1]) => {
      const p = raise(gp(m.gx + m.hx, m.gy + gy1), top + z1);
      return v(p.x, p.y);
    })],
    false,
  );
}

/* --------------------------------------------------------------- facades */

interface WindowOpts {
  /** Chance each pane exists at all - the anti-"repeated box grid" dial. */
  presence?: number;
  lit?: number;
  glass?: boolean;
  salt?: number;
  /** Pane width as a fraction of its column. */
  w?: number;
}

/** Punched/grouped windows. Presence < 1 gives the sparse residential look. */
function gridWindows(
  gfx: Gfx,
  ctx: BlockPaintCtx,
  a: Pt,
  b: Pt,
  h: number,
  floors: number,
  cols: number,
  o: WindowOpts = {},
): void {
  const presence = o.presence ?? 1;
  const litChance = o.lit ?? 0.24;
  const w = o.w ?? 0.5;
  const salt = o.salt ?? 0;
  for (let floor = 0; floor < floors; floor += 1) {
    const y0 = ((floor + 0.3) / floors) * h;
    const y1 = ((floor + 0.74) / floors) * h;
    for (let col = 0; col < cols; col += 1) {
      if (hash2(col * 7 + salt, floor * 3 + 1, ctx.seed) > presence) continue;
      const u0 = (col + (1 - w) / 2) / cols;
      const u1 = (col + (1 + w) / 2) / cols;
      const lit = !ctx.flat && hash2(col + salt, floor, ctx.seed + 5) > 1 - litChance;
      F(gfx, ctx, lit ? (o.glass ? WINDOW_GLASS : WINDOW_LIT) : WINDOW, lit ? 0.95 : 0.8);
      gfx.fillPoints(quadPts(a, b, u0, u1, y0, y1), true);
    }
  }
}

/** Full-height glazing strips - offices, towers, stairwells. */
function stripWindows(
  gfx: Gfx,
  ctx: BlockPaintCtx,
  a: Pt,
  b: Pt,
  h: number,
  strips: number,
  o: { glass?: boolean; w?: number } = {},
): void {
  const w = o.w ?? 0.55;
  for (let i = 0; i < strips; i += 1) {
    const u0 = (i + (1 - w) / 2) / strips;
    const u1 = (i + (1 + w) / 2) / strips;
    F(gfx, ctx, o.glass ? WINDOW_GLASS : WINDOW, 0.88);
    gfx.fillPoints(quadPts(a, b, u0, u1, 3, h - 3), true);
    // Floor lines keep the strip reading as storeys, not a stripe.
    L(gfx, ctx, 1, shade(o.glass ? WINDOW_GLASS : WINDOW, 0.7), 0.7);
    for (let yy = FLOOR_HEIGHT; yy < h - 4; yy += FLOOR_HEIGHT) {
      const p0 = fp(a, b, u0, yy);
      const p1 = fp(a, b, u1, yy);
      gfx.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
  }
}

/** One wide ribbon window per storey - the modernist slab (hospital wings). */
function ribbonWindows(gfx: Gfx, ctx: BlockPaintCtx, a: Pt, b: Pt, h: number, floors: number): void {
  for (let floor = 0; floor < floors; floor += 1) {
    const y0 = ((floor + 0.34) / floors) * h;
    const y1 = ((floor + 0.7) / floors) * h;
    F(gfx, ctx, WINDOW, 0.85);
    gfx.fillPoints(quadPts(a, b, 0.1, 0.9, y0, y1), true);
  }
}

function door(
  gfx: Gfx,
  ctx: BlockPaintCtx,
  a: Pt,
  b: Pt,
  u: number,
  wu: number,
  hpx: number,
  color = DOOR,
): void {
  F(gfx, ctx, color, 0.95);
  gfx.fillPoints(quadPts(a, b, u - wu / 2, u + wu / 2, 0, hpx), true);
}

/** A small sloped awning projecting off a face - entrances, storefronts. */
function awning(
  gfx: Gfx,
  ctx: BlockPaintCtx,
  a: Pt,
  b: Pt,
  u0: number,
  u1: number,
  yTop: number,
  out: number,
  color: number,
): void {
  const n = outward(a, b);
  const p0 = fp(a, b, u0, yTop);
  const p1 = fp(a, b, u1, yTop);
  const q1 = { x: p1.x + n.x * out, y: p1.y + n.y * out + 2 };
  const q0 = { x: p0.x + n.x * out, y: p0.y + n.y * out + 2 };
  F(gfx, ctx, color, 0.95);
  gfx.fillPoints([v(p0.x, p0.y), v(p1.x, p1.y), v(q1.x, q1.y), v(q0.x, q0.y)], true);
  L(gfx, ctx, 1, OUTLINE, 0.35);
  gfx.strokePoints([v(q0.x, q0.y), v(q1.x, q1.y)], false);
}

/** Balcony slabs with a railing, one per storey - the mid-rise apartment look. */
function balconyRow(
  gfx: Gfx,
  ctx: BlockPaintCtx,
  a: Pt,
  b: Pt,
  h: number,
  floors: number,
  wall: number,
): void {
  const n = outward(a, b);
  for (let floor = 1; floor < floors; floor += 1) {
    const y = (floor / floors) * h + 1;
    const p0 = fp(a, b, 0.2, y);
    const p1 = fp(a, b, 0.8, y);
    const q0 = { x: p0.x + n.x * 4, y: p0.y + n.y * 4 };
    const q1 = { x: p1.x + n.x * 4, y: p1.y + n.y * 4 };
    // Door pane behind the balcony.
    F(gfx, ctx, WINDOW, 0.8);
    gfx.fillPoints(quadPts(a, b, 0.3, 0.7, y, y + h / floors - 4), true);
    F(gfx, ctx, tint(wall, 0.35), 0.95);
    gfx.fillPoints([v(p0.x, p0.y), v(p1.x, p1.y), v(q1.x, q1.y), v(q0.x, q0.y)], true);
    L(gfx, ctx, 1, shade(wall, 0.5), 0.8);
    gfx.lineBetween(q0.x, q0.y, q1.x, q1.y);
    gfx.lineBetween(q0.x, q0.y, q0.x, q0.y - 3);
    gfx.lineBetween(q1.x, q1.y, q1.x, q1.y - 3);
  }
}

/* ---------------------------------------------------------- rooftop props */

function acUnit(gfx: Gfx, ctx: BlockPaintCtx, gx: number, gy: number, z: number, s = 1): void {
  const hx = 0.06 * s;
  const hy = 0.05 * s;
  mass(gfx, ctx, { gx, gy, hx, hy, z, h: 4 * s, wall: ROOF_UNIT, noOutline: true });
}

function waterTank(gfx: Gfx, ctx: BlockPaintCtx, x: number, z: number): void {
  const top = -z;
  L(gfx, ctx, 1.2, METAL, 0.9);
  gfx.lineBetween(x - 3, top, x - 3, top - 4);
  gfx.lineBetween(x + 3, top, x + 3, top - 4);
  F(gfx, ctx, shade(TANK, 0.85));
  gfx.fillRect(x - 4.5, top - 12, 9, 8);
  F(gfx, ctx, tint(TANK, 0.2));
  gfx.fillEllipse(x, top - 12, 9, 4);
  L(gfx, ctx, 1, OUTLINE, 0.35);
  gfx.strokeEllipse(x, top - 12, 9, 4);
}

function solarPanels(gfx: Gfx, ctx: BlockPaintCtx, gx: number, gy: number, z: number): void {
  for (const off of [-0.07, 0.05]) {
    const p0 = raise(gp(gx + off - 0.05, gy - 0.08), z);
    const p1 = raise(gp(gx + off - 0.05, gy + 0.08), z);
    const p2 = raise(gp(gx + off + 0.05, gy + 0.08), z + 3);
    const p3 = raise(gp(gx + off + 0.05, gy - 0.08), z + 3);
    F(gfx, ctx, SOLAR, 0.95);
    gfx.fillPoints([v(p0.x, p0.y), v(p1.x, p1.y), v(p2.x, p2.y), v(p3.x, p3.y)], true);
    L(gfx, ctx, 0.8, tint(SOLAR, 0.5), 0.8);
    gfx.strokePoints([v(p0.x, p0.y), v(p1.x, p1.y), v(p2.x, p2.y), v(p3.x, p3.y)], true);
  }
}

/** Deterministic light clutter for flat urban roofs; skipped when `flat`. */
function roofClutter(gfx: Gfx, ctx: BlockPaintCtx, m: MassGeom): void {
  if (ctx.flat) return;
  const roll = hash2(ctx.seed, 7, 3);
  const top = m.z + m.h;
  if (roll > 0.8) {
    F(gfx, ctx, ROOF_GARDEN, 0.9);
    fillDiamondAt(gfx, m.gx, m.gy, m.hx - 0.075, m.hy - 0.075, top - 2);
    return;
  }
  if (roll > 0.55) acUnit(gfx, ctx, m.gx - 0.05, m.gy - 0.04, top - 2);
  if (roll > 0.3) acUnit(gfx, ctx, m.gx + 0.06, m.gy + 0.03, top - 2, 0.8);
}

/* ------------------------------------------------------------------ housing */

type HousingPainter = (gfx: Gfx, ctx: BlockPaintCtx, wall: number) => number;

function paintCottage(gfx: Gfx, ctx: BlockPaintCtx, wall: number): number {
  const axis: 'x' | 'y' = hash2(ctx.seed, 1, 21) > 0.5 ? 'x' : 'y';
  const roof = HOUSE_ROOFS[Math.floor(hash2(ctx.seed, 2, 22) * HOUSE_ROOFS.length)] ?? HOUSE_ROOFS[0]!;
  contactShadow(gfx, ctx, 0.2, 0.18);
  const m = mass(gfx, ctx, { hx: 0.17, hy: 0.15, h: 11, wall, openTop: true });
  gableRoof(gfx, ctx, m, axis, 8, roof);
  door(gfx, ctx, m.D, m.C, 0.32, 0.16, 7);
  gridWindows(gfx, ctx, m.D, m.C, m.h, 1, 2, { presence: 0.65, salt: 3 });
  gridWindows(gfx, ctx, m.C, m.B, m.h, 1, 2, { presence: 0.5, salt: 9 });
  if (!ctx.flat) drawBush(gfx, -14, 8, ctx.seed + 31);
  return 19;
}

function paintHouse(gfx: Gfx, ctx: BlockPaintCtx, wall: number): number {
  const roof = HOUSE_ROOFS[Math.floor(hash2(ctx.seed, 2, 23) * HOUSE_ROOFS.length)] ?? HOUSE_ROOFS[1]!;
  contactShadow(gfx, ctx, 0.24, 0.2);
  const m = mass(gfx, ctx, { gx: -0.04, hx: 0.19, hy: 0.15, h: 14, wall, openTop: true });
  gableRoof(gfx, ctx, m, 'x', 9, roof);
  // Garage wing out front - the suburban silhouette.
  const g = mass(gfx, ctx, { gx: 0.16, gy: 0.16, hx: 0.09, hy: 0.09, h: 8, wall: nudge(wall, -10) });
  F(gfx, ctx, shade(wall, 0.45), 0.9);
  gfx.fillPoints(quadPts(g.D, g.C, 0.2, 0.8, 0, 6), true);
  door(gfx, ctx, m.D, m.C, 0.6, 0.14, 8);
  gridWindows(gfx, ctx, m.D, m.C, m.h, 1, 3, { presence: 0.6, salt: 5 });
  gridWindows(gfx, ctx, m.C, m.B, m.h, 1, 2, { presence: 0.55, salt: 11 });
  if (!ctx.flat) drawTree(gfx, -20, 6, ctx.seed + 7);
  return 23;
}

function paintRowhouses(gfx: Gfx, ctx: BlockPaintCtx, wall: number): number {
  contactShadow(gfx, ctx, 0.3, 0.2);
  const segs = 3;
  let peak = 0;
  for (let i = 0; i < segs; i += 1) {
    const gx = -0.19 + i * 0.19;
    const h = 20 + Math.round(hash2(ctx.seed, i, 25) * 8) - 3;
    peak = Math.max(peak, h);
    const segWall = nudge(wall, (hash2(ctx.seed, i, 26) - 0.5) * 36);
    const m = mass(gfx, ctx, { gx, hx: 0.095, hy: 0.19, h, wall: segWall, noOutline: i > 0 });
    // Slim parapet cap per segment.
    F(gfx, ctx, shade(segWall, 0.68));
    fillDiamondAt(gfx, gx, 0, 0.095, 0.19, h);
    F(gfx, ctx, tint(segWall, 0.24));
    fillDiamondAt(gfx, gx, 0, 0.075, 0.17, h - 1.5);
    door(gfx, ctx, m.D, m.C, 0.5, 0.3, 7);
    gridWindows(gfx, ctx, m.D, m.C, h - 8, 1, 1, { presence: 0.85, salt: i * 13 });
    gridWindows(gfx, ctx, m.C, m.B, h, 2, 1, { presence: 0.6, salt: i * 17 + 4 });
  }
  L(gfx, ctx, 1.4, OUTLINE, 0.5);
  const d = gp(-0.285, 0.19);
  const c = gp(0.285, 0.19);
  gfx.strokePoints([v(d.x, d.y), v(c.x, c.y)], false);
  return peak;
}

function paintWalkup(gfx: Gfx, ctx: BlockPaintCtx, wall: number): number {
  contactShadow(gfx, ctx, 0.28, 0.24);
  const m = mass(gfx, ctx, { hx: 0.24, hy: 0.2, h: 34, wall, openTop: true });
  parapetRoof(gfx, ctx, m);
  roofClutter(gfx, ctx, m);
  // Stairwell glass strip splits the facade; grouped windows either side.
  stripWindows(gfx, ctx, m.D, m.C, m.h, 1, { w: 0.16 });
  gridWindows(gfx, ctx, m.D, m.C, m.h, 3, 3, { presence: 0.85, w: 0.42, salt: 2 });
  gridWindows(gfx, ctx, m.C, m.B, m.h, 3, 3, { presence: 0.7, w: 0.42, salt: 8 });
  const p = mass(gfx, ctx, { gy: 0.24, gx: -0.1, hx: 0.07, hy: 0.05, h: 8, wall: nudge(wall, -12) });
  door(gfx, ctx, p.D, p.C, 0.5, 0.4, 6);
  return 36;
}

function paintMidrise(gfx: Gfx, ctx: BlockPaintCtx, wall: number): number {
  contactShadow(gfx, ctx, 0.27, 0.23);
  const m = mass(gfx, ctx, { hx: 0.23, hy: 0.19, h: 46, wall, openTop: true });
  parapetRoof(gfx, ctx, m);
  roofClutter(gfx, ctx, m);
  balconyRow(gfx, ctx, m.D, m.C, m.h, 4, wall);
  gridWindows(gfx, ctx, m.C, m.B, m.h, 4, 2, { presence: 0.75, salt: 6 });
  door(gfx, ctx, m.D, m.C, 0.5, 0.14, 8);
  return 48;
}

function paintHousingTower(gfx: Gfx, ctx: BlockPaintCtx, wall: number): number {
  contactShadow(gfx, ctx, 0.3, 0.26);
  const podium = mass(gfx, ctx, { hx: 0.26, hy: 0.22, h: 10, wall: nudge(wall, 8), openTop: true });
  parapetRoof(gfx, ctx, podium);
  const t = mass(gfx, ctx, { gx: -0.02, gy: -0.02, hx: 0.16, hy: 0.14, z: 10, h: 58, wall, openTop: true });
  parapetRoof(gfx, ctx, t);
  stripWindows(gfx, ctx, t.D, t.C, t.h, 2, { w: 0.45 });
  stripWindows(gfx, ctx, t.C, t.B, t.h, 2, { w: 0.4 });
  if (!ctx.flat) waterTank(gfx, ctx, 6, t.z + t.h - 2);
  door(gfx, ctx, podium.D, podium.C, 0.5, 0.12, 8);
  return 70;
}

/** Density-affinity table: small houses on quiet edges, towers in packed cores. */
const HOUSING_KINDS: Array<{ weight: number; density: number; paint: HousingPainter }> = [
  { weight: 5, density: 0.05, paint: paintCottage },
  { weight: 3, density: 0.2, paint: paintHouse },
  { weight: 4, density: 0.42, paint: paintRowhouses },
  { weight: 3, density: 0.6, paint: paintWalkup },
  { weight: 2, density: 0.8, paint: paintMidrise },
  { weight: 1, density: 0.95, paint: paintHousingTower },
];
const DENSITY_SPREAD = 0.32;

function paintHousing(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { cellX, cellY } = ctx;
  const wall =
    cellX !== undefined && cellY !== undefined ? housingWall(cellX, cellY) : 0xf3ecdf;

  if (cellX === undefined || cellY === undefined) return paintRowhouses(gfx, ctx, wall);

  const scored = HOUSING_KINDS.map((entry) => {
    const distance = entry.density - ctx.density;
    const affinity = Math.exp(-(distance * distance) / (2 * DENSITY_SPREAD * DENSITY_SPREAD));
    return { entry, score: entry.weight * affinity };
  });
  const total = scored.reduce((sum, item) => sum + item.score, 0) || 1;
  const roll = hash2(cellX, cellY, 41) * total;
  let cursor = 0;
  for (const item of scored) {
    cursor += item.score;
    if (roll < cursor) return item.entry.paint(gfx, ctx, wall);
  }
  return paintRowhouses(gfx, ctx, wall);
}

/* ----------------------------------------------------------------- services */

function paintHospital(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { wall, accent } = SERVICE_STYLE.healthcare!;
  contactShadow(gfx, ctx, 0.32, 0.26);
  const slab = mass(gfx, ctx, { gx: -0.03, gy: 0.03, hx: 0.28, hy: 0.19, h: 24, wall, openTop: true });
  parapetRoof(gfx, ctx, slab);
  ribbonWindows(gfx, ctx, slab.D, slab.C, slab.h, 2);
  ribbonWindows(gfx, ctx, slab.C, slab.B, slab.h, 2);
  // Accent band along the slab's cornice.
  L(gfx, ctx, 2, accent, 0.95);
  gfx.strokePoints(
    [v(slab.D.x, slab.D.y - slab.h + 2), v(slab.C.x, slab.C.y - slab.h + 2), v(slab.B.x, slab.B.y - slab.h + 2)],
    false,
  );
  // The tall ward wing behind-right, with the helipad.
  const wing = mass(gfx, ctx, { gx: 0.13, gy: -0.08, hx: 0.12, hy: 0.11, h: 46, wall, openTop: true });
  parapetRoof(gfx, ctx, wing, ROOF_WHITE);
  gridWindows(gfx, ctx, wing.C, wing.B, wing.h, 4, 2, { presence: 0.9, w: 0.44, salt: 3 });
  const padZ = wing.z + wing.h - 2.5;
  F(gfx, ctx, accent, 0.95);
  const pad = raise(gp(wing.gx, wing.gy), padZ);
  gfx.fillRect(pad.x - 1.6, pad.y - 5, 3.2, 10);
  gfx.fillRect(pad.x - 5, pad.y - 1.6, 10, 3.2);
  // Entrance: canopy + red cross sign + emergency doors.
  door(gfx, ctx, slab.D, slab.C, 0.5, 0.2, 9, 0x9db2c4);
  awning(gfx, ctx, slab.D, slab.C, 0.36, 0.64, 11, 7, ROOF_WHITE);
  F(gfx, ctx, ROOF_WHITE, 0.95);
  gfx.fillPoints(quadPts(slab.D, slab.C, 0.44, 0.56, 14, 21), true);
  F(gfx, ctx, accent, 0.95);
  const cx = fp(slab.D, slab.C, 0.5, 17.5);
  gfx.fillRect(cx.x - 1.1, cx.y - 3, 2.2, 6);
  gfx.fillRect(cx.x - 3, cx.y - 1.1, 6, 2.2);
  return 46;
}

function paintSchool(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { wall, accent } = SERVICE_STYLE.education!;
  contactShadow(gfx, ctx, 0.32, 0.24);
  // Play court on the front-right of the plot.
  if (!ctx.flat) {
    F(gfx, ctx, COURT, 0.95);
    fillDiamondAt(gfx, 0.17, 0.17, 0.13, 0.11, 0);
    L(gfx, ctx, 1, 0xffffff, 0.8);
    const c = gp(0.17, 0.17);
    gfx.strokeCircle(c.x, c.y, 4);
  }
  const main = mass(gfx, ctx, { gx: -0.02, gy: -0.12, hx: 0.27, hy: 0.12, h: 20, wall, openTop: true });
  parapetRoof(gfx, ctx, main);
  gridWindows(gfx, ctx, main.D, main.C, main.h, 2, 4, { presence: 1, w: 0.62, salt: 2 });
  const wing = mass(gfx, ctx, { gx: -0.16, gy: 0.12, hx: 0.1, hy: 0.11, h: 14, wall: nudge(wall, -12) });
  door(gfx, ctx, wing.D, wing.C, 0.5, 0.26, 8);
  awning(gfx, ctx, wing.D, wing.C, 0.3, 0.7, 9, 5, accent);
  // Flag on the front corner of the yard.
  if (!ctx.flat) {
    const f = gp(0.3, 0.02);
    L(gfx, ctx, 1.4, METAL, 1);
    gfx.lineBetween(f.x, f.y, f.x, f.y - 26);
    F(gfx, ctx, accent, 1);
    gfx.fillPoints([v(f.x, f.y - 26), v(f.x, f.y - 20), v(f.x + 8, f.y - 23)], true);
    drawPerson(gfx, f.x - 14, f.y + 4, ctx.seed + 3);
  }
  return 22;
}

function paintStation(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { wall, accent } = SERVICE_STYLE.transport!;
  contactShadow(gfx, ctx, 0.3, 0.24);
  const hall = mass(gfx, ctx, { gy: -0.02, hx: 0.26, hy: 0.16, h: 16, wall, openTop: true });
  vaultRoof(gfx, ctx, hall, 9, accent);
  stripWindows(gfx, ctx, hall.D, hall.C, hall.h, 4, { glass: true, w: 0.6 });
  stripWindows(gfx, ctx, hall.C, hall.B, hall.h, 3, { glass: true, w: 0.55 });
  door(gfx, ctx, hall.D, hall.C, 0.5, 0.18, 9, shade(accent, 0.7));
  awning(gfx, ctx, hall.D, hall.C, 0.3, 0.7, 10, 6, accent);
  if (!ctx.flat) {
    // Clock pylon on the forecourt - the "you catch things here" marker.
    const p = gp(-0.02, 0.32);
    L(gfx, ctx, 1.6, METAL, 1);
    gfx.lineBetween(p.x, p.y, p.x, p.y - 20);
    F(gfx, ctx, accent, 1);
    gfx.fillRect(p.x - 4, p.y - 27, 8, 8);
    F(gfx, ctx, ROOF_WHITE, 1);
    gfx.fillCircle(p.x, p.y - 23, 2.4);
    // Bus bay striping on the plot edge.
    L(gfx, ctx, 1.2, accent, 0.7);
    const b0 = gp(0.34, 0.12);
    const b1 = gp(0.34, 0.34);
    gfx.lineBetween(b0.x, b0.y, b1.x, b1.y);
  }
  return 27;
}

/**
 * Transport is the road network, not a building on it. A through segment - two or
 * more transport neighbours - is a thin blue line from the cell centre out to each
 * connected edge, so a corridor reads as a road rather than a row of stations. The
 * corridor's actual start and end (zero or one transport neighbour) keep the station
 * building instead: a road needs a place you'd call "the stop."
 */
function paintRoad(gfx: Gfx, ctx: BlockPaintCtx): number {
  const links = ctx.transportLinks ?? [];
  if (links.length < 2) return paintStation(gfx, ctx);

  const { accent } = SERVICE_STYLE.transport!;
  const center = gp(0, 0);
  L(gfx, ctx, 8, accent, 1);
  for (const { dx, dy } of links) {
    const edge = gp(dx * 0.5, dy * 0.5);
    gfx.lineBetween(center.x, center.y, edge.x, edge.y);
  }
  return 0;
}

function paintCommunityHub(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { wall, accent } = SERVICE_STYLE.community_hub!;
  contactShadow(gfx, ctx, 0.3, 0.24);
  // Paved plaza out front, with planters and a bench.
  if (!ctx.flat) {
    F(gfx, ctx, PATH, 0.95);
    fillDiamondAt(gfx, 0.14, 0.18, 0.16, 0.12, 0);
    drawBush(gfx, 22, 6, ctx.seed + 8);
    drawBench(gfx, gp(0.26, 0.06).x, gp(0.26, 0.06).y);
    drawPerson(gfx, 4, 14, ctx.seed + 9);
  }
  const hall = mass(gfx, ctx, { gx: -0.06, gy: -0.06, hx: 0.21, hy: 0.16, h: 19, wall, openTop: true });
  parapetRoof(gfx, ctx, hall);
  // The dome that identifies the hub.
  const domeAt = raise(gp(hall.gx, hall.gy), hall.z + hall.h);
  F(gfx, ctx, tint(accent, 0.36));
  gfx.fillEllipse(domeAt.x, domeAt.y - 4, 19, 12);
  F(gfx, ctx, tint(accent, 0.6), 0.9);
  gfx.fillEllipse(domeAt.x - 3, domeAt.y - 7, 8, 5);
  L(gfx, ctx, 1.2, OUTLINE, 0.4);
  gfx.strokeEllipse(domeAt.x, domeAt.y - 4, 19, 12);
  // Arched entrance.
  door(gfx, ctx, hall.D, hall.C, 0.5, 0.2, 9);
  const arch = fp(hall.D, hall.C, 0.5, 9);
  F(gfx, ctx, accent, 0.95);
  gfx.fillEllipse(arch.x, arch.y, 9, 6);
  gridWindows(gfx, ctx, hall.D, hall.C, hall.h, 1, 3, { presence: 0.7, salt: 4 });
  gridWindows(gfx, ctx, hall.C, hall.B, hall.h, 1, 3, { presence: 0.65, salt: 12 });
  return 30;
}

function paintTechHub(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { wall, accent } = SERVICE_STYLE.technology_hub!;
  contactShadow(gfx, ctx, 0.3, 0.26);
  const podium = mass(gfx, ctx, { hx: 0.24, hy: 0.2, h: 10, wall, openTop: true });
  parapetRoof(gfx, ctx, podium);
  if (!ctx.flat) solarPanels(gfx, ctx, 0.12, 0.1, podium.h - 2);
  const glass = 0xa9cfe6;
  const t = mass(gfx, ctx, { gx: -0.03, gy: -0.03, hx: 0.15, hy: 0.13, z: 10, h: 62, wall: glass, openTop: true });
  parapetRoof(gfx, ctx, t, shade(glass, 0.8));
  // Curtain wall: glazed faces with floor lines and a corner accent stripe.
  stripWindows(gfx, ctx, t.D, t.C, t.h, 3, { glass: true, w: 0.68 });
  stripWindows(gfx, ctx, t.C, t.B, t.h, 3, { glass: true, w: 0.68 });
  L(gfx, ctx, 2, accent, 0.9);
  gfx.lineBetween(t.C.x, t.C.y, t.C.x, t.C.y - t.h);
  if (!ctx.flat) {
    const mastTop = -(t.z + t.h) - 20;
    L(gfx, ctx, 1.6, METAL, 1);
    gfx.lineBetween(t.C.x, -(t.z + t.h), t.C.x, mastTop);
    gfx.lineBetween(t.C.x - 5, mastTop + 8, t.C.x + 5, mastTop + 8);
    F(gfx, ctx, accent, 1);
    gfx.fillCircle(t.C.x, mastTop, 2.4);
  }
  door(gfx, ctx, podium.D, podium.C, 0.5, 0.14, 8);
  return 74;
}

function paintResourceHub(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { wall, accent } = SERVICE_STYLE.shared_resource_hub!;
  contactShadow(gfx, ctx, 0.3, 0.22);
  const hall = mass(gfx, ctx, { gy: -0.02, hx: 0.25, hy: 0.16, h: 13, wall, openTop: true });
  sawtoothRoof(gfx, ctx, hall, 3, 7);
  // Teal fascia stripe + roller door + a couple of crates by the entrance.
  L(gfx, ctx, 2, accent, 0.95);
  gfx.strokePoints(
    [v(hall.D.x, hall.D.y - hall.h + 1.5), v(hall.C.x, hall.C.y - hall.h + 1.5), v(hall.B.x, hall.B.y - hall.h + 1.5)],
    false,
  );
  F(gfx, ctx, shade(wall, 0.62), 0.95);
  gfx.fillPoints(quadPts(hall.C, hall.B, 0.28, 0.72, 0, 9), true);
  L(gfx, ctx, 0.8, shade(wall, 0.45), 0.9);
  for (const yy of [2.5, 5, 7.5]) {
    const s0 = fp(hall.C, hall.B, 0.28, yy);
    const s1 = fp(hall.C, hall.B, 0.72, yy);
    gfx.lineBetween(s0.x, s0.y, s1.x, s1.y);
  }
  door(gfx, ctx, hall.D, hall.C, 0.24, 0.14, 8);
  gridWindows(gfx, ctx, hall.D, hall.C, hall.h, 1, 2, { presence: 0.6, salt: 6 });
  if (!ctx.flat) {
    mass(gfx, ctx, { gx: 0.3, gy: 0.14, hx: 0.05, hy: 0.045, h: 5, wall: TANK, noOutline: true });
    mass(gfx, ctx, { gx: 0.24, gy: 0.2, hx: 0.04, hy: 0.04, h: 4, wall: nudge(TANK, -18), noOutline: true });
  }
  return 20;
}

function paintCulture(gfx: Gfx, ctx: BlockPaintCtx): number {
  const { wall, accent } = SERVICE_STYLE.culture_heritage!;
  contactShadow(gfx, ctx, 0.32, 0.24);
  const base = mass(gfx, ctx, { hx: 0.27, hy: 0.2, h: 5, wall: nudge(wall, 14), openTop: false });
  const m = mass(gfx, ctx, { hx: 0.21, hy: 0.15, z: 5, h: 22, wall, openTop: true });
  parapetRoof(gfx, ctx, m, shade(wall, 0.9));
  // Colonnade: a recessed dark wall behind evenly spaced columns.
  F(gfx, ctx, shade(wall, 0.5), 0.9);
  gfx.fillPoints(quadPts(m.D, m.C, 0.08, 0.92, 3, m.h - 5), true);
  L(gfx, ctx, 2, tint(wall, 0.3), 1);
  for (const u of [0.14, 0.32, 0.5, 0.68, 0.86]) {
    const p0 = fp(m.D, m.C, u, 2);
    const p1 = fp(m.D, m.C, u, m.h - 5);
    gfx.lineBetween(p0.x, p0.y, p1.x, p1.y);
  }
  // Entablature + pediment triangle over the facade.
  F(gfx, ctx, tint(wall, 0.22));
  gfx.fillPoints(quadPts(m.D, m.C, 0.04, 0.96, m.h - 5, m.h - 1), true);
  F(gfx, ctx, tint(wall, 0.3));
  const t0 = fp(m.D, m.C, 0.1, m.h - 1);
  const t1 = fp(m.D, m.C, 0.9, m.h - 1);
  const apex = fp(m.D, m.C, 0.5, m.h + 7);
  gfx.fillPoints([v(t0.x, t0.y), v(t1.x, t1.y), v(apex.x, apex.y)], true);
  L(gfx, ctx, 1.2, OUTLINE, 0.45);
  gfx.strokePoints([v(t0.x, t0.y), v(apex.x, apex.y), v(t1.x, t1.y)], true);
  // Banner in the block's colour - "what's on".
  F(gfx, ctx, accent, 0.95);
  gfx.fillPoints(quadPts(m.C, m.B, 0.4, 0.6, 6, m.h - 3), true);
  gridWindows(gfx, ctx, m.C, m.B, m.h, 2, 2, { presence: 0.5, salt: 7 });
  door(gfx, ctx, base.D, base.C, 0.5, 0.1, 5);
  return 34;
}

/* --------------------------------------------------------------------- park */

function paintPark(gfx: Gfx, ctx: BlockPaintCtx): number {
  const s = ctx.seed;
  F(gfx, ctx, GRASS, 1);
  fillDiamondAt(gfx, 0, 0, 0.41, 0.41, 0);
  L(gfx, ctx, 1.3, OUTLINE, 0.28);
  const A = gp(0, -0.41);
  const B = gp(0.41, 0);
  const C = gp(0, 0.41);
  const D = gp(-0.41, 0);
  gfx.strokePoints([v(A.x, A.y), v(B.x, B.y), v(C.x, C.y), v(D.x, D.y)], true);

  // A designed space, not a green tile: winding path, then one feature.
  L(gfx, ctx, 3, PATH, 0.95);
  const p0 = gp(-0.38, 0.05);
  const p1 = gp(-0.1, hash2(s, 1, 61) > 0.5 ? -0.14 : 0.14);
  const p2 = gp(0.12, hash2(s, 2, 62) > 0.5 ? 0.1 : -0.08);
  const p3 = gp(0.38, -0.02);
  gfx.strokePoints([v(p0.x, p0.y), v(p1.x, p1.y), v(p2.x, p2.y), v(p3.x, p3.y)], false);

  const feature = hash2(s, 3, 63);
  if (feature < 0.32) {
    // Pond.
    const at = gp(0.08, 0.16);
    F(gfx, ctx, shade(POND, 0.85), 0.95);
    gfx.fillEllipse(at.x, at.y, 26, 12);
    F(gfx, ctx, POND, 0.95);
    gfx.fillEllipse(at.x - 1, at.y - 1, 21, 9);
    L(gfx, ctx, 1, 0xffffff, 0.5);
    gfx.lineBetween(at.x - 6, at.y - 1, at.x + 2, at.y - 1);
  } else if (feature < 0.58 && !ctx.flat) {
    // Playground corner.
    const at = gp(0.14, 0.14);
    F(gfx, ctx, COURT, 0.95);
    gfx.fillEllipse(at.x, at.y, 20, 10);
    L(gfx, ctx, 1.4, 0xd9764a, 1);
    gfx.lineBetween(at.x - 5, at.y + 1, at.x - 1, at.y - 7);
    gfx.lineBetween(at.x + 4, at.y + 2, at.x - 1, at.y - 7);
    drawPerson(gfx, at.x + 8, at.y + 3, s + 12);
  }

  drawTree(gfx, -13, -4, s + 20);
  drawTree(gfx, -20, 5, s + 41);
  drawTree(gfx, 12, 7, s + 42);
  if (hash2(s, 4, 64) > 0.45) drawTree(gfx, 3, -9, s + 43);
  drawBush(gfx, 20, 3, s + 44);
  if (!ctx.flat && hash2(s, 5, 65) > 0.5) {
    const b = gp(-0.05, 0.3);
    drawBench(gfx, b.x, b.y);
  }
  return 0;
}

/* ----------------------------------------------------------------- dispatch */

const SERVICE_PAINTERS: Record<string, (gfx: Gfx, ctx: BlockPaintCtx) => number> = {
  healthcare: paintHospital,
  education: paintSchool,
  transport: paintRoad,
  community_hub: paintCommunityHub,
  technology_hub: paintTechHub,
  shared_resource_hub: paintResourceHub,
  culture_heritage: paintCulture,
  park: paintPark,
};

/**
 * Paint one block in local cell space. Returns the silhouette height in px, so
 * the caller can hang the service pin above the massing.
 */
export function paintBlock(gfx: Gfx, typeId: string, ctx: BlockPaintCtx): number {
  if (typeId === 'housing') return paintHousing(gfx, ctx);
  const painter = SERVICE_PAINTERS[typeId];
  if (painter) return painter(gfx, ctx);
  // Unknown catalog id: a plain two-storey block so nothing ever renders empty.
  contactShadow(gfx, ctx, 0.24, 0.2);
  const m = mass(gfx, ctx, { hx: 0.22, hy: 0.18, h: 24, wall: 0xd8cfc0, openTop: true });
  parapetRoof(gfx, ctx, m);
  gridWindows(gfx, ctx, m.D, m.C, m.h, 2, 3, { presence: 0.8 });
  gridWindows(gfx, ctx, m.C, m.B, m.h, 2, 3, { presence: 0.8, salt: 5 });
  return 24;
}
