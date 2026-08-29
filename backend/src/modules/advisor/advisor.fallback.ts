import type { ProposalExplanation } from './advisor.schemas.js';

export function buildFallbackExplanation(
  proposal: {
    title: string;
    description: string;
    changeType: string;
    x: number;
    y: number;
    blockTypeId: string | null;
  },
  blockTypeInfo: string,
): ProposalExplanation {
  const action =
    proposal.changeType === 'add'
      ? `build a new ${proposal.blockTypeId ?? 'block'} at`
      : proposal.changeType === 'replace'
        ? `replace the current block with a ${proposal.blockTypeId ?? 'block'} at`
        : 'remove the existing block at';

  const explanation = `This proposal would ${action} cell (${proposal.x}, ${proposal.y}). ${proposal.description}`;

  const tradeoffs: string[] = [];
  if (blockTypeInfo) {
    const benefitsMatch = blockTypeInfo.match(/Benefits: (.+)/);
    const tradeoffsMatch = blockTypeInfo.match(/Tradeoffs: (.+)/);
    if (benefitsMatch?.[1]) tradeoffs.push(benefitsMatch[1]);
    if (tradeoffsMatch?.[1]) tradeoffs.push(tradeoffsMatch[1]);
  }

  return {
    explanation,
    tradeoffs: tradeoffs.length > 0 ? tradeoffs : undefined,
    fallback: true,
  };
}
