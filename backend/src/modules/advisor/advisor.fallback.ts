import type { MetricName } from '../../config/constants.js';
import type {
  AdvisorReport,
  CitySnapshot,
  ProposalExplanation,
  SimulationPayload,
} from './advisor.schemas.js';

/**
 * Canned-but-plausible responses computed straight from the payload, used
 * whenever the LLM is unavailable, times out, or ANTHROPIC_API_KEY is unset
 * (docs/05-be2-proposals-advisor.md: "the demo must never hang on an API outage").
 */
export function buildFallbackAnalysis(
  _city: CitySnapshot,
  simulation: SimulationPayload,
): AdvisorReport {
  const metricEntries = Object.entries(simulation.metrics) as [MetricName, number][];
  const [weakestMetric, weakestScore] = metricEntries.reduce((a, b) => (b[1] < a[1] ? b : a));

  const inaccessible = simulation.journeys.filter((j) => !j.accessible);
  const worstJourneys = [...simulation.journeys]
    .sort((a, b) => b.travelTimeMinutes - a.travelTimeMinutes)
    .slice(0, 3);

  const affectedGroups = (inaccessible.length > 0 ? inaccessible : worstJourneys)
    .slice(0, 3)
    .map((j) => ({
      personaId: j.personaId,
      impact: j.accessible
        ? `${Math.round(j.travelTimeMinutes)}-minute journey to ${j.targetService} is the longest in this city.`
        : `Can't reach ${j.targetService} within a comfortable journey — ${Math.round(j.travelTimeMinutes)} minutes and rated inaccessible.`,
    }));

  const failedEvent = simulation.events.find((e) => !e.passed);

  return {
    headline:
      inaccessible.length > 0
        ? `${inaccessible.length} of ${simulation.journeys.length} tested journeys aren't accessible.`
        : `${weakestMetric} is the weakest metric at ${Math.round(weakestScore)}/100.`,
    biggestWeakness: {
      metric: weakestMetric,
      explanation: failedEvent
        ? failedEvent.summary
        : `${weakestMetric} scores lowest of the six metrics (${Math.round(weakestScore)}/100) — look at block placement relative to where residents start their journeys.`,
    },
    affectedGroups,
    tradeoffs: failedEvent ? [failedEvent.summary] : [],
    suggestions: [
      {
        title: `Improve ${weakestMetric}`,
        description: `Add or reposition a block that directly serves the personas above — that's the fastest lever on ${weakestMetric}.`,
        expectedImpact: [weakestMetric],
      },
    ],
    fallback: true,
  };
}

export function buildFallbackExplanation(proposal: {
  title: string;
  description: string;
  blockCost: number;
}): ProposalExplanation {
  return {
    explanation: `"${proposal.title}" — ${proposal.description} It costs ${proposal.blockCost} block${proposal.blockCost === 1 ? '' : 's'} of budget.`,
    tradeoffs: [],
    communityReadout: null,
    fallback: true,
  };
}
