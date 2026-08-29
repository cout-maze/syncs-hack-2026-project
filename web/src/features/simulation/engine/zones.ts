import type { SimulationResultInput } from '@rmc/shared';

/**
 * Compute each house's service accessibility percentage.
 * A house's zone score is the percentage of its service trips that succeed.
 */
export function computeZoneScores(result: SimulationResultInput): Record<string, number> {
  const totals = new Map<string, { accessible: number; total: number }>();

  for (const journey of result.journeys) {
    if (!journey.fromBlockId) continue;
    const entry = totals.get(journey.fromBlockId) ?? { accessible: 0, total: 0 };
    entry.total += 1;
    if (journey.accessible) entry.accessible += 1;
    totals.set(journey.fromBlockId, entry);
  }

  const scores: Record<string, number> = {};
  for (const [blockId, entry] of totals) {
    scores[blockId] = entry.total === 0 ? 0 : Math.round((entry.accessible / entry.total) * 100);
  }
  return scores;
}
