import type { BlockType, City, Persona, SimulationResultInput } from '@rmc/shared';
import { computePersonaJourneys } from './journeys';
import { runFloodEvent, runTechOutageEvent } from './events';
import { computeMetrics } from './metrics';

/**
 * ===========================================================================
 * The client-side simulation engine. The critical path for Simulation mode.
 * ===========================================================================
 *
 * The engine runs in the browser (a deliberate architecture decision - see
 * docs/00-architecture-overview.md). The backend never computes a result; it only
 * stores what this function produces.
 *
 * Contract:
 *   - Pure. No React, no fetch, no mutation of `city`. BUILD and TEST stay separate.
 *   - The return value must satisfy `SimulationResultInputSchema` from @rmc/shared,
 *     because it is PUT to `/cities/{id}/simulation` and sent to the Advisor verbatim.
 *
 * PERSONA-AWARE. For every housing block, the engine follows each persona to the services
 * in that persona's priority list, applies the persona's comfortable journey limit, and
 * enforces the accessibility rules that are meaningful in this grid model. Access mode
 * deliberately uses the generic helper in engine/journeys.ts for an exploratory home-to-
 * service lookup, but persisted SimulationResult journeys name the persona they represent.
 *
 * What it produces:
 *
 *   1. Journeys (engine/journeys.ts) - one per (housing block x persona x priority service),
 *      via a multi-source Dijkstra per distinct service type (engine/grid.ts), reused across
 *      every housing block and persona lookup. Transport blocks reduce travel time. `pathBlockIds` drives the map
 *      animation through CitySceneApi.animateResident() - filtered to placed-block cells
 *      only, since the scene has no coordinate-based waypoint API.
 *
 *   2. Metrics (engine/metrics.ts) - six 0-100 scores, each a one-sentence formula over
 *      the journeys and the layout.
 *
 *   3. Events (engine/events.ts) - `flood` (bands the middle of the grid as impassable,
 *      re-derives journeys, tests resilience) and `tech_outage` (excludes technology_hub
 *      blocks as a service source, tests inclusion). `population_change` stays out of
 *      scope - the docs mark it optional and nothing depends on it.
 *
 * The journey count scales with homes and persona needs, while the route fields remain
 * shared per service type. See docs/02-fe2-simulation-mode.md.
 */

/** Bump when the formulas change; it is stored alongside each result. */
export const ENGINE_VERSION = '1.0.0';

export interface RunSimulationInput {
  city: City;
  /** Resident need profiles that define the journeys the simulation reports. */
  personas: Persona[];
  /** Accepted for interface stability and future catalog-aware formulas. */
  blockTypes: BlockType[];
}

export function runSimulation({ city, personas }: RunSimulationInput): SimulationResultInput {
  const baselineJourneys = computePersonaJourneys(city, personas);
  const floodOutcome = runFloodEvent(city, baselineJourneys, personas);
  const techOutcome = runTechOutageEvent(city, baselineJourneys, personas);

  const metrics = computeMetrics({ city, baselineJourneys, floodOutcome, techOutcome });

  return {
    metrics,
    journeys: baselineJourneys,
    events: [floodOutcome.result, techOutcome.result],
    engineVersion: ENGINE_VERSION,
  };
}
