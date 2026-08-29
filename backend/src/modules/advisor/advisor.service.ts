import { z } from 'zod';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import type { ToolSchema } from './advisor.llm.js';
import { callStructured } from './advisor.llm.js';
import { buildFallbackExplanation } from './advisor.fallback.js';
import type { ProposalExplanation } from './advisor.schemas.js';
import { ProposalExplanationSchema } from './advisor.schemas.js';

type Prisma = typeof PrismaClient;

const ExplanationReplySchema = ProposalExplanationSchema.omit({ fallback: true });
const EXPLANATION_TOOL_SCHEMA = z.toJSONSchema(ExplanationReplySchema) as ToolSchema;

const SYSTEM_PROMPT = `You are the City Advisor for a civic-simulation game called Rebuild My City.
You explain one proposed map change in plain language: what it changes and its trade-offs.
Hard rules:
- NEVER predict, score, or recommend a vote. NEVER mention vote counts.
- Keep it to 2–4 sentences, plain language, no jargon.
- If block type catalog info is provided, draw trade-offs from it.
Always call the submit_proposal_explanation tool with your answer.`;

export async function loadBlockTypeInfo(blockTypeId: string | null): Promise<string> {
  if (!blockTypeId) return '';
  try {
    const { default: blockTypes } = await import('../city/catalog/block-types.json', { with: { type: 'json' } });
    const entry = (blockTypes as Array<{ id: string; description: string; benefits: string[]; tradeoffs: string[] }>)
      .find((b) => b.id === blockTypeId);
    if (entry) {
      return [
        `Block type "${blockTypeId}": ${entry.description}`,
        `Benefits: ${entry.benefits.join('; ')}`,
        `Tradeoffs: ${entry.tradeoffs.join('; ')}`,
      ].join('\n');
    }
  } catch {
    // catalog not available
  }
  return '';
}

export async function explainProposal(
  prisma: Prisma,
  proposalId: string,
): Promise<ProposalExplanation> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw AppError.notFound('Proposal not found.', 'PROPOSAL_NOT_FOUND');

  const blockTypeInfo = await loadBlockTypeInfo(proposal.blockTypeId ?? null);

  let currentBlockInfo = '';
  if (proposal.changeType === 'remove' || proposal.changeType === 'replace') {
    const realCity = await prisma.city.findFirst({ where: { kind: 'real' } });
    if (realCity) {
      const block = await prisma.placedBlock.findUnique({
        where: { cityId_x_y: { cityId: realCity.id, x: proposal.x, y: proposal.y } },
      });
      if (block) {
        currentBlockInfo = `Currently at this cell: a ${block.blockTypeId} block.`;
        const currentInfo = await loadBlockTypeInfo(block.blockTypeId);
        if (currentInfo) {
          const descMatch = currentInfo.match(/: (.+)/);
          if (descMatch?.[1]) currentBlockInfo += ` ${descMatch[1]}`;
        }
      }
    }
  }

  const prompt = [
    `Proposal: "${proposal.title}"`,
    `Description: ${proposal.description}`,
    `Change: ${proposal.changeType} at cell (${proposal.x}, ${proposal.y})`,
    proposal.blockTypeId ? `Target block type: ${proposal.blockTypeId}` : 'This proposal removes the existing block.',
    blockTypeInfo,
    currentBlockInfo,
  ].filter(Boolean).join('\n');

  const result = await callStructured({
    system: SYSTEM_PROMPT,
    prompt,
    toolName: 'submit_proposal_explanation',
    toolDescription: 'Submit the structured proposal explanation.',
    toolSchema: EXPLANATION_TOOL_SCHEMA,
    parse: (input) => ExplanationReplySchema.safeParse(input),
  });

  return result
    ? { ...result, fallback: false }
    : buildFallbackExplanation(proposal, blockTypeInfo);
}
