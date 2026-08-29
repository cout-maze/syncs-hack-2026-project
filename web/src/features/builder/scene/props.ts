import Phaser from 'phaser';

/**
 * Street-level scenery and building profiles.
 *
 * Everything here is deterministic: the same cell always grows the same tree and
 * parks the same car, so the map does not reshuffle itself on every re-render.
 */

type Gfx = Phaser.GameObjects.Graphics;

const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

/** Stable 0..1 value per (cell, salt). */
export function hash2(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

export interface BuildingProfile {
  /** Storeys; 0 means open land (parks) - no massing, just landscape. */
  floors: number;
  /** Window columns per visible face. */
  windowCols: number;
  /** Roof deck brightness relative to the block colour. */
  roof: 'light' | 'dark';
}

const DEFAULT_PROFILE: BuildingProfile = { floors: 2, windowCols: 3, roof: 'light' };

/** Massing per block type - variety in height is what makes the skyline read. */
export const BUILDING_PROFILES: Record<string, BuildingProfile> = {
  housing: { floors: 3, windowCols: 3, roof: 'dark' },
  healthcare: { floors: 3, windowCols: 3, roof: 'light' },
  education: { floors: 2, windowCols: 4, roof: 'light' },
  transport: { floors: 1, windowCols: 4, roof: 'dark' },
  park: { floors: 0, windowCols: 0, roof: 'light' },
  community_hub: { floors: 2, windowCols: 3, roof: 'light' },
  technology_hub: { floors: 5, windowCols: 2, roof: 'dark' },
  shared_resource_hub: { floors: 2, windowCols: 3, roof: 'dark' },
  culture_heritage: { floors: 2, windowCols: 4, roof: 'light' },
};

export function buildingProfile(typeId: string): BuildingProfile {
  return BUILDING_PROFILES[typeId] ?? DEFAULT_PROFILE;
}

/* ------------------------------------------------------------------ scenery */

const OUTLINE = 0x2a2213;
const TRUNK = 0x8a6244;
const LEAF = [0x5cbf85, 0x46ab77, 0x76cf95];
const CAR_COLORS = [0xf6c445, 0xd9764a, 0x1f88bd, 0xdd4b58, 0xffffff];
const PERSON_COLORS = [0x1f88bd, 0xdd4b58, 0xc78a1f, 0x8858d4, 0x1a9e8f];

/** A rounded canopy tree, drawn in local space with its base at (x, y). */
export function drawTree(gfx: Gfx, x: number, y: number, seed: number): void {
  const height = 13 + Math.round(hash2(x, y, seed) * 7);
  const radius = 6 + hash2(x, y, seed + 1) * 2.5;
  const leaf = LEAF[Math.floor(hash2(x, y, seed + 2) * LEAF.length)] ?? LEAF[0]!;

  gfx.fillStyle(0x000000, 0.08);
  gfx.fillEllipse(x, y + 1, radius * 2.1, radius * 0.9);

  gfx.fillStyle(TRUNK, 1);
  gfx.fillRect(x - 1.5, y - height, 3, height);

  gfx.fillStyle(leaf, 1);
  gfx.fillCircle(x, y - height, radius);
  gfx.fillCircle(x - radius * 0.6, y - height + radius * 0.5, radius * 0.72);
  gfx.fillCircle(x + radius * 0.6, y - height + radius * 0.5, radius * 0.72);

  gfx.lineStyle(1.2, OUTLINE, 0.35);
  gfx.strokeCircle(x, y - height, radius);
}

/** A low shrub for verges and plot corners. */
export function drawBush(gfx: Gfx, x: number, y: number, seed: number): void {
  const radius = 4 + hash2(x, y, seed) * 2;
  gfx.fillStyle(0x000000, 0.07);
  gfx.fillEllipse(x, y + 1, radius * 2.2, radius * 0.8);
  gfx.fillStyle(0x6cc793, 1);
  gfx.fillCircle(x - radius * 0.5, y - radius * 0.6, radius * 0.8);
  gfx.fillCircle(x + radius * 0.5, y - radius * 0.6, radius * 0.8);
  gfx.fillCircle(x, y - radius, radius * 0.95);
}

/**
 * A car seen from the same isometric angle as the buildings.
 * `axis` picks which of the two street directions it faces.
 */
export function drawCar(gfx: Gfx, x: number, y: number, axis: 'x' | 'y', seed: number): void {
  const color = CAR_COLORS[Math.floor(hash2(x, y, seed) * CAR_COLORS.length)] ?? CAR_COLORS[0]!;
  // Half-length along the street the car sits on, in isometric axes.
  const dx = axis === 'x' ? 7 : -7;
  const dy = 3.5;
  const body = 4;
  const cabin = 3.5;

  const quad = (lower: number, upper: number, scale = 1) =>
    [
      v(x - dx * scale, y - dy * scale - lower),
      v(x + dx * scale, y + dy * scale - lower),
      v(x + dx * scale, y + dy * scale - upper),
      v(x - dx * scale, y - dy * scale - upper),
    ] as Phaser.Math.Vector2[];

  gfx.fillStyle(0x000000, 0.1);
  gfx.fillEllipse(x, y + 1, Math.abs(dx) * 2.4, 6);

  gfx.fillStyle(color, 1);
  gfx.fillPoints(quad(0, body), true);
  gfx.fillPoints(quad(body, body + cabin, 0.55), true);

  gfx.fillStyle(0x2a3b56, 0.8);
  gfx.fillPoints(quad(body + 0.6, body + cabin - 0.6, 0.42), true);

  gfx.lineStyle(1, OUTLINE, 0.4);
  gfx.strokePoints(quad(0, body), true);
}

/** A pedestrian: two dots, enough at this scale. */
export function drawPerson(gfx: Gfx, x: number, y: number, seed: number): void {
  const color =
    PERSON_COLORS[Math.floor(hash2(x, y, seed) * PERSON_COLORS.length)] ?? PERSON_COLORS[0]!;
  gfx.fillStyle(0x000000, 0.1);
  gfx.fillEllipse(x, y, 7, 3);
  gfx.fillStyle(color, 1);
  gfx.fillRect(x - 2, y - 8, 4, 6);
  gfx.fillStyle(0xf0d3b4, 1);
  gfx.fillCircle(x, y - 10, 2.6);
}

/** A dashed line, used for street centre markings. */
export function dashedLine(
  gfx: Gfx,
  from: { x: number; y: number },
  to: { x: number; y: number },
  dash = 6,
  gap = 6,
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;

  for (let travelled = 0; travelled < length; travelled += dash + gap) {
    const end = Math.min(travelled + dash, length);
    gfx.lineBetween(
      from.x + ux * travelled,
      from.y + uy * travelled,
      from.x + ux * end,
      from.y + uy * end,
    );
  }
}
