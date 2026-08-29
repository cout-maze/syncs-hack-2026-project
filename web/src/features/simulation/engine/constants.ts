/**
 * Tunable numbers for the simulation engine, in one place.
 *
 * The engine is housing-block based, not persona based: a journey describes one house's
 * travel time to the nearest instance of one service type, not a named resident's trip.
 * See runSimulation.ts for the full design rationale.
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
 * `Journey.personaId` is a required string in the schema, but there is no persona in this
 * engine - every journey is a house's trip, not a resident type's. This fixed value keeps
 * the schema satisfied while being honest that it names nobody in particular.
 */
export const GENERIC_RESIDENT_ID = 'resident';

/** A service is within comfortable reach if it's within this many minutes, for every house. */
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

/** Out of the 8 service types, how many a house needs within reach to count as "well served". */
export const INCLUSION_COVERAGE_THRESHOLD = 4;

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
