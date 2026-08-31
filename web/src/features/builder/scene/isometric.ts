/**
 * 2.5D grid projection.
 *
 * A flat grid cell (x, y) is drawn as a diamond; blocks are extruded upward from it
 * to give depth. Screen space is the Phaser game's fixed logical space - the React
 * wrapper converts DOM pointer coordinates into it before calling screenToCell.
 */

export const TILE_WIDTH = 76;
export const TILE_HEIGHT = 38;
export const BLOCK_HEIGHT = 16;

/** How far the buildable plot sits inside its tile - the margin is the street. */
export const PLOT_INSET = 7;
/** The building footprint sits inside the plot again, leaving a pavement. */
export const BUILDING_INSET = 15;
/** One storey of massing. */
export const FLOOR_HEIGHT = 12;

export const GAME_WIDTH = 880;
export const GAME_HEIGHT = 520;

/** Where cell (0, 0) sits in game space. Centred horizontally, with headroom on top. */
export const ORIGIN_X = GAME_WIDTH / 2;
export const ORIGIN_Y = 116;

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  x: number;
  y: number;
}

/** Centre of a cell's ground diamond, in game space. */
export function cellToScreen(cellX: number, cellY: number): Point {
  return {
    x: ORIGIN_X + (cellX - cellY) * (TILE_WIDTH / 2),
    y: ORIGIN_Y + (cellX + cellY) * (TILE_HEIGHT / 2),
  };
}

/** Inverse of cellToScreen against the ground plane. May return out-of-range cells. */
export function screenToCell(screenX: number, screenY: number): Cell {
  const dx = (screenX - ORIGIN_X) / (TILE_WIDTH / 2);
  const dy = (screenY - ORIGIN_Y) / (TILE_HEIGHT / 2);
  return {
    x: Math.floor((dx + dy) / 2 + 0.5),
    y: Math.floor((dy - dx) / 2 + 0.5),
  };
}

export function isWithinGrid(cell: Cell, gridWidth: number, gridHeight: number): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < gridWidth && cell.y < gridHeight;
}

/** The four corners of a cell's ground diamond, clockwise from the top. */
export function diamondPoints(cellX: number, cellY: number, inset = 0): Point[] {
  const centre = cellToScreen(cellX, cellY);
  const halfW = TILE_WIDTH / 2 - inset;
  const halfH = TILE_HEIGHT / 2 - inset * (TILE_HEIGHT / TILE_WIDTH);
  return [
    { x: centre.x, y: centre.y - halfH },
    { x: centre.x + halfW, y: centre.y },
    { x: centre.x, y: centre.y + halfH },
    { x: centre.x - halfW, y: centre.y },
  ];
}

/** Painter's order: cells further from the camera are drawn first. */
export function depthOf(cellX: number, cellY: number): number {
  return (cellX + cellY) * 100 + cellX;
}

/** Multiply a colour toward black - used for the two shaded side faces. */
export function shade(color: number, amount: number): number {
  const r = Math.round(((color >> 16) & 0xff) * amount);
  const g = Math.round(((color >> 8) & 0xff) * amount);
  const b = Math.round((color & 0xff) * amount);
  return (r << 16) | (g << 8) | b;
}

/** Blend a colour toward white - used for highlight states. */
export function tint(color: number, amount: number): number {
  const r = Math.round(((color >> 16) & 0xff) + (255 - ((color >> 16) & 0xff)) * amount);
  const g = Math.round(((color >> 8) & 0xff) + (255 - ((color >> 8) & 0xff)) * amount);
  const b = Math.round((color & 0xff) + (255 - (color & 0xff)) * amount);
  return (r << 16) | (g << 8) | b;
}

/** Nudge every channel by a signed delta, clamped to 0..255 - a small per-cell drift
 *  (a street of white houses each a touch warmer or cooler) rather than a hue blend. */
export function nudge(color: number, delta: number): number {
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel + delta)));
  const r = clamp((color >> 16) & 0xff);
  const g = clamp((color >> 8) & 0xff);
  const b = clamp(color & 0xff);
  return (r << 16) | (g << 8) | b;
}

/** Blend colour `a` toward colour `b` by t (0..1) - state recolours that keep detail. */
export function mix(a: number, b: number, t: number): number {
  const chan = (sh: number) => {
    const ca = (a >> sh) & 0xff;
    const cb = (b >> sh) & 0xff;
    return Math.round(ca + (cb - ca) * t);
  };
  return (chan(16) << 16) | (chan(8) << 8) | chan(0);
}
