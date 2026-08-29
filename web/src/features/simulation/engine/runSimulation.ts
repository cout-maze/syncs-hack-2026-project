import type { BlockType, City, Persona, SimulationResultInput } from '@rmc/shared';
import { computeJourneys } from './journeys';
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
 * HOUSING-BLOCK BASED, NOT PERSONA BASED. This deliberately departs from the docs' original
 * "for each persona..." framing: a journey describes one house's travel time to the
 * nearest instance of one service type, not a named resident type's trip. There is no
 * per-persona priority-service list, no per-persona comfort threshold, and no
 * wheelchair/digital-access special casing - every house is checked against every one of
 * the 8 non-housing service types the same way. `Journey.personaId` stays a required
 * string in the schema, so it is populated with a fixed generic value (`'resident'`, see
 * engine/constants.ts) rather than naming anyone in particular. Personas remain elsewhere
 * in the product (the catalog, `RunSimulationInput.personas` below) - this engine simply
 * doesn't read them.
 *
 * What it produces:
 *
 *   1. Journeys (engine/journeys.ts) - one per (housing block x service type), via a
 *      multi-source Dijkstra per distinct service type (engine/grid.ts), reused across
 *      every house. Transport blocks reduce travel time. `pathBlockIds` drives the map
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
 * Known consequence, not a bug: on the current default 30x30 city this can produce
 * thousands of Journey records (every housing block x all 8 service types) - a deliberate
 * choice, not a sampled subset. See docs/02-fe2-simulation-mode.md.
 */

/** Bump when the formulas change; it is stored alongside each result. */
export const ENGINE_VERSION = '1.0.0';

export interface RunSimulationInput {
  city: City;
  /** Accepted for interface stability with existing callers; not read by this engine. */
  personas: Persona[];
  /** Accepted for interface stability with existing callers; not read by this engine. */
  blockTypes: BlockType[];
}

export function runSimulation({ city }: RunSimulationInput): SimulationResultInput {
  const baselineJourneys = computeJourneys(city);
  const floodOutcome = runFloodEvent(city, baselineJourneys);
  const techOutcome = runTechOutageEvent(city, baselineJourneys);

  const metrics = computeMetrics({ city, baselineJourneys, floodOutcome, techOutcome });

  return {
    metrics,
    journeys: baselineJourneys,
    events: [floodOutcome.result, techOutcome.result],
    engineVersion: ENGINE_VERSION,
  };
}
