import type { BlockType, City, Persona, SimulationResultInput } from '@rmc/shared';

/**
 * ===========================================================================
 * FE #2 OWNS THIS FILE. It is the critical path for the Simulation tab.
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
 * What it needs to produce (docs/02):
 *
 *   1. Journeys - for each persona, BFS from every housing block to each of their
 *      `priorityServices`. Transport blocks reduce travel time. Per-persona rules,
 *      e.g. `wheelchair_user` needs transport-connected routes, and
 *      `limited_digital_access` cannot count `technology_hub` as service access.
 *      Set `accessible: false` plus `issues[]` when a journey exceeds the persona's
 *      `maxComfortableJourneyMinutes`.
 *      Populate `pathBlockIds` - that is what drives the map animation through
 *      CitySceneApi.animateResident().
 *
 *   2. Metrics - the six 0-100 scores derived from journeys and layout. Keep the
 *      formulas simple and explainable; judges may ask how a number was produced.
 *
 *   3. Events - `flood` (disable an area, re-run journeys, tests resilience) and
 *      `tech_outage` (disable technology_hub effects, tests inclusion).
 *      `population_change` is optional.
 */

/** Bump when the formulas change; it is stored alongside each result. */
export const ENGINE_VERSION = '0.1.0-scaffold';

export interface RunSimulationInput {
  city: City;
  personas: Persona[];
  blockTypes: BlockType[];
}

export class SimulationEngineNotImplementedError extends Error {
  constructor() {
    super('The simulation engine has not been implemented yet (FE #2).');
    this.name = 'SimulationEngineNotImplementedError';
  }
}

export function runSimulation(_input: RunSimulationInput): SimulationResultInput {
  // TODO(FE#2): implement journeys -> metrics -> events, then delete this throw.
  throw new SimulationEngineNotImplementedError();
}
