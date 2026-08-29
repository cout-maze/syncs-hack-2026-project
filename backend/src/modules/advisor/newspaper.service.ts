import { z } from 'zod';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import type { ToolSchema } from './advisor.llm.js';
import { callStructured } from './advisor.llm.js';
import type { Newspaper } from './advisor.schemas.js';
import { NewspaperSchema } from './advisor.schemas.js';
import { loadBlockTypeInfo } from './advisor.service.js';

type Prisma = typeof PrismaClient;

const NewspaperReplySchema = NewspaperSchema.omit({ fallback: true });
const NEWSPAPER_TOOL_SCHEMA = z.toJSONSchema(NewspaperReplySchema) as ToolSchema;

const SYSTEM_PROMPT = `You are writing for THE CITY BLOCK, a local newspaper in the civic game Rebuild My City.
Given a proposal and its vote results, produce a newspaper edition.
Style: upbeat local newspaper, short punchy sentences, civic pride.
Hard rules:
- headline: attention-grabbing, under 12 words
- summary: 2-3 sentences about what this means for the city
- voteResult: one sentence summarising the vote outcome (e.g. "74% of citizens voted in favour")
- otherHeadlines: 3 related fictional headlines that could appear alongside this story
- NEVER invent vote numbers — use the exact percentages provided
Always call the submit_newspaper tool with your answer.`;

function buildFallbackNewspaper(
  proposal: {
    title: string;
    description: string;
    changeType: string;
    x: number;
    y: number;
    blockTypeId: string | null;
  },
  upPct: number,
  downPct: number,
  totalVotes: number,
): Newspaper {
  const action =
    proposal.changeType === 'add'
      ? 'New addition'
      : proposal.changeType === 'replace'
        ? 'Upgrade'
        : 'Removal';

  const outcome = upPct > 50 ? 'approved' : upPct === 50 ? 'split evenly' : 'rejected';

  return {
    headline: `${action} ${outcome}: ${proposal.title}`,
    summary: `${proposal.description} The proposal to ${proposal.changeType} at cell (${proposal.x}, ${proposal.y}) has been decided by the residents.`,
    voteResult:
      totalVotes > 0
        ? `${upPct}% of citizens voted in favour, ${downPct}% voted against (${totalVotes} total votes).`
        : 'No votes were cast on this proposal.',
    otherHeadlines: [
      "Residents discuss city's future direction",
      'Community engagement reaches new heights',
      'City planners respond to citizen feedback',
    ],
    fallback: true,
  };
}

export async function generateNewspaper(prisma: Prisma, proposalId: string): Promise<Newspaper> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw AppError.notFound('Proposal not found.', 'PROPOSAL_NOT_FOUND');

  const votes = await prisma.vote.findMany({
    where: { proposalId },
    select: { value: true },
  });
  const up = votes.filter((v) => v.value === 'up').length;
  const down = votes.filter((v) => v.value === 'down').length;
  const total = up + down;
  const upPct = total > 0 ? Math.round((up / total) * 100) : 0;
  const downPct = total > 0 ? 100 - upPct : 0;

  const blockTypeInfo = await loadBlockTypeInfo(proposal.blockTypeId ?? null);

  const prompt = [
    `Proposal: "${proposal.title}"`,
    `Description: ${proposal.description}`,
    `Change type: ${proposal.changeType} at cell (${proposal.x}, ${proposal.y})`,
    proposal.blockTypeId ? `Block type: ${proposal.blockTypeId}` : '',
    `Vote result: ${upPct}% in favour, ${downPct}% against (${total} total votes)`,
    `Status: ${proposal.status}`,
    blockTypeInfo,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await callStructured({
    system: SYSTEM_PROMPT,
    prompt,
    toolName: 'submit_newspaper',
    toolDescription: 'Submit the newspaper edition.',
    toolSchema: NEWSPAPER_TOOL_SCHEMA,
    parse: (input) => NewspaperReplySchema.safeParse(input),
  });

  return result
    ? { ...result, fallback: false }
    : buildFallbackNewspaper(proposal, upPct, downPct, total);
}
