import type { Persona, PlacedBlock } from '@rmc/shared';
import {
  ESSENTIAL_ACCESS_MINUTES,
  planJourney,
  type JourneyPlan,
} from '@/features/simulation/engine/journeyCost';

/**
 * ===========================================================================
 * ACCESS RULES - § 7.1 turned into a spec the city has to pass.
 * ===========================================================================
 *
 * The journey cost model says what a trip costs. This says what the city owes
 * whom: for each home, which groups live there, and for each of those groups,
 * which services they must be able to reach and within how long.
 *
 * Three levels, all many-to-many:
 *
 *   home (a housing block)
 *     └─ group (a persona living there)          - one or more per home
 *          └─ threshold (a service + a time)     - one or more per group
 *
 * Evaluating one threshold is one call into `planJourney`. Nothing here is AI,
 * a vote, or a guess: every result is the cost model applied to the layout on
 * screen, and every failure names the home, the group and the service.
 *
 * Pure module - no React, no network.
 */

/** The time limits offered in the UI. 15 is the essential-access default. */
export const THRESHOLD_CHOICES = [5, 10, 15, 20, 25, 30, 45] as const;

export interface AccessThreshold {
  /** Block-type id that has to be reachable. */
  service: string;
  /** The limit in minutes. Over this, the requirement fails. */
  minutes: number;
}

/** One group of residents living in one home, and what they need to reach. */
export interface GroupRule {
  personaId: string;
  thresholds: AccessThreshold[];
}

/** Housing block id -> the groups living there. */
export type AccessPlan = Record<string, GroupRule[]>;

export interface AccessCheck {
  /** Stable key: home + group + service. */
  id: string;
  blockId: string;
  personaId: string;
  threshold: AccessThreshold;
  /** Null when the block has vanished from the layout. */
  journey: JourneyPlan | null;
  /** Null when nothing of that service is reachable. */
  minutes: number | null;
  pass: boolean;
}

/**
 * What a group needs by default: everything on its priority list, at the time
 * limit that persona is already defined by. The user can then delete what does
 * not apply and add what does - but adding a group should mean something
 * immediately, not open an empty form.
 */
export function defaultThresholds(persona: Persona): AccessThreshold[] {
  const minutes = persona.maxComfortableJourneyMinutes ?? ESSENTIAL_ACCESS_MINUTES;
  return persona.priorityServices.map((service) => ({ service, minutes }));
}

export interface EvaluateAccessInput {
  blocks: PlacedBlock[];
  gridWidth: number;
  gridHeight: number;
  plan: AccessPlan;
}

/** Run every requirement in the plan against the layout that is on screen now. */
export function evaluateAccess(input: EvaluateAccessInput): AccessCheck[] {
  const { blocks, gridWidth, gridHeight, plan } = input;
  const checks: AccessCheck[] = [];

  for (const [blockId, groups] of Object.entries(plan)) {
    const home = blocks.find((block) => block.id === blockId);

    for (const group of groups) {
      for (const threshold of group.thresholds) {
        const id = `${blockId}:${group.personaId}:${threshold.service}`;

        if (!home) {
          checks.push({
            id,
            blockId,
            personaId: group.personaId,
            threshold,
            journey: null,
            minutes: null,
            pass: false,
          });
          continue;
        }

        const journey = planJourney({
          blocks,
          gridWidth,
          gridHeight,
          personaId: group.personaId,
          maxComfortableJourneyMinutes: threshold.minutes,
          targetService: threshold.service,
          fromBlockId: blockId,
        });

        checks.push({
          id,
          blockId,
          personaId: group.personaId,
          threshold,
          journey,
          minutes: journey?.destination ? journey.totalMinutes : null,
          pass: Boolean(journey?.accessible),
        });
      }
    }
  }

  return checks;
}

/** Homes with at least one failing requirement - what the map marks in red. */
export function failingHomeIds(checks: AccessCheck[]): Set<string> {
  return new Set(checks.filter((check) => !check.pass).map((check) => check.blockId));
}

/* ------------------------------------------------------------- persistence */

/**
 * The plan is the user's own annotation of their city, not city state, so it
 * lives in the browser rather than going through the city service. Keyed per
 * city, and every access is guarded: a private window or blocked site data
 * must degrade to "no rules yet", never to a broken mode.
 */
const STORAGE_PREFIX = 'rmc.access.v1.';

export function loadAccessPlan(cityId: string): AccessPlan {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + cityId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isAccessPlan(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAccessPlan(cityId: string, plan: AccessPlan): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + cityId, JSON.stringify(plan));
  } catch {
    // Storage is a convenience here; losing it must not break the mode.
  }
}

/** Stored JSON is untrusted - an old or hand-edited shape must not crash the UI. */
function isAccessPlan(value: unknown): value is AccessPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  return Object.values(value as Record<string, unknown>).every(
    (groups) =>
      Array.isArray(groups) &&
      groups.every((group) => {
        if (!group || typeof group !== 'object') return false;
        const candidate = group as Partial<GroupRule>;
        return (
          typeof candidate.personaId === 'string' &&
          Array.isArray(candidate.thresholds) &&
          candidate.thresholds.every(
            (threshold) =>
              typeof threshold?.service === 'string' && typeof threshold?.minutes === 'number',
          )
        );
      }),
  );
}
