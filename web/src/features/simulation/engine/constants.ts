/**
 * Tunable numbers for the simulation engine, in one place.
 *
 * Simulation journeys are persona-aware; Access mode also uses the generic route helper
 * for an exploratory home's travel time to a selected service. See runSimulation.ts.
 */

/** Every non-housing block type - what a house is checked against. */
export const SERVICE_TYPE_IDS = [
  'healthcare',
  'education',
  'transport',
  'park',
  'community_hub',
  'technology_hub',
  'shared_resource_hub',
  'culture_heritage',
] as const;

/**
 * Access mode's generic journey helper needs a schema-safe identifier because it describes
 * a house-to-service lookup rather than a named resident.
 */
export const GENERIC_RESIDENT_ID = 'resident';

/** Default comfortable-reach limit used by the generic Access helper. */
export const COMFORTABLE_MINUTES = 30;

/**
 * Sentinel for "unreachable" journeys. Not `Infinity` - that serializes to `null` in JSON
 * and fails `JourneySchema`'s `z.number()` check on the round trip through `PUT`.
 */
export const UNREACHABLE_MINUTES = 999;

/** An event-affected journey is one that got at least this many minutes worse. */
export const JOURNEY_WORSE_DELTA_MINUTES = 5;

/** An event "fails" when it drops the accessible-journey rate by more than this many points. */
export const EVENT_PASS_DROP_THRESHOLD_PP = 15;

/** Flat point penalty applied to inclusion when the tech-outage event fails. */
export const INCLUSION_TECH_OUTAGE_PENALTY = 20;

export const COMMUNITY_JOURNEY_WEIGHT = 0.6;
export const COMMUNITY_DENSITY_WEIGHT = 0.4;
/** 1 community block per 15 homes scores full marks on the density half of `community`. */
export const COMMUNITY_DENSITY_TARGET = 1 / 15;

/** 1 green/shared/heritage block per 20 homes scores full marks on `sustainability`. */
export const SUSTAINABILITY_DENSITY_TARGET = 1 / 20;

export const EFFICIENCY_UTILIZATION_WEIGHT = 0.5;
export const EFFICIENCY_TRAVEL_WEIGHT = 0.5;
/** Average travel time at or beyond this many minutes scores zero on the travel half of `efficiency`. */
export const EFFICIENCY_TRAVEL_CEILING_MINUTES = 30;
