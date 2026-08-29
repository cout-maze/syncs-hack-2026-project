import { DEFAULT_BLOCK_BUDGET, DEFAULT_GRID_HEIGHT, DEFAULT_GRID_WIDTH } from './constants';
import type { BlockType, Persona, PlacedBlockInput } from './city';

/**
 * City generation.
 *
 * Lives in @rmc/shared on purpose: the mock backend, the real backend and the builder UI
 * all generate cities, and the same seed has to produce the same city in all three or the
 * demo stops being reproducible.
 *
 * The unusual constraint: we are NOT trying to generate a good city. A blank grid teaches
 * nothing and a well-planned grid teaches nothing either - Simulation mode only works if
 * the engine has something to complain about. So the generator builds a plausible city and
 * then deliberately breaks it, and each injected defect is meant to come back out of the
 * engine as an auto-issue.
 *
 * Six stages:
 *   1. seeded RNG                - same seed, same city, in every runtime
 *   2. district seeding          - blue-noise scatter, so neighbourhoods are spaced
 *   3. organic district growth   - frontier growth with a sprawl dial
 *   4. road network              - MST over districts + loops, routed by A*
 *   5. services and amenities    - p-median against a transport-aware distance field
 *   6. defect injection          - break one or two things, targeted at real personas
 *
 * Distances use the same model as the sim engine: walking a cell costs
 * `WALK_MINUTES`, crossing a transport block costs `TRANSPORT_MINUTES`. That means the
 * generator and the engine agree about what "far" means, and a defect can be verified
 * against a persona's `maxComfortableJourneyMinutes` before the engine ever runs.
 */

/** Journey model, shared with the sim engine's notion of travel time. */
export const WALK_MINUTES = 3;
export const TRANSPORT_MINUTES = 1;

/** Distance-field value for "you cannot get there". */
const UNREACHABLE = Number.POSITIVE_INFINITY;

/* --------------------------------------------------------------------- rng */

/** FNV-1a. Turns a seed phrase into the 32-bit state mulberry32 wants. */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 - small, fast, and identical across every JS runtime. */
function mulberry32(state: number) {
  let a = state;
  return function random(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T | undefined;
  shuffle<T>(items: T[]): T[];
  chance(probability: number): boolean;
}

function makeRng(seed: string): Rng {
  const random = mulberry32(hashSeed(seed));
  return {
    next: random,
    int: (maxExclusive) => Math.floor(random() * maxExclusive),
    range: (min, max) => min + random() * (max - min),
    pick: (items) => (items.length === 0 ? undefined : items[Math.floor(random() * items.length)]),
    shuffle: <T>(items: T[]) => {
      for (let at = items.length - 1; at > 0; at -= 1) {
        const swap = Math.floor(random() * (at + 1));
        const held = items[at] as T;
        items[at] = items[swap] as T;
        items[swap] = held;
      }
      return items;
    },
    chance: (probability) => random() < probability,
  };
}

/* ------------------------------------------------------------------- types */

export interface Cell {
  x: number;
  y: number;
}

export type DefectKind =
  | 'service_omitted'
  | 'service_displaced'
  | 'link_severed'
  | 'digital_substitute';

export interface InjectedDefect {
  kind: DefectKind;
  /** The block type the defect is about. */
  typeId: string;
  /** Persona this was aimed at, when the defect was targeted at someone specific. */
  personaId?: string;
  /** Plain language, for tests and for explaining why a generated city is bad. */
  description: string;
}

/** Named recipes, so two cities from two seeds do not look like the same city. */
export interface CityArchetype {
  id: string;
  name: string;
  /** Districts per 1000 cells. Drives how many neighbourhoods a grid gets. */
  districtDensity: number;
  /** 0 = compact and round, 1 = straggly and sprawling. */
  sprawl: number;
  /** Share of the block budget spent on housing. */
  housingShare: number;
  /** Fraction of neighbouring district pairs that actually get a road. */
  roadCoverage: number;
  /** Extra roads beyond the spanning tree, as a fraction of it. Creates loops. */
  roadRedundancy: number;
}

export const CITY_ARCHETYPES: CityArchetype[] = [
  {
    id: 'organic_town',
    name: 'Organic town',
    districtDensity: 8,
    sprawl: 0.6,
    housingShare: 0.45,
    roadCoverage: 1,
    roadRedundancy: 0.35,
  },
  {
    id: 'dense_core',
    name: 'Dense core',
    districtDensity: 4.5,
    sprawl: 0.2,
    housingShare: 0.52,
    roadCoverage: 1,
    roadRedundancy: 0.45,
  },
  {
    id: 'sprawl',
    name: 'Sprawl',
    districtDensity: 11,
    sprawl: 0.85,
    housingShare: 0.5,
    roadCoverage: 0.7,
    roadRedundancy: 0.1,
  },
  {
    id: 'divided',
    name: 'Divided city',
    districtDensity: 5,
    sprawl: 0.4,
    housingShare: 0.5,
    roadCoverage: 0.6,
    roadRedundancy: 0,
  },
];

export interface GenerateCityOptions {
  /** Anything stable. The same seed always produces the same city. */
  seed?: string;
  gridWidth?: number;
  gridHeight?: number;
  /** Defaults to one block of budget per grid cell, the ratio the 10x10 city uses. */
  blockBudget?: number;
  /** The catalog. Costs come from here, so generated cities always respect the budget. */
  blockTypes: BlockType[];
  /** Used to aim defects at someone specific and to verify they actually bite. */
  personas?: Persona[];
  /** Force a recipe. Omit to let the seed choose. */
  archetypeId?: string;
  /** How many flaws to inject. 0 builds the best city this generator knows how to build. */
  defects?: number;
  /**
   * Fraction of the budget to spend. Deliberately well under 1: auto-proposals need spare
   * budget to place a fix, and the user needs room to rebuild.
   */
  budgetUsage?: number;
}

export interface GeneratedCity {
  seed: string;
  archetype: CityArchetype;
  blocks: PlacedBlockInput[];
  /** What was broken on purpose. Empty when `defects: 0`. */
  defects: InjectedDefect[];
  /** Total catalog cost of `blocks`. */
  blockCost: number;
  /**
   * True when the distance field confirms at least one persona is now beyond its
   * comfortable journey time for a service it needs. Needs `personas` to mean anything.
   */
  verified: boolean;
}

/* ------------------------------------------------------------------- grid */

interface Grid {
  width: number;
  height: number;
  /** typeId per cell, or null. Indexed y * width + x. */
  cells: Array<string | null>;
}

function makeGrid(width: number, height: number): Grid {
  return { width, height, cells: new Array<string | null>(width * height).fill(null) };
}

const index = (grid: Grid, x: number, y: number) => y * grid.width + x;
const toCell = (grid: Grid, at: number): Cell => ({ x: at % grid.width, y: Math.floor(at / grid.width) });

function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

function typeAt(grid: Grid, x: number, y: number): string | null {
  if (!inBounds(grid, x, y)) return null;
  return grid.cells[index(grid, x, y)] ?? null;
}

function isFree(grid: Grid, x: number, y: number): boolean {
  return inBounds(grid, x, y) && grid.cells[index(grid, x, y)] === null;
}

function write(grid: Grid, x: number, y: number, typeId: string | null): void {
  if (inBounds(grid, x, y)) grid.cells[index(grid, x, y)] = typeId;
}

function cellsOf(grid: Grid, typeId: string): Cell[] {
  const found: Cell[] = [];
  for (let at = 0; at < grid.cells.length; at += 1) {
    if (grid.cells[at] === typeId) found.push(toCell(grid, at));
  }
  return found;
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function centroid(cells: Cell[]): Cell {
  if (cells.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    sumX += cell.x;
    sumY += cell.y;
  }
  return { x: Math.round(sumX / cells.length), y: Math.round(sumY / cells.length) };
}

/**
 * A rough compass name for a district, so a defect can say where it happened. Cities talk
 * about "the north-east", not "district 3".
 */
function districtName(cells: Cell[], width: number, height: number): string {
  const centre = centroid(cells);
  const vertical = centre.y < height / 3 ? 'northern' : centre.y > (height * 2) / 3 ? 'southern' : '';
  const horizontal = centre.x < width / 3 ? 'western' : centre.x > (width * 2) / 3 ? 'eastern' : '';

  if (vertical && horizontal) return `${vertical.replace('ern', '')}-${horizontal}`;
  return vertical || horizontal || 'central';
}

const STEPS: Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/* -------------------------------------------------------------- min-heap */

/** Small binary heap keyed by number. Enough for Dijkstra and A* on a grid. */
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

/* ------------------------------------------------------- distance field */

/**
 * Travel time in minutes from the nearest source to every cell, using the same model as
 * the sim engine: walking costs `WALK_MINUTES` per cell, crossing a transport block costs
 * `TRANSPORT_MINUTES`.
 *
 * Multi-source Dijkstra, so "how far is the nearest home from here" is one pass rather
 * than one pass per home. This replaces the Manhattan proxy an earlier version used - the
 * generator and the engine now measure distance the same way, which is what lets a defect
 * be checked against `maxComfortableJourneyMinutes`.
 */
function travelTimeField(grid: Grid, sources: Cell[]): number[] {
  const best = new Array<number>(grid.cells.length).fill(UNREACHABLE);
  const queue = new MinHeap();

  for (const source of sources) {
    if (!inBounds(grid, source.x, source.y)) continue;
    const at = index(grid, source.x, source.y);
    if (best[at] !== 0) {
      best[at] = 0;
      queue.push(0, at);
    }
  }

  while (queue.size > 0) {
    const at = queue.pop();
    if (at === undefined) break;
    const cost = best[at] as number;
    const here = toCell(grid, at);

    for (const step of STEPS) {
      const x = here.x + step.x;
      const y = here.y + step.y;
      if (!inBounds(grid, x, y)) continue;

      const next = index(grid, x, y);
      const stepCost = grid.cells[next] === 'transport' ? TRANSPORT_MINUTES : WALK_MINUTES;
      const candidate = cost + stepCost;

      if (candidate < (best[next] as number)) {
        best[next] = candidate;
        queue.push(candidate, next);
      }
    }
  }

  return best;
}

/* ------------------------------------------------------------ road routing */

/**
 * Route a road between two points with A*, preferring empty land and only cutting through
 * built-up cells when it has to.
 *
 * This is what makes the network look like roads rather than ruled lines: corridors bend
 * around neighbourhoods the way real ones do, instead of ploughing straight through, and
 * the terrain jitter gives them a slight wander so they do not read as ruled staircases.
 */
function routeRoad(grid: Grid, from: Cell, to: Cell, jitter: number[]): Cell[] {
  const start = index(grid, from.x, from.y);
  const goal = index(grid, to.x, to.y);

  const cost = new Array<number>(grid.cells.length).fill(UNREACHABLE);
  const cameFrom = new Array<number>(grid.cells.length).fill(-1);
  const queue = new MinHeap();

  cost[start] = 0;
  queue.push(manhattan(from, to), start);

  while (queue.size > 0) {
    const at = queue.pop();
    if (at === undefined) break;
    if (at === goal) break;

    const here = toCell(grid, at);
    for (const step of STEPS) {
      const x = here.x + step.x;
      const y = here.y + step.y;
      if (!inBounds(grid, x, y)) continue;

      const next = index(grid, x, y);
      const occupant = grid.cells[next];
      // Free land is cheap, an existing road is cheaper still to reuse, built-up land is a
      // detour. The per-cell jitter is what stops A* drawing ruled lines: identical costs
      // make the heuristic pick one straight staircase, and straight roads look generated.
      const terrain = occupant === null ? 1 : occupant === 'transport' ? 0.5 : 5;
      const candidate = (cost[at] as number) + terrain + (jitter[next] as number);

      if (candidate < (cost[next] as number)) {
        cost[next] = candidate;
        cameFrom[next] = at;
        queue.push(candidate + manhattan({ x, y }, to), next);
      }
    }
  }

  if ((cost[goal] as number) === UNREACHABLE) return [];

  const path: Cell[] = [];
  for (let at = goal; at !== -1; at = cameFrom[at] as number) {
    path.push(toCell(grid, at));
    if (at === start) break;
  }
  return path.reverse();
}

/* --------------------------------------------------- district placement */

/**
 * Blue-noise scatter (Mitchell's best-candidate): for each district, try a handful of
 * random spots and keep the one furthest from everything already placed.
 *
 * Plain random seeding clumps; a hard minimum separation fails to place anything on a
 * crowded grid. This degrades gracefully and spaces neighbourhoods the way a map does.
 */
function scatterDistrictSeeds(grid: Grid, count: number, rng: Rng): Cell[] {
  const seeds: Cell[] = [];
  const margin = Math.min(2, Math.floor(Math.min(grid.width, grid.height) / 6));

  for (let placed = 0; placed < count; placed += 1) {
    let best: Cell | null = null;
    let bestDistance = -1;

    const tries = 8 + placed * 2;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const candidate: Cell = {
        x: margin + rng.int(Math.max(1, grid.width - margin * 2)),
        y: margin + rng.int(Math.max(1, grid.height - margin * 2)),
      };

      const nearest = seeds.reduce(
        (closest, seed) => Math.min(closest, manhattan(seed, candidate)),
        Number.POSITIVE_INFINITY,
      );

      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }

    if (best) seeds.push(best);
  }

  return seeds;
}

/**
 * Grow a neighbourhood outward from a seed.
 *
 * The `sprawl` dial decides how the next cell comes off the frontier: at 0 it always takes
 * the cell nearest the seed, giving a tight round district; at 1 it takes any cell, giving
 * a straggly one. Anything in between reads as an organically grown neighbourhood rather
 * than either a circle or a noise blob.
 */
function growDistrict(grid: Grid, start: Cell, size: number, sprawl: number, rng: Rng): Cell[] {
  const claimed: Cell[] = [];
  const frontier: Cell[] = [start];

  // Real neighbourhoods are densest at their historic core and thin out toward the rim -
  // without this, region growth fills solid right up to a hard edge, which is what made
  // the map read as a filled-in blob rather than a place with a centre. The taper also
  // gives the renderer's height-by-local-density weighting (CityScene.housingDensity)
  // something real to respond to: a genuine core-to-edge gradient in the data, not just
  // noise painted on top of a uniform slab.
  // Tuned to give the rim a light fray rather than gut the district's interior - too
  // aggressive here reads as "mostly empty field with sparse dots", which is its own
  // kind of unrealistic. A real neighbourhood is mostly built; only its last ring thins.
  const coreRadius = Math.sqrt(size / Math.PI) * 0.72;
  const maxEdgeSkip = 0.28;

  while (claimed.length < size && frontier.length > 0) {
    let choice = 0;
    if (rng.chance(sprawl)) {
      choice = rng.int(frontier.length);
    } else {
      let nearest = Number.POSITIVE_INFINITY;
      for (let at = 0; at < frontier.length; at += 1) {
        const distance = manhattan(frontier[at] as Cell, start);
        if (distance < nearest) {
          nearest = distance;
          choice = at;
        }
      }
    }

    const cell = frontier.splice(choice, 1)[0];
    if (!cell || !isFree(grid, cell.x, cell.y)) continue;

    const distance = manhattan(cell, start);
    const skipChance = Math.max(
      0,
      Math.min(maxEdgeSkip, ((distance - coreRadius) / (coreRadius + 1)) * maxEdgeSkip),
    );

    // Grow the frontier through a skipped cell too - it keeps the gap open as a real
    // patch of land instead of a dead end, so the district still reaches its target size,
    // just spread thinner near the rim rather than packed solid.
    if (skipChance === 0 || !rng.chance(skipChance)) {
      write(grid, cell.x, cell.y, 'housing');
      claimed.push(cell);
    }

    for (const step of STEPS) {
      const next = { x: cell.x + step.x, y: cell.y + step.y };
      if (isFree(grid, next.x, next.y)) frontier.push(next);
    }
  }

  return claimed;
}

/* ------------------------------------------------------------ the generator */

const CITY_SERVICES = ['healthcare', 'education'] as const;
const LOCAL_AMENITIES = ['park', 'community_hub'] as const;

/**
 * Generate a city. Deterministic in `seed`, and scales from the 10x10 demo grid up to
 * large maps - district count, road length and service count all follow grid area.
 */
export function generateCity(options: GenerateCityOptions): GeneratedCity {
  const {
    seed = 'rebuild',
    gridWidth = DEFAULT_GRID_WIDTH,
    gridHeight = DEFAULT_GRID_HEIGHT,
    blockTypes,
    personas = [],
    archetypeId,
    defects: defectCount = 2,
    budgetUsage = 0.52,
  } = options;

  const area = gridWidth * gridHeight;
  // The product's own ratio: the 10x10 city gets a budget of 100.
  const blockBudget =
    options.blockBudget ??
    (area === DEFAULT_GRID_WIDTH * DEFAULT_GRID_HEIGHT ? DEFAULT_BLOCK_BUDGET : area);

  const rng = makeRng(seed);
  const grid = makeGrid(gridWidth, gridHeight);

  const archetype =
    CITY_ARCHETYPES.find((candidate) => candidate.id === archetypeId) ??
    rng.pick(CITY_ARCHETYPES) ??
    (CITY_ARCHETYPES[0] as CityArchetype);

  const costOf = (typeId: string) => blockTypes.find((type) => type.id === typeId)?.cost ?? 1;
  const known = (typeId: string) => blockTypes.some((type) => type.id === typeId);

  const cap = Math.floor(blockBudget * budgetUsage);
  let spent = 0;

  const place = (typeId: string, cell: Cell): boolean => {
    if (!known(typeId) || !isFree(grid, cell.x, cell.y)) return false;
    const cost = costOf(typeId);
    if (spent + cost > cap) return false;
    write(grid, cell.x, cell.y, typeId);
    spent += cost;
    return true;
  };

  const erase = (cell: Cell): void => {
    const typeId = typeAt(grid, cell.x, cell.y);
    if (!typeId) return;
    write(grid, cell.x, cell.y, null);
    spent -= costOf(typeId);
  };

  /* ---- stage 2 + 3: districts ----------------------------------------- */

  /** The journey time the most sensitive persona will tolerate. Drives placement and defects. */
  const strictestLimit = personas.reduce(
    (limit, persona) => Math.min(limit, persona.maxComfortableJourneyMinutes ?? limit),
    Number.POSITIVE_INFINITY,
  );
  const comfortLimit = Number.isFinite(strictestLimit)
    ? strictestLimit
    : Math.round(((gridWidth + gridHeight) / 2) * WALK_MINUTES * 0.4);

  const districtCount = Math.max(2, Math.round((area / 1000) * archetype.districtDensity));
  const seeds = scatterDistrictSeeds(grid, districtCount, rng);

  const housingBudget = Math.floor(cap * archetype.housingShare);
  const housingCost = costOf('housing');
  const averageDistrict = Math.max(3, Math.floor(housingBudget / housingCost / seeds.length));

  const districts: Cell[][] = [];
  for (const start of seeds) {
    // Vary the sizes - equal-sized neighbourhoods look generated.
    // Keep the random variation inside the remaining housing budget. Without this
    // guard, a large district could overspend the generation cap before services and
    // the final autosave validation ever saw the layout.
    const affordableHomes = Math.floor((cap - spent) / housingCost);
    if (affordableHomes <= 0) break;
    const size = Math.min(
      affordableHomes,
      Math.max(3, Math.round(averageDistrict * rng.range(0.55, 1.45))),
    );
    const claimed = growDistrict(grid, start, size, archetype.sprawl, rng);
    spent += claimed.length * housingCost;
    if (claimed.length > 0) districts.push(claimed);
  }

  // Carve courtyards and lanes out of the bigger districts. Region growth fills solid, and
  // a 9x9 slab of housing reads as a texture rather than a neighbourhood; punching holes in
  // the interior gives the internal open space real blocks have.
  for (let at = 0; at < districts.length; at += 1) {
    const district = districts[at] as Cell[];
    if (district.length < 12) continue;

    const kept: Cell[] = [];
    for (const cell of district) {
      const enclosed = STEPS.every(
        (step) => typeAt(grid, cell.x + step.x, cell.y + step.y) === 'housing',
      );
      if (enclosed && rng.chance(0.12)) {
        write(grid, cell.x, cell.y, null);
        spent -= housingCost;
      } else {
        kept.push(cell);
      }
    }
    districts[at] = kept;
  }

  const centres = districts.map(centroid);

  /* ---- stage 4: the road network -------------------------------------- */

  /**
   * Minimum spanning tree over the district centres (Prim), then a few extra edges.
   * A pure tree looks like a diagram; real networks have loops, so `roadRedundancy` adds
   * the shortest unused connections back in.
   */
  const edges: Array<[number, number]> = [];
  if (centres.length > 1) {
    const connected = new Set<number>([0]);
    while (connected.size < centres.length) {
      let bestEdge: [number, number] | null = null;
      let bestLength = Number.POSITIVE_INFINITY;

      for (const from of connected) {
        for (let to = 0; to < centres.length; to += 1) {
          if (connected.has(to)) continue;
          const length = manhattan(centres[from] as Cell, centres[to] as Cell);
          if (length < bestLength) {
            bestLength = length;
            bestEdge = [from, to];
          }
        }
      }

      if (!bestEdge) break;
      edges.push(bestEdge);
      connected.add(bestEdge[1]);
    }

    const extra = Math.round(edges.length * archetype.roadRedundancy);
    const spare: Array<{ edge: [number, number]; length: number }> = [];
    for (let from = 0; from < centres.length; from += 1) {
      for (let to = from + 1; to < centres.length; to += 1) {
        const already = edges.some(
          ([a, b]) => (a === from && b === to) || (a === to && b === from),
        );
        if (already) continue;
        spare.push({ edge: [from, to], length: manhattan(centres[from] as Cell, centres[to] as Cell) });
      }
    }
    spare.sort((a, b) => a.length - b.length);
    for (const candidate of spare.slice(0, extra)) edges.push(candidate.edge);
  }

  // Fixed per-cell road-building difficulty. Deterministic in the seed, so roads wander
  // the same way every time this city is generated.
  const roadJitter = Array.from({ length: grid.cells.length }, () => rng.range(0, 1.4));

  /** Roads actually laid, per edge - severing one later needs to know which cells. */
  const corridors: Cell[][] = [];
  for (const [from, to] of rng.shuffle([...edges])) {
    if (!rng.chance(archetype.roadCoverage)) continue;

    const route = routeRoad(grid, centres[from] as Cell, centres[to] as Cell, roadJitter);
    const laid: Cell[] = [];
    for (const cell of route) {
      if (place('transport', cell)) laid.push(cell);
    }
    if (laid.length > 0) corridors.push(laid);
  }

  /* ---- stage 5: services and amenities -------------------------------- */

  let housing = cellsOf(grid, 'housing');

  /**
   * p-median placement against the real travel-time field: put the service where it cuts
   * the most journey time for the most people, with a spread penalty so services do not
   * pile into the same block.
   */
  const placeByDemand = (typeId: string, placed: Cell[], spreadRadius: number): Cell | null => {
    const field = travelTimeField(grid, housing);
    // Services belong in the town, not in a field outside it. Without this ceiling the
    // spread penalty pushes each new service further into empty land than the last.
    const ceiling = comfortLimit * 1.5;
    let best: { cell: Cell; score: number } | null = null;

    for (let at = 0; at < grid.cells.length; at += 1) {
      if (grid.cells[at] !== null) continue;
      const cell = toCell(grid, at);
      const reach = field[at] as number;
      if (reach === UNREACHABLE || reach > ceiling) continue;

      const crowding = placed.reduce(
        (penalty, other) => penalty + Math.max(0, spreadRadius - manhattan(other, cell)) * 2,
        0,
      );
      const score = reach + crowding;

      if (!best || score < best.score) best = { cell, score };
    }

    if (best && place(typeId, best.cell)) return best.cell;
    return null;
  };

  const spreadRadius = Math.max(3, Math.round(Math.min(gridWidth, gridHeight) / 5));
  const placedServices: Cell[] = [];

  // Big shared services scale with the population they have to cover.
  const serviceRounds = Math.max(1, Math.round(housing.length / 40));
  for (let round = 0; round < serviceRounds; round += 1) {
    for (const service of CITY_SERVICES) {
      const cell = placeByDemand(service, placedServices, spreadRadius);
      if (cell) placedServices.push(cell);
    }
  }

  const techCount = Math.max(1, Math.round(housing.length / 120));
  for (let round = 0; round < techCount; round += 1) {
    const techCell = placeByDemand('technology_hub', placedServices, spreadRadius);
    if (techCell) placedServices.push(techCell);
  }

  // Local amenities belong to a neighbourhood, not to the city - one per district, placed
  // on its edge where there is room.
  for (const district of districts) {
    // One park or hub per ~25 homes, so a big neighbourhood is not served by a single
    // bench the way a hamlet is.
    const wanted = Math.max(1, Math.round(district.length / 25));

    const edgeCells: Cell[] = [];
    for (const cell of district) {
      for (const step of STEPS) {
        const next = { x: cell.x + step.x, y: cell.y + step.y };
        if (isFree(grid, next.x, next.y)) edgeCells.push(next);
      }
    }
    rng.shuffle(edgeCells);

    let placedHere = 0;
    for (const spot of edgeCells) {
      if (placedHere >= wanted) break;
      const amenity = rng.pick(LOCAL_AMENITIES);
      if (amenity && place(amenity, spot)) {
        placedServices.push(spot);
        placedHere += 1;
      }
    }
  }

  // Shared resources sit with the biggest district; heritage sits out on the edge, where
  // the city started.
  const largest = districts.slice().sort((a, b) => b.length - a.length)[0];
  if (largest) {
    const near = rng.pick(largest);
    if (near) {
      for (const step of rng.shuffle([...STEPS])) {
        if (place('shared_resource_hub', { x: near.x + step.x, y: near.y + step.y })) break;
      }
    }
  }

  // Heritage sits out where the city started. Taking the single furthest cell always
  // lands it in a corner, which looks generated - so pick from the outer ring instead.
  const townCentre = centroid(housing);
  const outskirts: Array<{ cell: Cell; distance: number }> = [];
  for (let at = 0; at < grid.cells.length; at += 1) {
    if (grid.cells[at] !== null) continue;
    const cell = toCell(grid, at);
    outskirts.push({ cell, distance: manhattan(cell, townCentre) });
  }
  outskirts.sort((a, b) => b.distance - a.distance);

  const heritageCount = Math.max(1, Math.round(area / 900));
  const ring = outskirts.slice(0, Math.max(4, Math.round(outskirts.length * 0.15)));
  for (let round = 0; round < heritageCount; round += 1) {
    const spot = rng.pick(ring);
    if (spot) place('culture_heritage', spot.cell);
  }

  /* ---- stage 5b: neighbourhood infill ------------------------------------------- */

  // The first district pass creates the city's recognisable centres. Infill should grow
  // those centres outward, not seed unrelated blobs across every empty plot: the latter
  // made a 30x30 city read as a carpet of buildings rather than neighbourhoods separated
  // by parks, verges and room for future growth.
  const MIN_COVERAGE = 0.42;
  const targetBuiltCells = Math.round(area * MIN_COVERAGE);
  let builtCells = grid.cells.reduce((sum, cell) => sum + (cell === null ? 0 : 1), 0);
  let infillAttempts = 0;

  // Keep a reserve for the player to improve the deliberately flawed layout. Infill stays
  // inside the ordinary generation cap; otherwise a city could quietly spend nearly its
  // entire budget just to fill visual gaps.
  const fixReserve = Math.max(10, Math.round(blockBudget * 0.05));
  const infillCap = Math.min(cap, blockBudget - fixReserve);

  while (builtCells < targetBuiltCells && spent < infillCap && infillAttempts < 500) {
    infillAttempts += 1;

    // Choose an empty plot immediately beside a real neighbourhood. This preserves
    // green corridors between districts and makes every new patch feel like an organic
    // extension of a place that already exists.
    const edgeSeeds: Cell[] = [];
    for (const district of districts) {
      for (const home of district) {
        for (const step of STEPS) {
          const candidate = { x: home.x + step.x, y: home.y + step.y };
          if (isFree(grid, candidate.x, candidate.y)) edgeSeeds.push(candidate);
        }
      }
    }
    const seedCell = rng.pick(edgeSeeds);
    if (!seedCell) break;

    // growDistrict fills space, not budget - it has no idea what a cell costs, so the
    // patch handed to it must already be capped to what remains, or a big patch on a
    // small remaining budget silently pushes the city over its budget.
    const affordable = Math.floor((infillCap - spent) / housingCost);
    if (affordable <= 0) break;
    const patchSize = Math.min(affordable, 6 + rng.int(10));

    const before = spent;
    const patch = growDistrict(grid, seedCell, patchSize, archetype.sprawl * 0.55, rng);
    if (patch.length === 0) continue;

    spent = before + patch.length * housingCost;
    districts.push(patch);
    builtCells += patch.length;
  }

  // Defects and their auto-fix suggestions are about the finished map - refresh the home
  // list so a persona's journey is checked against homes infill just added too.
  housing = cellsOf(grid, 'housing');

  /* ---- stage 6: break it on purpose ----------------------------------- */

  const injected: InjectedDefect[] = [];

  /** Is any persona now stranded from a service it needs? */
  const findStranded = (): { persona: Persona; service: string; minutes: number } | null => {
    if (personas.length === 0 || housing.length === 0) return null;

    for (const persona of personas) {
      const limit = persona.maxComfortableJourneyMinutes;
      if (!limit) continue;

      for (const service of persona.priorityServices) {
        const sites = cellsOf(grid, service);
        if (sites.length === 0) {
          return { persona, service, minutes: UNREACHABLE };
        }

        const field = travelTimeField(grid, sites);
        let worst = 0;
        for (const home of housing) {
          const minutes = field[index(grid, home.x, home.y)] as number;
          if (minutes > worst) worst = minutes;
        }
        if (worst > limit) return { persona, service, minutes: worst };
      }
    }
    return null;
  };

  /** Services someone actually needs, so a defect lands on something that matters. */
  const neededServices = new Set<string>();
  for (const persona of personas) {
    for (const service of persona.priorityServices) neededServices.add(service);
  }
  const targetable = (CITY_SERVICES as readonly string[]).filter(
    (service) => neededServices.size === 0 || neededServices.has(service),
  );

  /**
   * Two defects must not land on the same service, or the city ends up reporting that the
   * hospital is both missing and has been moved across town.
   */
  const spentServices = new Set<string>();
  const pickTarget = () => rng.pick(targetable.filter((service) => !spentServices.has(service)));

  /**
   * Defects are aimed at ONE neighbourhood, not the whole map.
   *
   * On a 10x10 "no healthcare anywhere" is a fair lesson; on a 30x30 it deletes six
   * hospitals and reads as a bug. Picking a victim district and stranding just that one
   * gives the realistic version - the north has a hospital, the south does not - and it is
   * the shape the engine reports anyway, as a group of failed journeys from one place.
   */
  const victim = rng.pick(districts.slice().sort((a, b) => b.length - a.length).slice(0, 3));
  const victimField = victim ? travelTimeField(grid, victim) : null;
  const victimName = victim ? districtName(victim, gridWidth, gridHeight) : 'one neighbourhood';

  const candidates: Array<{ severity: 'hard' | 'soft'; apply: () => InjectedDefect | null }> = [
    {
      // Push a service out past someone's comfortable journey time. Verified against the
      // travel-time field, so it is a real failure rather than a guess.
      severity: 'soft',
      apply: () => {
        if (!victim || !victimField) return null;
        const service = pickTarget();
        if (!service) return null;

        // The site currently serving the victim district is the one worth moving.
        const sites = cellsOf(grid, service);
        const serving = sites
          .slice()
          .sort(
            (a, b) =>
              (victimField[index(grid, a.x, a.y)] as number) -
              (victimField[index(grid, b.x, b.y)] as number),
          )[0];
        if (!serving) return null;

        // Somewhere out of that district's reach but still near the rest of the city -
        // "the hospital is on the other side of town", not "the hospital is in a field".
        const cityField = travelTimeField(grid, housing);
        const options: Cell[] = [];
        for (let at = 0; at < grid.cells.length; at += 1) {
          if (grid.cells[at] !== null) continue;
          const fromVictim = victimField[at] as number;
          const fromAnyone = cityField[at] as number;
          if (fromVictim > comfortLimit && fromAnyone <= comfortLimit) {
            options.push(toCell(grid, at));
          }
        }

        const target = rng.pick(options);
        if (!target) return null;

        erase(serving);
        write(grid, target.x, target.y, service);
        spent += costOf(service);

        const stranded = personas.find((persona) => persona.priorityServices.includes(service));

        return {
          kind: 'service_displaced',
          typeId: service,
          personaId: stranded?.id,
          description: `The ${victimName} neighbourhood's ${service.replace(/_/g, ' ')} was moved across town to (${target.x}, ${target.y}), out of walking range.`,
        };
      },
    },
    {
      // Cut a road corridor, stranding whatever it connected.
      severity: 'soft',
      apply: () => {
        const corridor = rng.pick(corridors.filter((cells) => cells.length > 1));
        if (!corridor) return null;
        for (const cell of corridor) erase(cell);

        return {
          kind: 'link_severed',
          typeId: 'transport',
          description:
            corridor.length === 1
              ? 'The single road between two neighbourhoods is missing.'
              : `A road between neighbourhoods was never built - ${corridor.length} connecting blocks are missing.`,
        };
      },
    },
    {
      // Drop a service entirely: nothing to reach, so every journey to it fails.
      severity: 'hard',
      apply: () => {
        const service = pickTarget();
        if (!service) return null;
        const sites = cellsOf(grid, service);
        if (sites.length === 0) return null;

        // Small map: there is only one of these, so losing it means losing the service.
        // Large map: strip only the sites that were serving the victim district, leaving a
        // service desert in one neighbourhood rather than deleting the service citywide.
        const doomed =
          sites.length <= 2 || !victimField
            ? sites
            : sites.filter((cell) => (victimField[index(grid, cell.x, cell.y)] as number) <= comfortLimit);
        if (doomed.length === 0) return null;

        for (const cell of doomed) erase(cell);

        const stranded = personas.find((persona) => persona.priorityServices.includes(service));
        const label = service.replace(/_/g, ' ');

        return {
          kind: 'service_omitted',
          typeId: service,
          personaId: stranded?.id,
          description:
            doomed.length === sites.length
              ? `The city has no ${label} at all.`
              : `The ${victimName} neighbourhood has no ${label} within reach.`,
        };
      },
    },
    {
      // Swap a physical service for a digital one: fine for most people, a wall for anyone
      // who cannot use it.
      severity: 'hard',
      apply: () => {
        if (spentServices.has('education')) return null;
        const sites = cellsOf(grid, 'education');
        const existing = sites[0];
        if (!existing || !known('technology_hub')) return null;
        erase(existing);
        if (!place('technology_hub', existing)) return null;

        const stranded = personas.find((persona) =>
          persona.accessibilityNeeds?.some((need) => need.includes('digital')),
        );

        return {
          kind: 'digital_substitute',
          typeId: 'education',
          personaId: stranded?.id ?? 'limited_digital_access',
          description:
            'An education block was replaced by a technology hub - unusable for residents with limited digital access.',
        };
      },
    },
  ];

  let hardUsed = false;
  for (const candidate of rng.shuffle([...candidates])) {
    if (injected.length >= defectCount) break;
    if (candidate.severity === 'hard' && hardUsed) continue;

    const defect = candidate.apply();
    if (!defect || injected.some((other) => other.kind === defect.kind)) continue;

    injected.push(defect);
    spentServices.add(defect.typeId);
    if (candidate.severity === 'hard') hardUsed = true;
  }

  /* ---- result ---------------------------------------------------------- */

  const blocks: PlacedBlockInput[] = [];
  for (let at = 0; at < grid.cells.length; at += 1) {
    const typeId = grid.cells[at];
    if (typeId) {
      const cell = toCell(grid, at);
      blocks.push({ typeId, x: cell.x, y: cell.y });
    }
  }

  return {
    seed,
    archetype,
    blocks,
    defects: injected,
    blockCost: blocks.reduce((sum, block) => sum + costOf(block.typeId), 0),
    verified: findStranded() !== null,
  };
}

/* ------------------------------------------------------- rejection sampling */

/**
 * Generate a city the simulation actually finds fault with.
 *
 * `generateCity` verifies its own defects against the travel-time field, but only the real
 * engine knows whether a journey fails for the reasons the engine cares about. This
 * re-rolls the seed until it does, and falls back to the closest attempt rather than
 * looping forever.
 *
 * Call it with the engine as `simulate` - @rmc/shared cannot import the engine itself,
 * which lives in the browser next to Phaser.
 */
export function generateFlawedCity<T>(
  options: GenerateCityOptions & {
    simulate: (blocks: PlacedBlockInput[]) => T;
    /** Default: at least one journey must fail. */
    isFlawed?: (result: T) => boolean;
    attempts?: number;
  },
): GeneratedCity & { simulation: T | null } {
  const { simulate, isFlawed, attempts = 8, seed = 'rebuild' } = options;
  const accept =
    isFlawed ??
    ((result: T) => {
      const journeys = (result as { journeys?: Array<{ accessible: boolean }> }).journeys ?? [];
      return journeys.some((journey) => !journey.accessible);
    });

  let fallback: (GeneratedCity & { simulation: T | null }) | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const city = generateCity({ ...options, seed: `${seed}#${attempt}` });

    let simulation: T | null = null;
    try {
      simulation = simulate(city.blocks);
    } catch {
      // Engine not available (or not built yet) - hand back the city unverified.
      return { ...city, simulation: null };
    }

    const candidate = { ...city, simulation };
    if (accept(simulation)) return candidate;
    fallback ??= candidate;
  }

  return fallback ?? { ...generateCity(options), simulation: null };
}
