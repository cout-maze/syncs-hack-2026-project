import type { City, EventResult, Journey, Persona } from '@rmc/shared';
import { computeJourneys, computePersonaJourneys } from './journeys';
import { EVENT_PASS_DROP_THRESHOLD_PP, JOURNEY_WORSE_DELTA_MINUTES } from './constants';

/**
 * The two stress-test events: flood (tests resilience) and tech_outage (tests inclusion).
 * Both re-derive journeys under a constraint via the same journey builders used for the
 * baseline and diff the result against it.
 */

export interface EventOutcome {
  result: EventResult;
  /** 0-1. Needed by metrics.ts for the resilience formula - EventResult only has `passed`. */
  accessibleRateBefore: number;
  accessibleRateAfter: number;
}

function accessibleRate(journeys: Journey[]): number {
  if (journeys.length === 0) return 0;
  return journeys.filter((journey) => journey.accessible).length / journeys.length;
}

interface JourneyComparison {
  rateBefore: number;
  rateAfter: number;
  /** Houses (fromBlockId) where a matched journey got meaningfully worse. */
  affectedBlockIds: string[];
  /** Personas whose journey became inaccessible or meaningfully worse. */
  affectedPersonaIds: string[];
}

/** Keys by persona+house+service so parallel resident journeys never overwrite each other. */
function compareJourneySets(before: Journey[], after: Journey[]): JourneyComparison {
  const key = (journey: Journey) =>
    `${journey.personaId}|${journey.fromBlockId}|${journey.targetService}`;
  const afterByKey = new Map(after.map((journey) => [key(journey), journey]));

  const affected = new Set<string>();
  const affectedPersonas = new Set<string>();
  for (const journey of before) {
    const match = afterByKey.get(key(journey));
    if (!journey.fromBlockId) continue;

    if (!match) {
      affected.add(journey.fromBlockId);
      affectedPersonas.add(journey.personaId);
      continue;
    }

    const wasAccessible = journey.accessible;
    const nowAccessible = match.accessible;
    const worseByMinutes = match.travelTimeMinutes - journey.travelTimeMinutes >= JOURNEY_WORSE_DELTA_MINUTES;

    if ((wasAccessible && !nowAccessible) || worseByMinutes) {
      affected.add(journey.fromBlockId);
      affectedPersonas.add(journey.personaId);
    }
  }

  return {
    rateBefore: accessibleRate(before),
    rateAfter: accessibleRate(after),
    affectedBlockIds: [...affected],
    affectedPersonaIds: [...affectedPersonas],
  };
}

/**
 * Bands the middle ~15% of rows as impassable ground (not just "no service here" - a
 * merely serviceless band lets Dijkstra route around it for free, and resilience would
 * never move). Real streets underwater cannot be walked.
 */
export function runFloodEvent(
  city: City,
  baselineJourneys: Journey[],
  personas: Persona[] = [],
): EventOutcome {
  const bandSize = Math.max(1, Math.round(city.gridHeight * 0.15));
  const bandStart = Math.floor((city.gridHeight - bandSize) / 2);

  const blockedCells = new Set<number>();
  const affectedBlockIds: string[] = [];
  for (const block of city.blocks) {
    if (block.y < bandStart || block.y >= bandStart + bandSize) continue;
    blockedCells.add(block.y * city.gridWidth + block.x);
    affectedBlockIds.push(block.id);
  }

  const afterJourneys = personas.length
    ? computePersonaJourneys(city, personas, { blockedCells })
    : computeJourneys(city, { blockedCells });
  const comparison = compareJourneySets(baselineJourneys, afterJourneys);
  const dropPP = (comparison.rateBefore - comparison.rateAfter) * 100;
  const passed = dropPP <= EVENT_PASS_DROP_THRESHOLD_PP;

  return {
    accessibleRateBefore: comparison.rateBefore,
    accessibleRateAfter: comparison.rateAfter,
    result: {
      eventType: 'flood',
      passed,
      affectedBlockIds,
      affectedPersonaIds: comparison.affectedPersonaIds,
      summary: passed
        ? `A flood along the middle of the city barely changes accessibility (${Math.round(dropPP)} pp drop).`
        : `A flood along the middle of the city cuts off ${Math.round(dropPP)}% of trips that used to work.`,
    },
  };
}

/** technology_hub blocks stay in place (powered down) but stop acting as a service source. */
export function runTechOutageEvent(
  city: City,
  baselineJourneys: Journey[],
  personas: Persona[] = [],
): EventOutcome {
  const excludeBlockIds = new Set(
    city.blocks.filter((block) => block.typeId === 'technology_hub').map((block) => block.id),
  );

  const afterJourneys = personas.length
    ? computePersonaJourneys(city, personas, { excludeBlockIds })
    : computeJourneys(city, { excludeBlockIds });
  const comparison = compareJourneySets(baselineJourneys, afterJourneys);
  const dropPP = (comparison.rateBefore - comparison.rateAfter) * 100;
  const passed = dropPP <= EVENT_PASS_DROP_THRESHOLD_PP;

  return {
    accessibleRateBefore: comparison.rateBefore,
    accessibleRateAfter: comparison.rateAfter,
    result: {
      eventType: 'tech_outage',
      passed,
      affectedBlockIds: [...excludeBlockIds],
      affectedPersonaIds: comparison.affectedPersonaIds,
      summary: passed
        ? `A technology outage barely changes accessibility (${Math.round(dropPP)} pp drop).`
        : `A technology outage cuts off ${Math.round(dropPP)}% of trips that used to work.`,
    },
  };
}
