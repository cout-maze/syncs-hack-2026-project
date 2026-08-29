import { z } from 'zod';
import type { MetricName } from '../../config/constants.js';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { buildFallbackAnalysis, buildFallbackExplanation } from './advisor.fallback.js';
import { callStructured } from './advisor.llm.js';
import type {
  AdvisorReport,
  CitySnapshot,
  ProposalExplanation,
  SimulationPayload,
} from './advisor.schemas.js';
import { AdvisorReportSchema, ProposalExplanationSchema } from './advisor.schemas.js';

type Prisma = typeof PrismaClient;

const AnalysisReplySchema = AdvisorReportSchema.omit({ fallback: true });
const ExplanationReplySchema = ProposalExplanationSchema.omit({ fallback: true });
const ANALYSIS_TOOL_SCHEMA = z.toJSONSchema(AnalysisReplySchema) as Record<string, unknown>;
const EXPLANATION_TOOL_SCHEMA = z.toJSONSchema(ExplanationReplySchema) as Record<string, unknown>;

const ANALYSIS_SYSTEM_PROMPT = `You are the City Advisor for a civic-simulation game called Rebuild My City.
You explain simulation results in plain language and suggest small, concrete changes.
Rules: you never change game state; you never mention proposal voting or predict a vote outcome;
only reference personas, block types and metrics that appear in the data you were given — never invent one.
Always call the submit_city_report tool with your answer.`;

const EXPLANATION_SYSTEM_PROMPT = `You are the City Advisor for a civic-simulation game called Rebuild My City.
You explain one council proposal in plain language: what it changes, its cost, who it affects.
Hard rule: you never predict, assign, or decide a voting score, and you never tell the reader how to vote.
If voting results are provided, you may only *describe* them (e.g. which metric has strongest/weakest support) —
never speculate about the final outcome. Always call the submit_proposal_explanation tool with your answer.`;

export async function loadBlockTypeInfo(blockTypeId: string | null): Promise<string> {
  if (!blockTypeId) return '';
  try {
    const { default: blockTypes } = await import('../city/catalog/block-types.json', {
      with: { type: 'json' },
    });
    const entry = (
      blockTypes as Array<{
        id: string;
        description: string;
        benefits?: string[];
        tradeoffs?: string[];
      }>
    ).find((block) => block.id === blockTypeId);
    if (entry) {
      return [
        `Block type "${blockTypeId}": ${entry.description}`,
        `Benefits: ${(entry.benefits ?? []).join('; ')}`,
        `Tradeoffs: ${(entry.tradeoffs ?? []).join('; ')}`,
      ].join('\n');
    }
  } catch {
    // Catalog data is optional for a fallback response.
  }
  return '';
}

function summariseSimulation(city: CitySnapshot, simulation: SimulationPayload): string {
  const blockCounts = city.blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.typeId] = (acc[b.typeId] ?? 0) + 1;
    return acc;
  }, {});
  const failedJourneys = simulation.journeys.filter((j) => !j.accessible);
  const failedEvents = simulation.events.filter((e) => !e.passed);

  return [
    `City: ${city.gridWidth}x${city.gridHeight} grid, ${city.blocksUsed}/${city.blockBudget} budget used.`,
    `Blocks by type: ${JSON.stringify(blockCounts)}`,
    `Metrics (0-100): ${JSON.stringify(simulation.metrics)}`,
    `Inaccessible journeys (${failedJourneys.length}/${simulation.journeys.length}): ${JSON.stringify(failedJourneys.slice(0, 8))}`,
    `Failed events: ${JSON.stringify(failedEvents)}`,
  ].join('\n');
}

export async function analyseCity(
  city: CitySnapshot,
  simulation: SimulationPayload,
  focus?: MetricName | null,
): Promise<AdvisorReport> {
  const prompt = [
    summariseSimulation(city, simulation),
    focus ? `The player asked to focus specifically on the "${focus}" metric.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await callStructured({
    system: ANALYSIS_SYSTEM_PROMPT,
    prompt,
    toolName: 'submit_city_report',
    toolDescription: 'Submit the structured City Advisor report for this simulation result.',
    toolSchema: ANALYSIS_TOOL_SCHEMA,
    parse: (input) => AnalysisReplySchema.safeParse(input),
  });

  return result ? { ...result, fallback: false } : buildFallbackAnalysis(city, simulation);
}

export async function explainProposal(
  prisma: Prisma,
  proposalId: string,
  votingResults: Record<string, unknown> | null | undefined,
): Promise<ProposalExplanation> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw AppError.notFound('Proposal not found.', 'PROPOSAL_NOT_FOUND');

  const prompt = [
    `Proposal: "${proposal.title}"`,
    proposal.description,
    `Block cost: ${proposal.blockCost}`,
    `Affected personas: ${JSON.stringify(proposal.affectedPersonaIds)}`,
    votingResults
      ? `Current voting results: ${JSON.stringify(votingResults)}`
      : 'No voting results provided yet.',
  ].join('\n');

  const result = await callStructured({
    system: EXPLANATION_SYSTEM_PROMPT,
    prompt,
    toolName: 'submit_proposal_explanation',
    toolDescription: 'Submit the structured proposal explanation.',
    toolSchema: EXPLANATION_TOOL_SCHEMA,
    parse: (input) => ExplanationReplySchema.safeParse(input),
  });

  return result ? { ...result, fallback: false } : buildFallbackExplanation(proposal);
}
