import type { City, Journey, Metrics } from '@rmc/shared';
import type { EventOutcome } from './events';
import {
  COMMUNITY_DENSITY_TARGET,
  COMMUNITY_DENSITY_WEIGHT,
  COMMUNITY_JOURNEY_WEIGHT,
  EFFICIENCY_TRAVEL_CEILING_MINUTES,
  EFFICIENCY_TRAVEL_WEIGHT,
  EFFICIENCY_UTILIZATION_WEIGHT,
  INCLUSION_TECH_OUTAGE_PENALTY,
  SUSTAINABILITY_DENSITY_TARGET,
  UNREACHABLE_MINUTES,
} from './constants';

/**
 * The six 0-100 quality scores, derived from the baseline journeys, the layout, and the
 * two event outcomes. Each formula is deliberately one sentence - see runSimulation.ts's
 * doc comment and docs/02-fe2-simulation-mode.md for why that matters (judges ask).
 */

export interface ComputeMetricsInput {
  city: City;
  baselineJourneys: Journey[];
  floodOutcome: EventOutcome;
  techOutcome: EventOutcome;
}

const ZERO_METRICS: Metrics = {
  accessibility: 0,
  sustainability: 0,
  efficiency: 0,
  community: 0,
  resilience: 0,
  inclusion: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function accessibleRate(journeys: Journey[]): number {
  if (journeys.length === 0) return 0;
  return journeys.filter((journey) => journey.accessible).length / journeys.length;
}

function countBlocks(city: City, typeId: string): number {
  return city.blocks.reduce((count, block) => count + (block.typeId === typeId ? 1 : 0), 0);
}

export function computeMetrics(input: ComputeMetricsInput): Metrics {
  const { city, baselineJourneys, floodOutcome, techOutcome } = input;
  if (baselineJourneys.length === 0) return { ...ZERO_METRICS };

  const housingCount = countBlocks(city, 'housing');

  return {
    accessibility: round(accessibilityScore(baselineJourneys)),
    inclusion: round(inclusionScore(baselineJourneys, techOutcome)),
    community: round(communityScore(baselineJourneys, city, housingCount)),
    sustainability: round(sustainabilityScore(city, housingCount)),
    efficiency: round(efficiencyScore(city, baselineJourneys)),
    resilience: round(resilienceScore(floodOutcome)),
  };
}

/** The percentage of every persona-priority trip in the city that succeeds. */
function accessibilityScore(journeys: Journey[]): number {
  return accessibleRate(journeys) * 100;
}

/**
 * The average percentage of each persona's priority journeys that succeeds, minus a flat
 * penalty when a technology outage meaningfully worsens access. Grouping by persona keeps
 * the score about equitable needs rather than letting a persona with more listed services
 * dominate the result.
 */
function inclusionScore(journeys: Journey[], techOutcome: EventOutcome): number {
  const byPersona = new Map<string, { accessible: number; total: number }>();
  for (const journey of journeys) {
    const entry = byPersona.get(journey.personaId) ?? { accessible: 0, total: 0 };
    entry.total += 1;
    if (journey.accessible) entry.accessible += 1;
    byPersona.set(journey.personaId, entry);
  }

  if (byPersona.size === 0) return 0;

  const rate =
    ([...byPersona.values()].reduce((sum, entry) => sum + entry.accessible / entry.total, 0) /
      byPersona.size) *
    100;
  const penalty = techOutcome.result.passed ? 0 : INCLUSION_TECH_OUTAGE_PENALTY;

  return rate - penalty;
}

/**
 * A blend of how well trips to community hubs succeed and how much community space
 * (parks, hubs, shared resources) exists per home.
 */
function communityScore(journeys: Journey[], city: City, housingCount: number): number {
  const communityJourneys = journeys.filter((journey) => journey.targetService === 'community_hub');
  const journeyPart = accessibleRate(communityJourneys) * 100;

  const communityBlocks =
    countBlocks(city, 'park') + countBlocks(city, 'community_hub') + countBlocks(city, 'shared_resource_hub');
  const density = housingCount === 0 ? 0 : Math.min(100, (communityBlocks / housingCount / COMMUNITY_DENSITY_TARGET) * 100);

  return COMMUNITY_JOURNEY_WEIGHT * journeyPart + COMMUNITY_DENSITY_WEIGHT * density;
}

/** How much green, shared and heritage space exists per home - layout only, no journeys. */
function sustainabilityScore(city: City, housingCount: number): number {
  if (housingCount === 0) return 0;
  const blocks = countBlocks(city, 'park') + countBlocks(city, 'shared_resource_hub') + countBlocks(city, 'culture_heritage');
  return Math.min(100, (blocks / housingCount / SUSTAINABILITY_DENSITY_TARGET) * 100);
}

/** Half budget utilization, half how short the average successful trip is. */
function efficiencyScore(city: City, journeys: Journey[]): number {
  const utilization = city.blockBudget > 0 ? clamp((city.blocksUsed / city.blockBudget) * 100, 0, 100) : 0;

  const reachable = journeys.filter((journey) => journey.travelTimeMinutes < UNREACHABLE_MINUTES);
  const avgMinutes = reachable.length
    ? reachable.reduce((sum, journey) => sum + journey.travelTimeMinutes, 0) / reachable.length
    : EFFICIENCY_TRAVEL_CEILING_MINUTES;
  const travelScore = clamp(100 * (1 - avgMinutes / EFFICIENCY_TRAVEL_CEILING_MINUTES), 0, 100);

  return EFFICIENCY_UTILIZATION_WEIGHT * utilization + EFFICIENCY_TRAVEL_WEIGHT * travelScore;
}

/** 100 minus the percentage-point drop in accessible trips caused by the flood. */
function resilienceScore(floodOutcome: EventOutcome): number {
  const dropPP = (floodOutcome.accessibleRateBefore - floodOutcome.accessibleRateAfter) * 100;
  return 100 - dropPP;
}
