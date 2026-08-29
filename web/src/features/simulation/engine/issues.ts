import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type { MetricName, Persona, SimulationResultInput } from '@rmc/shared';
import { UNREACHABLE_MINUTES } from './constants';

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

function serviceName(typeId: string): string {
  return typeId.replace(/_/g, ' ');
}

/**
 * Detect the problems worth showing after a run, worst first.
 *
 * Journeys are grouped by service so ten failed trips (from ten different houses) to the
 * same missing hospital read as one issue rather than ten.
 */
export function detectIssues(result: SimulationResultInput, _personas: Persona[] = []): SimIssue[] {
  const issues: SimIssue[] = [];

  /* ------------------------------------------------------------- journeys */

  const failedGroups = new Map<
    string,
    { targetService: string; count: number; worstMinutes: number; anyMissing: boolean }
  >();

  for (const journey of result.journeys) {
    if (journey.accessible) continue;
    const group = failedGroups.get(journey.targetService) ?? {
      targetService: journey.targetService,
      count: 0,
      worstMinutes: 0,
      anyMissing: false,
    };
    group.count += 1;
    // The engine reports a genuinely unreachable service with a sentinel travel time
    // (UNREACHABLE_MINUTES), not a real number - fold it into "worstMinutes" and the
    // copy would say something absurd like "the best route takes 999 min."
    if (journey.travelTimeMinutes >= UNREACHABLE_MINUTES) {
      group.anyMissing = true;
    } else {
      group.worstMinutes = Math.max(group.worstMinutes, journey.travelTimeMinutes);
    }
    failedGroups.set(journey.targetService, group);
  }

  for (const group of failedGroups.values()) {
    const whoText = group.count === 1 ? '1 house' : `${group.count} houses`;

    issues.push({
      id: `journey:${group.targetService}`,
      kind: 'journey',
      title: `${whoText} cannot reach ${serviceName(group.targetService)}${
        group.anyMissing
          ? ' - it does not exist anywhere in the city'
          : group.worstMinutes > 0
            ? ` - the best route takes ${Math.round(group.worstMinutes)} min`
            : ''
      }.`,
      metric: SERVICE_METRIC[group.targetService] ?? 'accessibility',
      severity: 40 + group.count * 6,
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
    });
  }

  return issues.sort((a, b) => b.severity - a.severity).slice(0, MAX_ISSUES);
}
