import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { advisorEnabled, env } from '../../config/env.js';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { buildFallbackExplanation } from './advisor.fallback.js';
import type { ProposalExplanation } from './advisor.schemas.js';
import { ProposalExplanationSchema } from './advisor.schemas.js';

type Prisma = typeof PrismaClient;

const client = advisorEnabled ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
if (!advisorEnabled) {
  logger.warn(
    'ANTHROPIC_API_KEY not set — Explainer will always return fallback:true responses.',
  );
}

const ExplanationReplySchema = ProposalExplanationSchema.omit({ fallback: true });
const EXPLANATION_TOOL_SCHEMA = z.toJSONSchema(ExplanationReplySchema) as Anthropic.Tool.InputSchema;

const SYSTEM_PROMPT = `You are the City Advisor for a civic-simulation game called Rebuild My City.
You explain one proposed map change in plain language: what it changes and its trade-offs.
Hard rules:
- NEVER predict, score, or recommend a vote. NEVER mention vote counts.
- Keep it to 2–4 sentences, plain language, no jargon.
- If block type catalog info is provided, draw trade-offs from it.
Always call the submit_proposal_explanation tool with your answer.`;

async function callStructured<T>(opts: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  toolSchema: Anthropic.Tool.InputSchema;
  parse: (input: unknown) => { success: true; data: T } | { success: false };
}): Promise<T | null> {
  if (!client) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.ADVISOR_TIMEOUT_MS);
    try {
      const response = await client.messages.create(
        {
          model: env.ANTHROPIC_MODEL,
          max_tokens: 1024,
          system: opts.system,
          messages: [{ role: 'user', content: opts.prompt }],
          tools: [
            {
              name: opts.toolName,
              description: opts.toolDescription,
              input_schema: opts.toolSchema,
            },
          ],
          tool_choice: { type: 'tool', name: opts.toolName },
        },
        { signal: controller.signal },
      );

      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (!toolUse) {
        logger.warn({ attempt }, 'Explainer LLM reply had no tool_use block');
        continue;
      }
      const parsed = opts.parse(toolUse.input);
      if (parsed.success) return parsed.data;
      logger.warn({ attempt }, 'Explainer LLM reply failed schema validation, retrying once');
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, attempt },
        'Explainer LLM call failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function explainProposal(
  prisma: Prisma,
  proposalId: string,
): Promise<ProposalExplanation> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw AppError.notFound('Proposal not found.', 'PROPOSAL_NOT_FOUND');

  // Load the block type catalog entry for richer context
  let blockTypeInfo = '';
  const targetTypeId = proposal.blockTypeId ?? null;
  if (targetTypeId) {
    try {
      const { default: blockTypes } = await import('../city/catalog/block-types.json', { with: { type: 'json' } });
      const entry = (blockTypes as Array<{ id: string; description: string; benefits: string[]; tradeoffs: string[] }>)
        .find((b) => b.id === targetTypeId);
      if (entry) {
        blockTypeInfo = [
          `Block type "${targetTypeId}": ${entry.description}`,
          `Benefits: ${entry.benefits.join('; ')}`,
          `Tradeoffs: ${entry.tradeoffs.join('; ')}`,
        ].join('\n');
      }
    } catch {
      // catalog not available — proceed without it
    }
  }

  // For remove proposals, try to describe what's currently at the cell
  let currentBlockInfo = '';
  if (proposal.changeType === 'remove') {
    const realCity = await prisma.city.findFirst({ where: { kind: 'real' } });
    if (realCity) {
      const block = await prisma.placedBlock.findUnique({
        where: { cityId_x_y: { cityId: realCity.id, x: proposal.x, y: proposal.y } },
      });
      if (block) {
        currentBlockInfo = `Currently at this cell: a ${block.blockTypeId} block.`;
        try {
          const { default: blockTypes } = await import('../city/catalog/block-types.json', { with: { type: 'json' } });
          const entry = (blockTypes as Array<{ id: string; description: string; benefits: string[]; tradeoffs: string[] }>)
            .find((b) => b.id === block.blockTypeId);
          if (entry) {
            currentBlockInfo += ` ${entry.description}`;
          }
        } catch {
          // proceed without catalog
        }
      }
    }
  }

  const prompt = [
    `Proposal: "${proposal.title}"`,
    `Description: ${proposal.description}`,
    `Change: ${proposal.changeType} at cell (${proposal.x}, ${proposal.y})`,
    targetTypeId ? `Target block type: ${targetTypeId}` : 'This proposal removes the existing block.',
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
