import Phaser from 'phaser';

/**
 * Street-level scenery: trees, vehicles, people, street furniture.
 *
 * Everything here is deterministic: the same cell always grows the same tree and
 * parks the same car, so the map does not reshuffle itself on every re-render.
 * Building massing lives in buildings.ts; this file is what fills the space
 * between the buildings and makes the map feel inhabited.
 */

type Gfx = Phaser.GameObjects.Graphics;

const v = (x: number, y: number) => new Phaser.Math.Vector2(x, y);

/** Stable 0..1 value per (cell, salt). */
export function hash2(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/* ------------------------------------------------------------------ scenery */

const OUTLINE = 0x2a2213;
const TRUNK = 0x8a6244;
const LEAF = [0x5cbf85, 0x46ab77, 0x76cf95];
const CONIFER = [0x3e9668, 0x2f8a5c];
const CAR_COLORS = [0xf6c445, 0xd9764a, 0x1f88bd, 0xdd4b58, 0xffffff, 0x9aa3ad];
const PERSON_COLORS = [0x1f88bd, 0xdd4b58, 0xc78a1f, 0x8858d4, 0x1a9e8f];
const BUS_BODY = 0x3d9ac9;
const WOOD = 0xb98d5f;

/** A tree, drawn in local space with its base at (x, y). Two species. */
export function drawTree(gfx: Gfx, x: number, y: number, seed: number): void {
  const conifer = hash2(x, y, seed + 3) > 0.72;
  const height = 13 + Math.round(hash2(x, y, seed) * 7);

  gfx.fillStyle(0x000000, 0.08);
  gfx.fillEllipse(x, y + 1, 13, 5);
  gfx.fillStyle(TRUNK, 1);
  gfx.fillRect(x - 1.5, y - height + (conifer ? 6 : 0), 3, height - (conifer ? 6 : 0));

  if (conifer) {
    const leaf = CONIFER[Math.floor(hash2(x, y, seed + 2) * CONIFER.length)] ?? CONIFER[0]!;
    gfx.fillStyle(leaf, 1);
    gfx.fillPoints([v(x - 6, y - 5), v(x + 6, y - 5), v(x, y - height - 6)], true);
    gfx.fillPoints([v(x - 4.5, y - height * 0.55), v(x + 4.5, y - height * 0.55), v(x, y - height - 8)], true);
    gfx.lineStyle(1.1, OUTLINE, 0.3);
    gfx.strokePoints([v(x - 6, y - 5), v(x + 6, y - 5), v(x, y - height - 6)], true);
    return;
  }

  const radius = 6 + hash2(x, y, seed + 1) * 2.5;
  const leaf = LEAF[Math.floor(hash2(x, y, seed + 2) * LEAF.length)] ?? LEAF[0]!;
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

  const quad = (lower: number, upper: number, scale = 1, slide = 0) =>
    [
      v(x - dx * scale + dx * slide, y - dy * scale + dy * slide - lower),
      v(x + dx * scale + dx * slide, y + dy * scale + dy * slide - lower),
      v(x + dx * scale + dx * slide, y + dy * scale + dy * slide - upper),
      v(x - dx * scale + dx * slide, y - dy * scale + dy * slide - upper),
    ] as Phaser.Math.Vector2[];

  gfx.fillStyle(0x000000, 0.1);
  gfx.fillEllipse(x, y + 1, Math.abs(dx) * 2.4, 6);

  gfx.fillStyle(color, 1);
  gfx.fillPoints(quad(0, body), true);
  gfx.fillPoints(quad(body, body + cabin, 0.52, -0.08), true);

  gfx.fillStyle(0x2a3b56, 0.8);
  gfx.fillPoints(quad(body + 0.6, body + cabin - 0.6, 0.4, -0.08), true);

  // Wheel hints along the near edge.
  gfx.fillStyle(0x33302b, 1);
  gfx.fillCircle(x - dx * 0.55, y - dy * 0.55 + 1.4, 1.4);
  gfx.fillCircle(x + dx * 0.55, y + dy * 0.55 + 1.4, 1.4);

  gfx.lineStyle(1, OUTLINE, 0.4);
  gfx.strokePoints(quad(0, body), true);
}

/** A city bus - longer, with a window band. Lives on arterials. */
export function drawBus(gfx: Gfx, x: number, y: number, axis: 'x' | 'y'): void {
  const dx = axis === 'x' ? 12 : -12;
  const dy = 6;
  const body = 8;

  const quad = (lower: number, upper: number, scale = 1) =>
    [
      v(x - dx * scale, y - dy * scale - lower),
      v(x + dx * scale, y + dy * scale - lower),
      v(x + dx * scale, y + dy * scale - upper),
      v(x - dx * scale, y - dy * scale - upper),
    ] as Phaser.Math.Vector2[];

  gfx.fillStyle(0x000000, 0.12);
  gfx.fillEllipse(x, y + 1, Math.abs(dx) * 2.2, 7);

  gfx.fillStyle(BUS_BODY, 1);
  gfx.fillPoints(quad(0, body), true);
  gfx.fillStyle(0xf4f7f9, 1);
  gfx.fillPoints(quad(body * 0.45, body * 0.85, 0.92), true);
  gfx.fillStyle(0x2a3b56, 0.75);
  gfx.fillPoints(quad(body * 0.5, body * 0.8, 0.86), true);

  gfx.fillStyle(0x33302b, 1);
  gfx.fillCircle(x - dx * 0.6, y - dy * 0.6 + 1.6, 1.7);
  gfx.fillCircle(x + dx * 0.6, y + dy * 0.6 + 1.6, 1.7);

  gfx.lineStyle(1, OUTLINE, 0.45);
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

/** A street light with its arm reaching toward (dirX, dirY). */
export function drawStreetlight(gfx: Gfx, x: number, y: number, dirX: number, dirY: number): void {
  const h = 17;
  gfx.fillStyle(0x000000, 0.08);
  gfx.fillEllipse(x, y + 1, 6, 2.5);
  gfx.lineStyle(1.4, 0x6b7280, 1);
  gfx.lineBetween(x, y, x, y - h);
  gfx.lineBetween(x, y - h, x + dirX * 6, y - h + dirY * 3);
  gfx.fillStyle(0xffd98a, 1);
  gfx.fillCircle(x + dirX * 6, y - h + dirY * 3 + 1, 1.8);
}

/** A park/plaza bench. */
export function drawBench(gfx: Gfx, x: number, y: number): void {
  gfx.fillStyle(0x000000, 0.08);
  gfx.fillEllipse(x, y + 1, 12, 3);
  gfx.lineStyle(1.2, 0x6b7280, 1);
  gfx.lineBetween(x - 4, y, x - 4, y - 3);
  gfx.lineBetween(x + 4, y, x + 4, y - 3);
  gfx.lineStyle(2.2, WOOD, 1);
  gfx.lineBetween(x - 6, y - 3.5, x + 6, y - 3.5);
}

/** A planter box with a shrub - plazas and storefronts. */
export function drawPlanter(gfx: Gfx, x: number, y: number, seed: number): void {
  gfx.fillStyle(0x9b8365, 1);
  gfx.fillRect(x - 4, y - 4, 8, 4);
  gfx.fillStyle(0x816c52, 1);
  gfx.fillRect(x - 4, y - 1.4, 8, 1.4);
  drawBush(gfx, x, y - 3, seed);
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
