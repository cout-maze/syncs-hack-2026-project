import type { BlockType, PlacedBlock } from '@rmc/shared';
import type { Cell } from '@/features/builder/scene/isometric';

/**
 * ===========================================================================
 * THE JOURNEY COST MODEL — § 7.1 of the feature proposal.
 * ===========================================================================
 *
 * Every accessibility claim the product makes ("27% of residents are more than
 * 15 minutes from healthcare") has to be arithmetic somebody can check, not a
 * number the UI asserts. This module is that arithmetic, and it is the only
 * place the constants live: runSimulation, the auto-proposal re-runs and the map
 * overlay all call in here.
 *
 * Pure. No React, no fetch, no mutation of the city.
 *
 *   Route          shortest four-directional path across the grid; no diagonals
 *   Walking        3 minutes per block
 *   Transport      a step that begins or ends on a transport block costs 1.5
 *   Persona        older ×1.5, wheelchair ×1.5, stroller ×1.25, everyone else ×1
 *   Blocked step   impassable cells fail the journey rather than slowing it
 *   Threshold      15 minutes to an essential service, unless the persona is
 *                  more sensitive (Persona.maxComfortableJourneyMinutes)
 */

export const MINUTES_PER_BLOCK = 3;
export const TRANSPORT_STEP_MINUTES = 1.5;
export const ESSENTIAL_ACCESS_MINUTES = 15;

/** How much longer the same route takes for residents who move less easily. */
export const PERSONA_SPEED_MULTIPLIERS: Record<string, number> = {
  older_resident: 1.5,
  wheelchair_user: 1.5,
  parent_stroller: 1.25,
};

export function speedMultiplier(personaId: string): number {
  return PERSONA_SPEED_MULTIPLIERS[personaId] ?? 1;
}

/**
 * Transport is the street network as well as a service, so residents route over it.
 * Every other building is solid: you walk around it, which is what makes a badly
 * placed cluster expensive.
 */
export const PASSABLE_BLOCK_TYPES = new Set(['transport']);

export interface JourneyStep {
  from: Cell;
  to: Cell;
  /** Cost of this leg after the persona multiplier — what the map labels. */
  minutes: number;
  /** True when the leg begins or ends on a transport block, i.e. the fast rate. */
  transport: boolean;
}

export interface JourneyPlan {
  personaId: string;
  /** Block-type id the resident is trying to reach. */
  targetService: string;
  origin: PlacedBlock;
  /** Null when the city has no reachable instance of `targetService`. */
  destination: PlacedBlock | null;
  /** Every cell on the route, origin first. One longer than `steps`. */
  cells: Cell[];
  steps: JourneyStep[];
  /** Legs walked at the full rate. */
  walkedSteps: number;
  /** Legs that touched a transport block. */
  transportSteps: number;
  multiplier: number;
  totalMinutes: number;
  thresholdMinutes: number;
  accessible: boolean;
  issues: string[];
  /** Placed blocks along the route — the shape `Journey.pathBlockIds` wants. */
  pathBlockIds: string[];
}

export interface PlanJourneyInput {
  blocks: PlacedBlock[];
  gridWidth: number;
  gridHeight: number;
  personaId: string;
  /** Falls back to the 15-minute essential-access threshold. */
  maxComfortableJourneyMinutes?: number;
  targetService: string;
  /** Start here instead of choosing an origin. */
  fromBlockId?: string;
  /**
   * Which housing block to report on when several exist.
   *
   * `best` answers "can this resident reach it at all". `worst` answers the
   * question accessibility actually turns on — whether *every* home is served —
   * and is what the map inspector shows, because a city is only as accessible
   * as the household it strands.
   */
  pick?: 'best' | 'worst';
}

const key = (cell: Cell) => `${cell.x},${cell.y}`;

/**
 * The cheapest journey from housing to `targetService`.
 *
 * Costs vary per step (transport legs are half price), so this is uniform-cost
 * search rather than a plain BFS — a longer route over transport can beat a
 * shorter one on foot, which is the whole point of putting transport down.
 */
export function planJourney(input: PlanJourneyInput): JourneyPlan | null {
  const { blocks, personaId } = input;

  const origins = input.fromBlockId
    ? blocks.filter((block) => block.id === input.fromBlockId)
    : blocks.filter((block) => block.typeId === 'housing');
  if (origins.length === 0) return null;

  const multiplier = speedMultiplier(personaId);
  const thresholdMinutes = input.maxComfortableJourneyMinutes ?? ESSENTIAL_ACCESS_MINUTES;

  const plans = origins.map((origin) =>
    planFrom({ ...input, origin, multiplier, thresholdMinutes }),
  );

  if (input.pick === 'worst') {
    // An unreachable service is the worst outcome there is, so it wins outright.
    const stranded = plans.find((plan) => !plan.destination);
    if (stranded) return stranded;
    return plans.reduce((worst, plan) => (plan.totalMinutes > worst.totalMinutes ? plan : worst));
  }

  const reachable = plans.filter((plan) => plan.destination);
  if (reachable.length === 0) return plans[0] ?? null;
  return reachable.reduce((best, plan) => (plan.totalMinutes < best.totalMinutes ? plan : best));
}

interface PlanFromInput extends PlanJourneyInput {
  origin: PlacedBlock;
  multiplier: number;
  thresholdMinutes: number;
}

function planFrom(input: PlanFromInput): JourneyPlan {
  const { blocks, gridWidth, gridHeight, origin, personaId, targetService } = input;
  const { multiplier, thresholdMinutes } = input;

  const blockAt = new Map<string, PlacedBlock>();
  for (const block of blocks) blockAt.set(key(block), block);

  const targets = blocks.filter((block) => block.typeId === targetService);
  const targetKeys = new Set(targets.map(key));

  const empty: JourneyPlan = {
    personaId,
    targetService,
    origin,
    destination: null,
    cells: [{ x: origin.x, y: origin.y }],
    steps: [],
    walkedSteps: 0,
    transportSteps: 0,
    multiplier,
    totalMinutes: 0,
    thresholdMinutes,
    accessible: false,
    issues: [],
    pathBlockIds: [origin.id],
  };

  if (targets.length === 0) {
    return { ...empty, issues: [`The city has no ${label(targetService)} to travel to.`] };
  }

  /** A cell can be entered if it is open ground, transport, or the destination itself. */
  const passable = (cell: Cell): boolean => {
    const block = blockAt.get(key(cell));
    if (!block) return true;
    if (PASSABLE_BLOCK_TYPES.has(block.typeId)) return true;
    return targetKeys.has(key(cell));
  };

  const isTransport = (cell: Cell): boolean =>
    blockAt.get(key(cell))?.typeId === 'transport';

  const start: Cell = { x: origin.x, y: origin.y };
  const cost = new Map<string, number>([[key(start), 0]]);
  const cameFrom = new Map<string, Cell>();
  // Small grids (10×10), so a re-sorted frontier is cheaper than a real heap.
  const frontier: Cell[] = [start];
  let reached: Cell | null = null;

  while (frontier.length > 0) {
    frontier.sort((a, b) => (cost.get(key(a)) ?? 0) - (cost.get(key(b)) ?? 0));
    const current = frontier.shift() as Cell;
    if (targetKeys.has(key(current)) && key(current) !== key(start)) {
      reached = current;
      break;
    }

    for (const next of neighbours(current, gridWidth, gridHeight)) {
      if (!passable(next)) continue;
      const stepCost = stepMinutes(current, next, isTransport) * multiplier;
      const nextCost = (cost.get(key(current)) ?? 0) + stepCost;
      if (nextCost >= (cost.get(key(next)) ?? Number.POSITIVE_INFINITY)) continue;
      cost.set(key(next), nextCost);
      cameFrom.set(key(next), current);
      frontier.push(next);
    }
  }

  if (!reached) {
    return {
      ...empty,
      issues: [
        `No route reaches ${label(targetService)} — every path is blocked by other buildings.`,
      ],
    };
  }

  const cells = tracePath(cameFrom, start, reached);
  const steps: JourneyStep[] = [];
  for (let i = 0; i < cells.length - 1; i += 1) {
    const from = cells[i] as Cell;
    const to = cells[i + 1] as Cell;
    const transport = isTransport(from) || isTransport(to);
    steps.push({
      from,
      to,
      minutes: stepMinutes(from, to, isTransport) * multiplier,
      transport,
    });
  }

  const totalMinutes = round(steps.reduce((sum, step) => sum + step.minutes, 0));
  const transportSteps = steps.filter((step) => step.transport).length;
  const destination = blockAt.get(key(reached)) ?? null;

  const issues: string[] = [];
  if (totalMinutes > thresholdMinutes) {
    issues.push(
      `${round(totalMinutes)} minutes to ${label(targetService)} — over the ${thresholdMinutes}-minute threshold.`,
    );
    if (transportSteps === 0) {
      issues.push('There is no transport anywhere on this route.');
    }
  }

  return {
    personaId,
    targetService,
    origin,
    destination,
    cells,
    steps,
    walkedSteps: steps.length - transportSteps,
    transportSteps,
    multiplier,
    totalMinutes,
    thresholdMinutes,
    accessible: totalMinutes <= thresholdMinutes,
    issues,
    pathBlockIds: cells
      .map((cell) => blockAt.get(key(cell))?.id)
      .filter((id): id is string => Boolean(id)),
  };
}

/** 1.5 minutes when the leg touches transport, otherwise the 3-minute walking rate. */
function stepMinutes(from: Cell, to: Cell, isTransport: (cell: Cell) => boolean): number {
  return isTransport(from) || isTransport(to) ? TRANSPORT_STEP_MINUTES : MINUTES_PER_BLOCK;
}

function neighbours(cell: Cell, gridWidth: number, gridHeight: number): Cell[] {
  const candidates: Cell[] = [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ];
  return candidates.filter(
    (next) => next.x >= 0 && next.y >= 0 && next.x < gridWidth && next.y < gridHeight,
  );
}

function tracePath(cameFrom: Map<string, Cell>, start: Cell, end: Cell): Cell[] {
  const path: Cell[] = [end];
  let current = end;
  while (key(current) !== key(start)) {
    const previous = cameFrom.get(key(current));
    if (!previous) break;
    path.push(previous);
    current = previous;
  }
  return path.reverse();
}

function round(minutes: number): number {
  return Math.round(minutes * 100) / 100;
}

function label(typeId: string): string {
  return typeId.replace(/_/g, ' ');
}

/**
 * The journey as arithmetic, for the panel under the map: nobody should have to
 * trust the total.
 *
 *   "8 walked × 3 min + 2 by transport × 1.5 min, × 1.5 older resident = 40.5 min"
 */
export function describeJourney(plan: JourneyPlan, blockTypes: BlockType[] = []): string {
  if (plan.steps.length === 0) return 'No route.';

  const parts = [`${plan.walkedSteps} walked × ${MINUTES_PER_BLOCK} min`];
  if (plan.transportSteps > 0) {
    parts.push(`${plan.transportSteps} by transport × ${TRANSPORT_STEP_MINUTES} min`);
  }

  const multiplierPart = plan.multiplier === 1 ? '' : `, × ${plan.multiplier}`;
  const service =
    blockTypes.find((type) => type.id === plan.targetService)?.name ?? label(plan.targetService);

  return `${parts.join(' + ')}${multiplierPart} = ${plan.totalMinutes} min to ${service.toLowerCase()}`;
}
