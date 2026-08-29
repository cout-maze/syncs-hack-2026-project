import { WALK_MINUTES } from '@rmc/shared';
import type { City, Journey, Persona } from '@rmc/shared';
import { buildGrid, cellIndex, computeRouteField, reconstructRoute } from './grid';
import { COMFORTABLE_MINUTES, GENERIC_RESIDENT_ID, SERVICE_TYPE_IDS, UNREACHABLE_MINUTES } from './constants';

/**
 * ===========================================================================
 * The simulation engine's journey computation.
 * ===========================================================================
 *
 * The simulation journey path is persona-aware: one Journey per (housing block x persona x
 * priority service), with the persona's comfortable limit and accessibility needs applied.
 * Access mode also uses the generic `computeJourneys` helper below for one home's route to
 * every service in the catalog. See runSimulation.ts for the full design rationale.
 *
 * Efficient by construction: one Dijkstra pass per distinct service type, reused across
 * every housing block and persona lookup, rather than one pass per house.
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
 * Compute the journeys the simulation itself reports: one route for every persona,
 * housing block and service in that persona's priority list. The generic
 * `computeJourneys` above remains available to Access mode, which intentionally asks
 * for one home's travel time to every service in the catalog.
 */
export function computePersonaJourneys(
  city: Pick<City, 'gridWidth' | 'gridHeight' | 'blocks'>,
  personas: Persona[],
  options: ComputeJourneysOptions = {},
): Journey[] {
  const grid = buildGrid(city, options);
  const housing = city.blocks.filter(
    (block) =>
      !options.excludeBlockIds?.has(block.id) &&
      grid.typeIdAt[cellIndex(grid, block.x, block.y)] === 'housing',
  );

  if (housing.length === 0 || personas.length === 0) return [];

  const serviceIds = [
    ...new Set(
      personas.flatMap((persona) =>
        persona.priorityServices.filter((service) => {
          // A digital-access resident needs in-person alternatives; a technology hub
          // cannot satisfy that persona's service journey.
          return !(persona.id === 'limited_digital_access' && service === 'technology_hub');
        }),
      ),
    ),
  ];
  const routeFields = new Map(
    serviceIds.map((service) => [service, computeRouteField(grid, service)]),
  );

  const journeys: Journey[] = [];
  for (const home of housing) {
    const origin = cellIndex(grid, home.x, home.y);
    for (const persona of personas) {
      for (const service of persona.priorityServices) {
        if (persona.id === 'limited_digital_access' && service === 'technology_hub') continue;
        const field = routeFields.get(service);
        if (!field) continue;
        journeys.push(makePersonaJourney(persona, home.id, service, reconstructRoute(grid, field, origin), grid));
      }
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

function makePersonaJourney(
  persona: Persona,
  fromBlockId: string,
  targetService: string,
  route: ReturnType<typeof reconstructRoute>,
  grid: ReturnType<typeof buildGrid>,
): Journey {
  if (!route.reachable) {
    return {
      personaId: persona.id,
      fromBlockId,
      targetService,
      pathBlockIds: [],
      travelTimeMinutes: UNREACHABLE_MINUTES,
      accessible: false,
      issues: [`No ${targetService.replace(/_/g, ' ')} anywhere in the city.`],
    };
  }

  const issues: string[] = [];
  const comfortableLimit = persona.maxComfortableJourneyMinutes;
  if (comfortableLimit !== undefined && route.minutes > comfortableLimit) {
    issues.push(
      `${Math.round(route.minutes)} min to the nearest ${targetService.replace(/_/g, ' ')} - over the ${comfortableLimit} min comfortable limit.`,
    );
  }

  // A wheelchair journey can use ordinary ground for a short local trip, but a longer
  // route needs a transport connection. This keeps the rule visible and deterministic
  // without inventing a separate road graph.
  const requiresTransport =
    persona.id === 'wheelchair_user' && route.minutes > WALK_MINUTES * 3;
  const hasTransport = route.cellIndices.some((at) => grid.typeIdAt[at] === 'transport');
  if (requiresTransport && !hasTransport) {
    issues.push('This longer route has no transport connection for a wheelchair user.');
  }

  return {
    personaId: persona.id,
    fromBlockId,
    targetService,
    pathBlockIds: route.pathBlockIds,
    travelTimeMinutes: Math.round(route.minutes * 10) / 10,
    accessible: issues.length === 0,
    issues,
  };
}
