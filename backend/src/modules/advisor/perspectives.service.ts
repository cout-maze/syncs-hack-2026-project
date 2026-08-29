import type { ToolSchema } from './advisor.llm.js';
import { z } from 'zod';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { callStructured } from './advisor.llm.js';
import { loadBlockTypeInfo } from './advisor.service.js';
import type { CitizenPerspectivesResponse } from './advisor.schemas.js';
import { CitizenPerspectivesResponseSchema } from './advisor.schemas.js';

type Prisma = typeof PrismaClient;

const PERSONAS = [
  { persona: 'Older residents', emoji: '👵' },
  { persona: 'Families', emoji: '👨‍👩‍👧' },
  { persona: 'Remote workers', emoji: '🧑‍💻' },
  { persona: 'Students', emoji: '🎓' },
] as const;

const PerspectivesReplySchema = CitizenPerspectivesResponseSchema.omit({ fallback: true });
const PERSPECTIVES_TOOL_SCHEMA = z.toJSONSchema(PerspectivesReplySchema) as ToolSchema;

const SYSTEM_PROMPT = `You are the City Advisor for a civic-simulation game called Rebuild My City.
Given a proposal, generate perspectives from different citizen groups and an overall advisor summary.
Hard rules:
- Each perspective must be a single sentence spoken in first person from that group's viewpoint.
- perspectives array must contain exactly these 4 personas: "Older residents", "Families", "Remote workers", "Students"
- Use the emoji provided for each persona.
- advisorSummary: 1-2 sentences, balanced assessment, never recommending a vote.
- Draw on block type info if provided.
Always call the submit_perspectives tool with your answer.`;

function buildFallbackPerspectives(
  proposal: { title: string; description: string; changeType: string; blockTypeId: string | null },
  blockTypeInfo: string,
): CitizenPerspectivesResponse {
  const blockName = proposal.blockTypeId ?? 'this change';
  const isAdd = proposal.changeType === 'add';
  const isRemove = proposal.changeType === 'remove';

  const perspectives = PERSONAS.map(({ persona, emoji }) => {
    let quote: string;
    switch (persona) {
      case 'Older residents':
        quote = isRemove
          ? 'We hope removing this won\'t make essential services harder to reach.'
          : `We need ${blockName} to be accessible and close to where we live.`;
        break;
      case 'Families':
        quote = isAdd
          ? `Adding ${blockName} could really help our neighbourhood grow.`
          : `We\'re concerned about how this affects our children\'s daily routine.`;
        break;
      case 'Remote workers':
        quote = proposal.blockTypeId === 'technology_hub'
          ? 'This is exactly what we need for better connectivity.'
          : `We\'re watching to see how ${blockName} affects our work-life balance.`;
        break;
      case 'Students':
        quote = proposal.blockTypeId === 'education'
          ? 'More learning spaces would make a real difference for us.'
          : `We want to understand how ${blockName} fits into the bigger picture.`;
        break;
    }
    return { persona, emoji, quote };
  });

  let advisorSummary = `This proposal would ${proposal.changeType} ${blockName}. `;
  if (blockTypeInfo) {
    const tradeoffMatch = blockTypeInfo.match(/Tradeoffs: (.+)/);
    advisorSummary += tradeoffMatch?.[1]
      ? `Consider the tradeoffs: ${tradeoffMatch[1]}`
      : 'Residents have mixed feelings about the impact on their daily lives.';
  } else {
    advisorSummary += 'Residents have mixed feelings about the impact on their daily lives.';
  }

  return { perspectives, advisorSummary, fallback: true };
}

export async function generatePerspectives(
  prisma: Prisma,
  proposalId: string,
): Promise<CitizenPerspectivesResponse> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw AppError.notFound('Proposal not found.', 'PROPOSAL_NOT_FOUND');

  const blockTypeInfo = await loadBlockTypeInfo(proposal.blockTypeId ?? null);

  const prompt = [
    `Proposal: "${proposal.title}"`,
    `Description: ${proposal.description}`,
    `Change type: ${proposal.changeType} at cell (${proposal.x}, ${proposal.y})`,
    proposal.blockTypeId ? `Block type: ${proposal.blockTypeId}` : 'This proposal removes an existing block.',
    `Required personas (use these exact names and emojis):`,
    ...PERSONAS.map(p => `  - ${p.emoji} ${p.persona}`),
    blockTypeInfo,
  ].filter(Boolean).join('\n');

  const result = await callStructured({
    system: SYSTEM_PROMPT,
    prompt,
    toolName: 'submit_perspectives',
    toolDescription: 'Submit citizen perspectives and advisor summary.',
    toolSchema: PERSPECTIVES_TOOL_SCHEMA,
    parse: (input) => PerspectivesReplySchema.safeParse(input),
  });

  return result
    ? { ...result, fallback: false }
    : buildFallbackPerspectives(proposal, blockTypeInfo);
}
