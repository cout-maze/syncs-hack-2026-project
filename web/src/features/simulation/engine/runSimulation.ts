import type {
  BlockType,
  City,
  EventResult,
  Metrics,
  Persona,
  PlacedBlock,
  SimulationResultInput,
} from '@rmc/shared';

/**
 * The simulation is deliberately a small, explainable grid model. It is pure and
 * browser-only: the API stores its result but never computes one.
 */
export const ENGINE_VERSION = '0.2.0';

export interface RunSimulationInput {
  city: City;
  personas: Persona[];
  blockTypes: BlockType[];
}

type Cell = { x: number; y: number };
type Route = { cells: Cell[]; minutes: number; transportCount: number };

const DIRECTIONS: Cell[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const keyFor = (cell: Cell) => `${cell.x},${cell.y}`;

function blockMap(blocks: PlacedBlock[]): Map<string, PlacedBlock> {
  return new Map(blocks.map((block) => [keyFor(block), block]));
}

function blockTypeMap(blockTypes: BlockType[]): Map<string, BlockType> {
  return new Map(blockTypes.map((block) => [block.id, block]));
}

function inBounds(city: City, cell: Cell): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < city.gridWidth && cell.y < city.gridHeight;
}

function routeBetween(
  city: City,
  blocks: Map<string, PlacedBlock>,
  from: Cell,
  to: Cell,
  blocked: Set<string>,
): Route | null {
  if (
    !inBounds(city, from) ||
    !inBounds(city, to) ||
    blocked.has(keyFor(from)) ||
    blocked.has(keyFor(to))
  ) {
    return null;
  }

  // Dijkstra keeps the route explainable while preferring transport cells: walking
  // across an ordinary cell costs two minutes, entering transport costs one.
  const distances = new Map<string, number>([[keyFor(from), 0]]);
  const previous = new Map<string, string>();
  const open: Array<{ cell: Cell; distance: number }> = [{ cell: from, distance: 0 }];

  while (open.length > 0) {
    open.sort((a, b) => a.distance - b.distance);
    const current = open.shift();
    if (!current) break;
    const currentKey = keyFor(current.cell);
    if (current.distance !== distances.get(currentKey)) continue;
    if (currentKey === keyFor(to)) break;

    for (const direction of DIRECTIONS) {
      const next = { x: current.cell.x + direction.x, y: current.cell.y + direction.y };
      const nextKey = keyFor(next);
      if (!inBounds(city, next) || blocked.has(nextKey)) continue;

      const stepCost = blocks.get(nextKey)?.typeId === 'transport' ? 1 : 2;
      const nextDistance = current.distance + stepCost;
      if (nextDistance >= (distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(nextKey, nextDistance);
      previous.set(nextKey, currentKey);
      open.push({ cell: next, distance: nextDistance });
    }
  }

  const targetKey = keyFor(to);
  if (!distances.has(targetKey)) return null;

  const cells: Cell[] = [];
  let cursor = targetKey;
  while (cursor !== keyFor(from)) {
    const [xText, yText] = cursor.split(',');
    const x = Number(xText);
    const y = Number(yText);
    cells.push({ x, y });
    const parent = previous.get(cursor);
    if (!parent) return null;
    cursor = parent;
  }
  cells.push(from);
  cells.reverse();

  const transportCount = cells.filter((cell) => blocks.get(keyFor(cell))?.typeId === 'transport').length;
  return { cells, minutes: distances.get(targetKey) ?? 0, transportCount };
}

function shortestServiceRoute(
  city: City,
  blocks: Map<string, PlacedBlock>,
  from: PlacedBlock,
  serviceBlocks: PlacedBlock[],
  blocked: Set<string>,
): Route | null {
  let best: Route | null = null;
  for (const service of serviceBlocks) {
    const route = routeBetween(city, blocks, from, service, blocked);
    if (route && (!best || route.minutes < best.minutes)) best = route;
  }
  return best;
}

function serviceName(typeId: string): string {
  return typeId.replace(/_/g, ' ');
}

function routeBlockIds(route: Route | null, blocks: Map<string, PlacedBlock>): string[] {
  if (!route) return [];
  return route.cells
    .map((cell) => blocks.get(keyFor(cell))?.id)
    .filter((id): id is string => Boolean(id));
}

function runJourneys(
  city: City,
  personas: Persona[],
  blocks: Map<string, PlacedBlock>,
  blocked: Set<string> = new Set(),
) {
  const housing = city.blocks.filter((block) => block.typeId === 'housing');
  const journeys: SimulationResultInput['journeys'] = [];

  for (const persona of personas) {
    for (const home of housing) {
      for (const targetService of persona.priorityServices) {
        const serviceBlocks = city.blocks.filter((block) => block.typeId === targetService);
        const journeyBase = {
          personaId: persona.id,
          fromBlockId: home.id,
          targetService,
        };

        if (serviceBlocks.length === 0) {
          journeys.push({
            ...journeyBase,
            pathBlockIds: [home.id],
            travelTimeMinutes: persona.maxComfortableJourneyMinutes ?? 15,
            accessible: false,
            issues: [`No ${serviceName(targetService)} block is available.`],
          });
          continue;
        }

        const route = shortestServiceRoute(city, blocks, home, serviceBlocks, blocked);
        if (!route) {
          journeys.push({
            ...journeyBase,
            pathBlockIds: [home.id],
            travelTimeMinutes: persona.maxComfortableJourneyMinutes ?? 15,
            accessible: false,
            issues: [`No route reaches ${serviceName(targetService)} from this housing block.`],
          });
          continue;
        }

        const issues: string[] = [];
        const limit = persona.maxComfortableJourneyMinutes;
        if (limit !== undefined && route.minutes > limit) {
          issues.push(
            `The best route takes ${route.minutes} minutes; this resident's comfortable limit is ${limit}.`,
          );
        }

        const needsTransport = persona.accessibilityNeeds.some((need) =>
          ['accessible_transport', 'step_free_routes'].includes(need),
        );
        if (needsTransport && route.minutes > 6 && route.transportCount === 0) {
          issues.push('The route has no accessible transport connection.');
        }

        if (persona.id === 'limited_digital_access' && targetService === 'technology_hub') {
          issues.push('A technology hub cannot replace an in-person service for this resident.');
        }

        journeys.push({
          ...journeyBase,
          pathBlockIds: routeBlockIds(route, blocks),
          travelTimeMinutes: route.minutes,
          accessible: issues.length === 0,
          issues,
        });
      }
    }
  }

  return journeys;
}

function averageJourneyMinutes(journeys: SimulationResultInput['journeys']): number {
  if (journeys.length === 0) return 0;
  return journeys.reduce((sum, journey) => sum + journey.travelTimeMinutes, 0) / journeys.length;
}

function deriveMetrics(
  city: City,
  journeys: SimulationResultInput['journeys'],
  events: EventResult[],
  types: Map<string, BlockType>,
): Metrics {
  const accessibleRatio = journeys.length
    ? journeys.filter((journey) => journey.accessible).length / journeys.length
    : 0.5;
  const averageMinutes = averageJourneyMinutes(journeys);
  const maxReasonableMinutes = Math.max(10, (city.gridWidth + city.gridHeight) * 2);
  const serviceCount = city.blocks.filter((block) => types.get(block.typeId)?.category === 'service').length;
  const greenCount = city.blocks.filter((block) => block.typeId === 'park').length;
  const communityCount = city.blocks.filter((block) =>
    ['park', 'community_hub', 'culture_heritage'].includes(block.typeId),
  ).length;
  const transportCount = city.blocks.filter((block) => block.typeId === 'transport').length;
  const techCount = city.blocks.filter((block) => block.typeId === 'technology_hub').length;
  const failedEvents = events.filter((event) => !event.passed).length;
  const budgetUse = city.blockBudget > 0 ? city.blocksUsed / city.blockBudget : 1;

  return {
    accessibility: round1(clamp(accessibleRatio * 100)),
    sustainability: round1(clamp(45 + greenCount * 12 + communityCount * 3 - budgetUse * 10)),
    efficiency: round1(clamp(100 - (averageMinutes / maxReasonableMinutes) * 100 + transportCount * 3)),
    community: round1(clamp(35 + communityCount * 10 + accessibleRatio * 25)),
    resilience: round1(clamp(72 - failedEvents * 22 + transportCount * 3)),
    inclusion: round1(clamp(38 + accessibleRatio * 42 + techCount * 4 + serviceCount * 2)),
  };
}

function floodEvent(city: City, blocks: Map<string, PlacedBlock>, personas: Persona[]) {
  const floodLine = Math.max(0, city.gridHeight - 2);
  const affected = city.blocks.filter((block) => block.y >= floodLine);
  const blocked = new Set(affected.map((block) => keyFor(block)));
  const after = runJourneys(city, personas, blocks, blocked);
  const affectedPersonaIds = [
    ...new Set(after.filter((journey) => !journey.accessible).map((journey) => journey.personaId)),
  ];
  const passed = affected.length === 0 || affectedPersonaIds.length === 0;
  return {
    event: {
      eventType: 'flood' as const,
      passed,
      affectedBlockIds: affected.map((block) => block.id),
      affectedPersonaIds,
      summary: passed
        ? 'Flood test passed: essential routes remained accessible.'
        : `Flooding the southern edge disrupted access for ${affectedPersonaIds.length} resident group${affectedPersonaIds.length === 1 ? '' : 's'}.`,
    },
    after,
  };
}

function technologyOutage(city: City, personas: Persona[]) {
  const technologyBlocks = city.blocks.filter((block) => block.typeId === 'technology_hub');
  const affectedPersonaIds = personas
    .filter((persona) => persona.priorityServices.includes('technology_hub'))
    .map((persona) => persona.id);
  const alternative = city.blocks.some((block) =>
    ['community_hub', 'shared_resource_hub'].includes(block.typeId),
  );
  const passed = technologyBlocks.length === 0 || affectedPersonaIds.length === 0 || alternative;
  return {
    event: {
      eventType: 'tech_outage' as const,
      passed,
      affectedBlockIds: technologyBlocks.map((block) => block.id),
      affectedPersonaIds: passed ? [] : affectedPersonaIds,
      summary: passed
        ? 'Technology outage test passed: in-person alternatives can keep residents connected.'
        : `A technology outage would affect ${affectedPersonaIds.length} resident group${affectedPersonaIds.length === 1 ? '' : 's'} without an in-person alternative.`,
    },
  };
}

export function runSimulation({ city, personas, blockTypes }: RunSimulationInput): SimulationResultInput {
  const blocks = blockMap(city.blocks);
  const types = blockTypeMap(blockTypes);
  const journeys = runJourneys(city, personas, blocks);
  const flood = floodEvent(city, blocks, personas);
  const outage = technologyOutage(city, personas);
  const events: EventResult[] = [flood.event, outage.event];

  return {
    metrics: deriveMetrics(city, journeys, events, types),
    journeys,
    events,
    engineVersion: ENGINE_VERSION,
  };
}
