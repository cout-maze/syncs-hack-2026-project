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

/**
 * What sits on a building's roof.
 *
 * Every building gets the same base treatment - a flat deck recessed inside a
 * parapet rim, plus a little mechanical clutter - which is what the reference
 * isometric city maps do and what stops a filled grid reading as plain lids.
 * The style on top of that is what identifies the service at a glance.
 */
export type RoofStyle =
  | 'plain'
  | 'cross'
  | 'flagpole'
  | 'dome'
  | 'antenna'
  | 'skylight'
  | 'pediment';

export interface BuildingProfile {
  /** Storeys; 0 means open land (parks) - no massing, just landscape. */
  floors: number;
  /** Window columns per visible face. */
  windowCols: number;
  /** Roof deck brightness relative to the block colour. */
  roof: 'light' | 'dark';
  /** Roof accessory - see RoofStyle. Defaults to 'plain'. */
  roofStyle?: RoofStyle;
  /**
   * Extra margin shaved off the footprint, beyond BUILDING_INSET. A single fixed
   * footprint for every building is what makes a filled-in grid read as a brick
   * texture rather than a skyline - small houses need a visibly smaller base, not
   * just a shorter one.
   */
  footprintInset?: number;
  /** Signed drift applied to the block colour, so a street of housing is not one
   *  flat swatch. Small, +/- roughly 40 out of 255 per channel. */
  tint?: number;
  /** Lit windows read as cool glass instead of warm amber - technology hub. */
  glass?: boolean;
}

const DEFAULT_PROFILE: BuildingProfile = { floors: 2, windowCols: 3, roof: 'light' };

/** Massing per block type - variety in height is what makes the skyline read. */
export const BUILDING_PROFILES: Record<string, BuildingProfile> = {
  healthcare: { floors: 3, windowCols: 3, roof: 'light', roofStyle: 'cross' },
  education: { floors: 2, windowCols: 4, roof: 'light', roofStyle: 'flagpole' },
  transport: { floors: 2, windowCols: 4, roof: 'dark', glass: true },
  park: { floors: 0, windowCols: 0, roof: 'light' },
  community_hub: { floors: 2, windowCols: 3, roof: 'light', roofStyle: 'dome' },
  technology_hub: { floors: 5, windowCols: 2, roof: 'dark', roofStyle: 'antenna', glass: true },
  shared_resource_hub: { floors: 2, windowCols: 3, roof: 'dark', roofStyle: 'skylight' },
  culture_heritage: { floors: 2, windowCols: 4, roof: 'light', roofStyle: 'pediment' },
};

/**
 * Housing does not get one profile - a street of identical brick towers is what made
 * the map look like a texture instead of a city. Each variant also carries a `density`
 * affinity, 0 (a small house, belongs on a quiet edge) to 1 (a tower, belongs in a
 * packed core) - purely random height with no relationship to its neighbours read as
 * noise, not a skyline. Weighting toward the local block's actual housing density is
 * what turns "random heights" into "the middle of the neighbourhood is denser than its
 * edge", the way a real city's silhouette works.
 */
const HOUSING_VARIANTS: Array<{ weight: number; density: number; profile: BuildingProfile }> = [
  { weight: 5, density: 0.05, profile: { floors: 1, windowCols: 2, roof: 'light', footprintInset: 6 } }, // small house
  { weight: 3, density: 0.15, profile: { floors: 1, windowCols: 3, roof: 'dark', footprintInset: 3 } }, // bungalow
  { weight: 4, density: 0.4, profile: { floors: 2, windowCols: 2, roof: 'light', footprintInset: 4 } }, // townhouse
  { weight: 3, density: 0.55, profile: { floors: 2, windowCols: 3, roof: 'dark', footprintInset: 1 } }, // rowhouse
  { weight: 2, density: 0.8, profile: { floors: 3, windowCols: 3, roof: 'dark', footprintInset: 0 } }, // apartment block
  { weight: 1, density: 0.95, profile: { floors: 5, windowCols: 2, roof: 'dark', footprintInset: 0 } }, // rare tower
];

/** How tightly a variant's density affinity has to match its cell before it is favoured. */
const DENSITY_SPREAD = 0.32;

function housingVariant(x: number, y: number, density: number): BuildingProfile {
  const scored = HOUSING_VARIANTS.map((entry) => {
    const distance = entry.density - density;
    const affinity = Math.exp(-(distance * distance) / (2 * DENSITY_SPREAD * DENSITY_SPREAD));
    return { entry, score: entry.weight * affinity };
  });
  const total = scored.reduce((sum, item) => sum + item.score, 0) || 1;

  const roll = hash2(x, y, 41) * total;
  let cursor = 0;
  for (const item of scored) {
    cursor += item.score;
    if (roll < cursor) {
      // A little colour drift per cell, so even same-height houses on a row look like
      // different buildings rather than one wall. Kept subtle - the reference maps
      // are a near-white skyline, so a wide spread would read as dirt, not variety.
      const tint = Math.round((hash2(x, y, 53) - 0.5) * 0.16 * 255);
      return { ...item.entry.profile, tint };
    }
  }
  return HOUSING_VARIANTS[0]!.profile;
}

/**
 * Cell coordinates are optional so callers without a placed cell (a fresh drag ghost
 * before it has a home) still get a sensible default; anything with a real (x, y) - a
 * placed block, a drop preview, a proposal change - gets the deterministic variant.
 */
/** Used when housing has no cell to roll a variant against - the mid-sized rowhouse. */
const HOUSING_FALLBACK: BuildingProfile = HOUSING_VARIANTS[3]!.profile;

/**
 * `density` is the share of nearby cells that are also housing, 0..1 - see
 * CityScene.housingDensity. Defaults to the mid-point when the caller has no map to
 * measure against (a fresh drag ghost, mainly), which is a reasonable middling guess.
 */
export function buildingProfile(
  typeId: string,
  x?: number,
  y?: number,
  density = 0.5,
): BuildingProfile {
  if (typeId === 'housing') {
    return x !== undefined && y !== undefined ? housingVariant(x, y, density) : HOUSING_FALLBACK;
  }
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
