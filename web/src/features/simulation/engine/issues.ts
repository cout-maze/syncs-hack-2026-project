import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { MetricName, Persona, SimulationResultInput } from '@rmc/shared';

/**
 * ===========================================================================
 * FE #2 OWNS THIS FILE. Simulation mode's automatic issue detection.
 * ===========================================================================
 *
 * Simulation mode is the teaching sandbox: the user builds, hits Run, and the city
 * tells on itself. This turns a raw `SimulationResultInput` into a short, ranked list
 * of problems written in plain language.
 *
 * Pure: no React, no fetch, no mutation. Issues are ephemeral browser state - they are
 * never stored and never submitted anywhere. See docs/02-fe2-simulation-mode.md.
 */

/** Below this, a quality is weak enough to raise on its own. */
const WEAK_METRIC_THRESHOLD = 50;

/** The panel stays readable; more than this and nobody reads any of them. */
const MAX_ISSUES = 5;

export type IssueKind = 'journey' | 'metric' | 'event';

export interface SimIssue {
  id: string;
  kind: IssueKind;
  /** The problem in one sentence, as shown to the user. */
  title: string;
  /** The quality this issue hurts most - drives the colour and the fix we look for. */
  metric: MetricName;
  /** Higher is worse. Used to rank, and to pick which issues make the cut. */
  severity: number;
  /** Block-type id a fix would most likely need to place. Null for issues with no obvious fix. */
  wantedService: string | null;
  /** Personas affected, for the readout. */
  personaIds: string[];
}

/** Which quality a missing service most obviously hurts. */
const SERVICE_METRIC: Record<string, MetricName> = {
  healthcare: 'accessibility',
  education: 'inclusion',
  transport: 'accessibility',
  park: 'sustainability',
  community_hub: 'community',
  technology_hub: 'inclusion',
  shared_resource_hub: 'sustainability',
  culture_heritage: 'community',
};

function personaName(personas: Persona[], personaId: string): string {
  return personas.find((persona) => persona.id === personaId)?.name ?? personaId.replace(/_/g, ' ');
}

function serviceName(typeId: string): string {
  return typeId.replace(/_/g, ' ');
}

/**
 * Detect the problems worth showing after a run, worst first.
 *
 * Journeys are grouped by (service, persona) so ten failed trips to the same missing
 * hospital read as one issue rather than ten.
 */
export function detectIssues(result: SimulationResultInput, personas: Persona[] = []): SimIssue[] {
  const issues: SimIssue[] = [];

  /* ------------------------------------------------------------- journeys */

  const failedGroups = new Map<
    string,
    {
      targetService: string;
      personaIds: Set<string>;
      count: number;
      worstMinutes: number;
    }
  >();

  for (const journey of result.journeys) {
    if (journey.accessible) continue;
    const group = failedGroups.get(journey.targetService) ?? {
      targetService: journey.targetService,
      personaIds: new Set<string>(),
      count: 0,
      worstMinutes: 0,
    };
    group.personaIds.add(journey.personaId);
    group.count += 1;
    group.worstMinutes = Math.max(group.worstMinutes, journey.travelTimeMinutes);
    failedGroups.set(journey.targetService, group);
  }

  for (const group of failedGroups.values()) {
    const who = [...group.personaIds].map((id) => personaName(personas, id));
    const whoText =
      who.length === 1
        ? who[0]
        : who.length === 2
          ? `${who[0]} and ${who[1]}`
          : `${who[0]} and ${who.length - 1} others`;

    issues.push({
      id: `journey:${group.targetService}`,
      kind: 'journey',
      title: `${whoText} cannot reach ${serviceName(group.targetService)}${
        group.worstMinutes > 0
          ? ` - the best route takes ${Math.round(group.worstMinutes)} min`
          : ''
      }.`,
      metric: SERVICE_METRIC[group.targetService] ?? 'accessibility',
      severity: 40 + group.count * 6,
      wantedService: group.targetService,
      personaIds: [...group.personaIds],
    });
  }

  /* -------------------------------------------------------------- events */

  for (const event of result.events) {
    if (event.passed) continue;
    issues.push({
      id: `event:${event.eventType}`,
      kind: 'event',
      title: event.summary,
      metric: event.eventType === 'tech_outage' ? 'inclusion' : 'resilience',
      severity: 55,
      wantedService: event.eventType === 'tech_outage' ? 'technology_hub' : 'transport',
      personaIds: event.affectedPersonaIds,
    });
  }

  /* ------------------------------------------------------------- metrics */

  for (const metric of METRIC_NAMES) {
    const score = result.metrics[metric];
    if (score >= WEAK_METRIC_THRESHOLD) continue;

    // Don't repeat a quality a journey or event already explained better.
    if (issues.some((issue) => issue.metric === metric)) continue;

    issues.push({
      id: `metric:${metric}`,
      kind: 'metric',
      title: `${METRIC_LABELS[metric]} is ${Math.round(score)} - the layout is working against it.`,
      metric,
      severity: WEAK_METRIC_THRESHOLD - score,
      wantedService: WANTED_FOR_METRIC[metric],
      personaIds: [],
    });
  }

  return issues.sort((a, b) => b.severity - a.severity).slice(0, MAX_ISSUES);
}

/** The block type most likely to move a weak quality. */
const WANTED_FOR_METRIC: Record<MetricName, string> = {
  accessibility: 'transport',
  sustainability: 'park',
  efficiency: 'shared_resource_hub',
  community: 'community_hub',
  resilience: 'transport',
  inclusion: 'technology_hub',
};
