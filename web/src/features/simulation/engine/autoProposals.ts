import { METRIC_NAMES } from '@rmc/shared';
import type {
  BlockChange,
  BlockType,
  City,
  MetricName,
  Metrics,
  Persona,
  PlacedBlock,
  SimulationResultInput,
} from '@rmc/shared';
import { runSimulation } from './runSimulation';
import type { SimIssue } from './issues';

/**
 * ===========================================================================
 * FE #2 OWNS THIS FILE. Simulation mode's auto-proposals and auto-ratings.
 * ===========================================================================
 *
 * The automatic counterpart to what a person writes by hand in Proposal mode: each
 * detected issue becomes a concrete block change, and each change is rated by applying
 * it and re-running the simulation.
 *
 * The rating is a DETERMINISTIC FUNCTION OF THE SIM - not AI, and not a prediction of
 * how people would vote. Show the metric deltas next to the percentages so it reads as
 * arithmetic.
 *
 * HARD RULE (docs/00, docs/02, docs/03): none of this is ever POSTed to the proposals
 * API, and no auto-rating is ever written as a vote. It is browser state and it dies on
 * reload. Simulated is never real.
 */

/** A metric delta of this size maps to a full 100% rating. */
const DELTA_FOR_FULL_MARKS = 20;

export interface AutoRating {
  metric: MetricName;
  /** After minus before, in metric points. Negative means the change hurts this quality. */
  delta: number;
  /** The delta expressed as a 0-100 approval, so it lines up visually with real results. */
  approvalPct: number;
}

export interface AutoProposal {
  id: string;
  issueId: string;
  title: string;
  /** The problem it addresses - the same field a human fills in when authoring. */
  issue: string;
  description: string;
  /** Same shape Proposal mode uses, so the map previews both through identical code. */
  changes: BlockChange[];
  blockCost: number;
  /** Qualities this change measurably moves, worst-affected first. */
  ratings: AutoRating[];
  /** Mean of the per-quality approvals - the analogue of `overallApprovalPct`. */
  overallPct: number;
  /** Always true. Kept explicit so no caller can mistake one of these for a real proposal. */
  simulated: true;
}

/** Map a metric delta onto a 0-100 approval. A change that does nothing sits at 50. */
function approvalFor(delta: number): number {
  const scaled = 50 + (delta / DELTA_FOR_FULL_MARKS) * 50;
  return Math.round(Math.max(0, Math.min(100, scaled)) * 10) / 10;
}

function isFree(blocks: PlacedBlock[], x: number, y: number): boolean {
  return !blocks.some((block) => block.x === x && block.y === y);
}

/**
 * Where to put the block that would fix this issue: the free cell closest to the
 * housing that is currently underserved, so the suggestion is legible on the map.
 */
function pickCell(city: City): { x: number; y: number } | null {
  const housing = city.blocks.filter((block) => block.typeId === 'housing');
  const anchor = housing.length
    ? {
        x: housing.reduce((sum, block) => sum + block.x, 0) / housing.length,
        y: housing.reduce((sum, block) => sum + block.y, 0) / housing.length,
      }
    : { x: city.gridWidth / 2, y: city.gridHeight / 2 };

  let best: { x: number; y: number; distance: number } | null = null;

  for (let y = 0; y < city.gridHeight; y += 1) {
    for (let x = 0; x < city.gridWidth; x += 1) {
      if (!isFree(city.blocks, x, y)) continue;
      const distance = Math.hypot(x - anchor.x, y - anchor.y);
      if (!best || distance < best.distance) best = { x, y, distance };
    }
  }

  return best ? { x: best.x, y: best.y } : null;
}

function withChanges(city: City, changes: BlockChange[]): City {
  let blocks = city.blocks;

  for (const change of changes) {
    if (change.op === 'remove') {
      blocks = blocks.filter((block) => block.id !== change.blockId);
    } else if (change.op === 'move') {
      blocks = blocks.map((block) =>
        block.id === change.blockId ? { ...block, x: change.x, y: change.y } : block,
      );
    } else if (change.typeId) {
      blocks = [
        ...blocks,
        {
          id: `auto_${change.typeId}_${change.x}_${change.y}`,
          typeId: change.typeId,
          x: change.x,
          y: change.y,
        },
      ];
    }
  }

  return { ...city, blocks };
}

function rate(before: Metrics, after: Metrics): AutoRating[] {
  return METRIC_NAMES.map((metric) => {
    const delta = Math.round((after[metric] - before[metric]) * 10) / 10;
    return { metric, delta, approvalPct: approvalFor(delta) };
  })
    .filter((rating) => rating.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
}

export interface DraftAutoProposalsInput {
  city: City;
  personas: Persona[];
  blockTypes: BlockType[];
  /** The run the issues came from - reused as the "before" side of every rating. */
  result: SimulationResultInput;
  issues: SimIssue[];
}

/**
 * Draft one proposal per issue and rate each by re-running the simulation with it
 * applied. Skips issues with no affordable, placeable fix rather than inventing one.
 */
export function draftAutoProposals({
  city,
  personas,
  blockTypes,
  result,
  issues,
}: DraftAutoProposalsInput): AutoProposal[] {
  const proposals: AutoProposal[] = [];
  const remaining = city.blockBudget - city.blocksUsed;

  for (const issue of issues) {
    if (!issue.wantedService) continue;

    const blockType = blockTypes.find((type) => type.id === issue.wantedService);
    if (!blockType || blockType.cost > remaining) continue;

    const cell = pickCell(city);
    if (!cell) continue;

    const changes: BlockChange[] = [
      { op: 'place', typeId: issue.wantedService, x: cell.x, y: cell.y },
    ];

    const after = runSimulation({
      city: withChanges(city, changes),
      personas,
      blockTypes,
    });
    const ratings = rate(result.metrics, after.metrics);
    if (ratings.length === 0) continue;

    const overallPct =
      Math.round(
        (ratings.reduce((sum, rating) => sum + rating.approvalPct, 0) / ratings.length) * 10,
      ) / 10;

    proposals.push({
      id: `auto:${issue.id}`,
      issueId: issue.id,
      title: `Add ${blockType.name.toLowerCase()} at (${cell.x}, ${cell.y})`,
      issue: issue.title,
      description: `Places one ${blockType.name.toLowerCase()} block near the housing that is currently underserved.`,
      changes,
      blockCost: blockType.cost,
      ratings,
      overallPct,
      simulated: true,
    });
  }

  return proposals.sort((a, b) => b.overallPct - a.overallPct);
}
