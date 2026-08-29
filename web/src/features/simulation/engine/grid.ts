import { TRANSPORT_MINUTES, WALK_MINUTES } from '@rmc/shared';
import type { City } from '@rmc/shared';

/**
 * Grid indexing and multi-source Dijkstra for the simulation engine.
 *
 * This is new code, not a reuse of shared/src/generation.ts's own Dijkstra - that one
 * operates on the city generator's internal Grid/Cell types with no placed-block id
 * tracking, and the engine needs ids for Journey.pathBlockIds/fromBlockId. Same algorithm
 * and the same imported WALK_MINUTES/TRANSPORT_MINUTES cost model, so the generator and
 * the engine can never quietly drift apart on what "far" means.
 */

export interface EngineGrid {
  width: number;
  height: number;
  /** Block-type id per cell, or null. Indexed y * width + x. */
  typeIdAt: Array<string | null>;
  /** Placed-block id per cell, or null. */
  blockIdAt: Array<string | null>;
  /** 1 = impassable (flood), 0 = walkable. Same indexing. */
  blocked: Uint8Array;
}

export interface BuildGridOptions {
  /** Blocks to treat as absent - the cell stays walkable ground, just not a service source. */
  excludeBlockIds?: ReadonlySet<string>;
  /** Cell indices to treat as impassable ground - used by the flood event. */
  blockedCells?: ReadonlySet<number>;
}

export function buildGrid(
  city: Pick<City, 'gridWidth' | 'gridHeight' | 'blocks'>,
  options: BuildGridOptions = {},
): EngineGrid {
  const { gridWidth: width, gridHeight: height, blocks } = city;
  const size = width * height;
  const typeIdAt = new Array<string | null>(size).fill(null);
  const blockIdAt = new Array<string | null>(size).fill(null);
  const blocked = new Uint8Array(size);

  for (const block of blocks) {
    if (block.x < 0 || block.y < 0 || block.x >= width || block.y >= height) continue;
    const at = block.y * width + block.x;
    if (options.excludeBlockIds?.has(block.id)) continue;
    typeIdAt[at] = block.typeId;
    blockIdAt[at] = block.id;
  }

  if (options.blockedCells) {
    for (const at of options.blockedCells) {
      if (at >= 0 && at < size) blocked[at] = 1;
    }
  }

  return { width, height, typeIdAt, blockIdAt, blocked };
}

export function cellIndex(grid: EngineGrid, x: number, y: number): number {
  return y * grid.width + x;
}

function inBounds(grid: EngineGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Small binary heap keyed by number - enough for Dijkstra on a grid. */
class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    let node = this.values.length - 1;
    while (node > 0) {
      const parent = (node - 1) >> 1;
      if ((this.keys[parent] as number) <= (this.keys[node] as number)) break;
      this.swap(node, parent);
      node = parent;
    }
  }

  pop(): number | undefined {
    if (this.values.length === 0) return undefined;
    const top = this.values[0] as number;
    const lastKey = this.keys.pop() as number;
    const lastValue = this.values.pop() as number;

    if (this.values.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let node = 0;
      for (;;) {
        const left = node * 2 + 1;
        const right = left + 1;
        let smallest = node;
        if (left < this.keys.length && (this.keys[left] as number) < (this.keys[smallest] as number)) {
          smallest = left;
        }
        if (right < this.keys.length && (this.keys[right] as number) < (this.keys[smallest] as number)) {
          smallest = right;
        }
        if (smallest === node) break;
        this.swap(node, smallest);
        node = smallest;
      }
    }

    return top;
  }

  private swap(a: number, b: number): void {
    const key = this.keys[a] as number;
    this.keys[a] = this.keys[b] as number;
    this.keys[b] = key;
    const value = this.values[a] as number;
    this.values[a] = this.values[b] as number;
    this.values[b] = value;
  }
}

export interface RouteField {
  /** Travel time in minutes from the nearest source, per cell. Infinity if unreached. */
  minutes: Float64Array;
  /** Cell index one step closer to the nearest source, or -1. */
  predecessor: Int32Array;
}

/**
 * Multi-source Dijkstra from every non-blocked cell whose typeIdAt === sourceTypeId.
 * One pass covers every housing block's distance to that service type at once.
 */
export function computeRouteField(grid: EngineGrid, sourceTypeId: string): RouteField {
  const size = grid.width * grid.height;
  const minutes = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const predecessor = new Int32Array(size).fill(-1);
  const queue = new MinHeap();

  for (let at = 0; at < size; at += 1) {
    if (grid.blocked[at]) continue;
    if (grid.typeIdAt[at] !== sourceTypeId) continue;
    minutes[at] = 0;
    queue.push(0, at);
  }

  while (queue.size > 0) {
    const at = queue.pop();
    if (at === undefined) break;
    const cost = minutes[at] as number;

    const x = at % grid.width;
    const y = Math.floor(at / grid.width);

    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(grid, nx, ny)) continue;

      const next = cellIndex(grid, nx, ny);
      if (grid.blocked[next]) continue;

      const stepCost = grid.typeIdAt[next] === 'transport' ? TRANSPORT_MINUTES : WALK_MINUTES;
      const candidate = cost + stepCost;

      if (candidate < (minutes[next] as number)) {
        minutes[next] = candidate;
        predecessor[next] = at;
        queue.push(candidate, next);
      }
    }
  }

  return { minutes, predecessor };
}

export interface ReconstructedRoute {
  reachable: boolean;
  minutes: number;
  /**
   * Placed-block ids only, in walk order. CitySceneApi.animateResident has no
   * coordinate-based waypoint API, so empty/grass cells on the route (which the Dijkstra
   * itself walks freely) are not addressable and are filtered out here - any other placed
   * block physically on the route (a transport corridor, another house) appears as a
   * waypoint in between.
   */
  pathBlockIds: string[];
  /**
   * Every cell walked, origin first, destination last - unlike pathBlockIds, this keeps
   * the empty/grass ground the route actually crosses. For drawing the route as a line
   * (Access mode's trace) rather than only flagging the placed blocks along it.
   */
  cellIndices: number[];
}

export function reconstructRoute(
  grid: EngineGrid,
  field: RouteField,
  originCellIndex: number,
): ReconstructedRoute {
  const minutes = field.minutes[originCellIndex] as number;
  if (!Number.isFinite(minutes)) {
    return {
      reachable: false,
      minutes: Number.POSITIVE_INFINITY,
      pathBlockIds: [],
      cellIndices: [],
    };
  }

  const cells: number[] = [];
  let cursor: number | undefined = originCellIndex;
  let guard = grid.width * grid.height + 1;

  while (cursor !== undefined && cursor !== -1 && guard > 0) {
    cells.push(cursor);
    const next: number = field.predecessor[cursor] ?? -1;
    cursor = next === -1 ? undefined : next;
    guard -= 1;
  }

  const pathBlockIds = cells
    .map((at) => grid.blockIdAt[at])
    .filter((id): id is string => id !== null);

  return { reachable: true, minutes, pathBlockIds, cellIndices: cells };
}
