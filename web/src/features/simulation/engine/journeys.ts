import type { City, Journey } from '@rmc/shared';
import { buildGrid, cellIndex, computeRouteField, reconstructRoute } from './grid';
import { COMFORTABLE_MINUTES, GENERIC_RESIDENT_ID, SERVICE_TYPE_IDS, UNREACHABLE_MINUTES } from './constants';

/**
 * ===========================================================================
 * The simulation engine's journey computation.
 * ===========================================================================
 *
 * There is no persona here. A journey is one house's travel time to the nearest instance
 * of one service type - not a named resident type's trip. One Journey per (housing block
 * x service type): every house, checked against every one of the 8 non-housing block
 * types the same way. See runSimulation.ts for the full design rationale.
 *
 * Efficient by construction: one Dijkstra pass per distinct service type (8, fixed),
 * reused across every housing block's lookup, rather than one pass per house.
 */

export interface ComputeJourneysOptions {
  /** Blocks to treat as absent - used by the tech_outage event. */
  excludeBlockIds?: ReadonlySet<string>;
  /** Cells to treat as impassable ground - used by the flood event. */
  blockedCells?: ReadonlySet<number>;
}

export function computeJourneys(
  city: Pick<City, 'gridWidth' | 'gridHeight' | 'blocks'>,
  options: ComputeJourneysOptions = {},
): Journey[] {
  const grid = buildGrid(city, options);
  const housing = city.blocks.filter(
    (block) => !options.excludeBlockIds?.has(block.id) && grid.typeIdAt[cellIndex(grid, block.x, block.y)] === 'housing',
  );

  if (housing.length === 0) return [];

  const routeFields = new Map(SERVICE_TYPE_IDS.map((service) => [service, computeRouteField(grid, service)]));

  const journeys: Journey[] = [];
  for (const home of housing) {
    const origin = cellIndex(grid, home.x, home.y);
    for (const service of SERVICE_TYPE_IDS) {
      const field = routeFields.get(service);
      if (!field) continue;
      journeys.push(makeJourney(home.id, service, reconstructRoute(grid, field, origin)));
    }
  }

  return journeys;
}

/**
 * The one route a single home walks to reach one service, as ground cells rather than
 * Journey's block-only path - for Access mode's trace line, which has to cross empty
 * ground and not just jump between buildings. Null if the home doesn't exist or nothing
 * of that service is reachable.
 */
export function computeRouteCells(
  city: Pick<City, 'gridWidth' | 'gridHeight' | 'blocks'>,
  homeBlockId: string,
  targetService: string,
): Array<{ x: number; y: number }> | null {
  const home = city.blocks.find((block) => block.id === homeBlockId);
  if (!home) return null;

  const grid = buildGrid(city);
  const field = computeRouteField(grid, targetService);
  const route = reconstructRoute(grid, field, cellIndex(grid, home.x, home.y));
  if (!route.reachable) return null;

  return route.cellIndices.map((at) => ({ x: at % grid.width, y: Math.floor(at / grid.width) }));
}

function makeJourney(
  fromBlockId: string,
  targetService: string,
  route: ReturnType<typeof reconstructRoute>,
): Journey {
  if (!route.reachable) {
    return {
      personaId: GENERIC_RESIDENT_ID,
      fromBlockId,
      targetService,
      pathBlockIds: [],
      travelTimeMinutes: UNREACHABLE_MINUTES,
      accessible: false,
      issues: [`No ${targetService.replace(/_/g, ' ')} anywhere in the city.`],
    };
  }

  const accessible = route.minutes <= COMFORTABLE_MINUTES;

  return {
    personaId: GENERIC_RESIDENT_ID,
    fromBlockId,
    targetService,
    pathBlockIds: route.pathBlockIds,
    travelTimeMinutes: Math.round(route.minutes * 10) / 10,
    accessible,
    issues: accessible
      ? []
      : [
          `${Math.round(route.minutes)} min to the nearest ${targetService.replace(/_/g, ' ')} - over the ${COMFORTABLE_MINUTES} min comfortable limit.`,
        ],
  };
}
