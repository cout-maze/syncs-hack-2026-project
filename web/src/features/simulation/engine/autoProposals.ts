import { METRIC_LABELS, METRIC_NAMES } from '@rmc/shared';
import type {
  BlockChange,
  BlockType,
  City,
  MetricName,
  Persona,
  SimulationResultInput,
} from '@rmc/shared';
import { runSimulation } from './runSimulation';
import type { SimIssue } from './issues';

/**
 * ===========================================================================
 * Simulation mode's ephemeral auto-proposals and deterministic auto-rating.
 * ===========================================================================
 *
 * These are deliberately pure browser calculations. They never call the proposal API,
 * create a vote row, or persist anything. The returned BlockChange shape is shared with
 * human proposals so the map preview and the builder's Apply path stay identical.
 */

export interface SimAutoProposal {
  id: string;
  issueId: string;
  metric: MetricName;
  title: string;
  description: string;
  changes: BlockChange[];
  blockCost: number;
  /** Integer point change in each simulation metric after applying the change. */
  deltas: Record<MetricName, number>;
  /** A transparent display-only rating derived from the metric delta. */
  approval: Record<MetricName, number>;
}

interface GenerateAutoProposalsInput {
  city: City;
  result: SimulationResultInput;
  issues: SimIssue[];
  personas: Persona[];
  blockTypes: BlockType[];
}

const FIX_FOR_METRIC: Record<MetricName, string> = {
  accessibility: 'healthcare',
  sustainability: 'park',
  efficiency: 'transport',
  community: 'community_hub',
  resilience: 'shared_resource_hub',
  inclusion: 'education',
};

const FIX_FOR_EVENT: Record<string, string> = {
  flood: 'shared_resource_hub',
  tech_outage: 'technology_hub',
  population_change: 'community_hub',
};

function roundDelta(value: number): number {
  return Math.round(value);
}

function approvalFromDelta(delta: number): number {
  return Math.max(0, Math.min(100, 50 + delta));
}

function serviceFromIssue(issue: SimIssue): string | null {
  if (issue.kind !== 'journey') return null;
  const service = issue.id.slice('journey:'.length);
  return service || null;
}

function targetCell(
  issue: SimIssue,
  result: SimulationResultInput,
  city: City,
): { x: number; y: number } {
  const service = serviceFromIssue(issue);
  if (service) {
    const failedJourney = result.journeys.find(
      (journey) => !journey.accessible && journey.targetService === service,
    );
    const home = city.blocks.find((block) => block.id === failedJourney?.fromBlockId);
    if (home) return { x: home.x, y: home.y };
  }

  const homes = city.blocks.filter((block) => block.typeId === 'housing');
  if (homes.length > 0) {
    return {
      x: Math.round(homes.reduce((sum, block) => sum + block.x, 0) / homes.length),
      y: Math.round(homes.reduce((sum, block) => sum + block.y, 0) / homes.length),
    };
  }

  return { x: Math.floor(city.gridWidth / 2), y: Math.floor(city.gridHeight / 2) };
}

function findFreeCell(
  city: City,
  anchor: { x: number; y: number },
  reserved: ReadonlySet<string>,
): { x: number; y: number } | null {
  const occupied = new Set(city.blocks.map((block) => `${block.x},${block.y}`));
  const candidates: Array<{ x: number; y: number; distance: number }> = [];

  for (let y = 0; y < city.gridHeight; y += 1) {
    for (let x = 0; x < city.gridWidth; x += 1) {
      const key = `${x},${y}`;
      if (occupied.has(key) || reserved.has(key)) continue;
      candidates.push({ x, y, distance: Math.abs(x - anchor.x) + Math.abs(y - anchor.y) });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  const cell = candidates[0];
  return cell ? { x: cell.x, y: cell.y } : null;
}

function fixTypeFor(issue: SimIssue): string {
  const service = serviceFromIssue(issue);
  if (service) return service;
  if (issue.kind === 'event') {
    const eventType = issue.id.slice('event:'.length);
    return FIX_FOR_EVENT[eventType] ?? FIX_FOR_METRIC[issue.metric];
  }
  return FIX_FOR_METRIC[issue.metric];
}

function describeFix(issue: SimIssue, type: BlockType, cell: { x: number; y: number }): string {
  const reason =
    issue.kind === 'journey'
      ? `This puts a ${type.name.toLowerCase()} beside the homes behind the failed journey.`
      : `This gives the city another ${type.name.toLowerCase()} at (${cell.x}, ${cell.y}) to test against the weakness.`;
  return `${reason} The result below is calculated by running the same simulation again on a copy of the layout.`;
}

function applyPlace(city: City, change: BlockChange, type: BlockType): City {
  return {
    ...city,
    blocksUsed: city.blocksUsed + type.cost,
    blocks: [
      ...city.blocks,
      {
        id: `sim_auto_${change.x}_${change.y}_${type.id}`,
        typeId: type.id,
        x: change.x,
        y: change.y,
      },
    ],
  };
}

/** Build at most one applicable, affordable fix for each displayed issue. */
export function generateAutoProposals({
  city,
  result,
  issues,
  personas,
  blockTypes,
}: GenerateAutoProposalsInput): SimAutoProposal[] {
  const proposals: SimAutoProposal[] = [];
  const reserved = new Set<string>();

  for (const issue of issues) {
    const type = blockTypes.find((candidate) => candidate.id === fixTypeFor(issue));
    if (!type || city.blocksUsed + type.cost > city.blockBudget) continue;

    const cell = findFreeCell(city, targetCell(issue, result, city), reserved);
    if (!cell) continue;

    const change: BlockChange = { op: 'place', typeId: type.id, x: cell.x, y: cell.y };
    const after = runSimulation({
      city: applyPlace(city, change, type),
      personas,
      blockTypes,
    });
    const deltas = Object.fromEntries(
      METRIC_NAMES.map((metric) => [metric, roundDelta(after.metrics[metric] - result.metrics[metric])]),
    ) as Record<MetricName, number>;
    const approval = Object.fromEntries(
      METRIC_NAMES.map((metric) => [metric, approvalFromDelta(deltas[metric])]),
    ) as Record<MetricName, number>;

    proposals.push({
      id: `sim-proposal:${issue.id}`,
      issueId: issue.id,
      metric: issue.metric,
      title: `Try a ${type.name.toLowerCase()} near (${cell.x}, ${cell.y})`,
      description: describeFix(issue, type, cell),
      changes: [change],
      blockCost: type.cost,
      deltas,
      approval,
    });
    reserved.add(`${cell.x},${cell.y}`);
  }

  return proposals;
}

export function signedDelta(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

export function metricLabel(metric: MetricName): string {
  return METRIC_LABELS[metric];
}
