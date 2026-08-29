import { METRIC_NAMES, OUTCOME_RULE } from '../../config/constants.js';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { generateId, IdPrefix } from '../../lib/ids.js';
import type {
  LegacyProposalInput,
  MetricName,
  MetricVote,
  Proposal,
  ProposalDetail,
  ProposalInput,
  VoteCounts,
  VotingResults,
} from './proposals.schemas.js';

type Prisma = typeof PrismaClient;
type ProposalRow = NonNullable<Awaited<ReturnType<Prisma['proposal']['findFirst']>>>;
type VoteRow = { userId: string; metric: string; support: boolean; value: string | null };
type BlockChangeInput = {
  op: 'place' | 'remove' | 'move';
  typeId?: string;
  x: number;
  y: number;
  blockId?: string | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function coordinates(proposal: ProposalRow) {
  return {
    x: proposal.x ?? proposal.locationX ?? null,
    y: proposal.y ?? proposal.locationY ?? null,
  };
}

function isLegacyProposal(proposal: ProposalRow) {
  return proposal.changeType != null;
}

function computeResults(votingMetrics: MetricName[], votes: VoteRow[]): VotingResults {
  const metrics = votingMetrics.length > 0 ? votingMetrics : [...METRIC_NAMES];
  const metricResults = metrics.map((metric) => {
    const forMetric = votes.filter((vote) => vote.metric === metric || vote.metric === 'overall');
    const supportCount = forMetric.filter((vote) => vote.support || vote.value === 'up').length;
    const opposeCount = forMetric.length - supportCount;
    const total = supportCount + opposeCount;
    return {
      metric,
      supportCount,
      opposeCount,
      supportPct: total === 0 ? 0 : round1((supportCount / total) * 100),
    };
  });

  const overallApprovalPct =
    metricResults.length === 0
      ? 0
      : round1(
          metricResults.reduce((sum, result) => sum + result.supportPct, 0) / metricResults.length,
        );

  const outcomeIfClosedNow =
    overallApprovalPct >= OUTCOME_RULE.approvedAtOrAbovePct
      ? 'approved'
      : overallApprovalPct < OUTCOME_RULE.rejectedBelowPct
        ? 'rejected'
        : 'reconsider';

  return {
    totalVoters: new Set(votes.map((vote) => vote.userId)).size,
    metricResults,
    overallApprovalPct,
    outcomeIfClosedNow,
  };
}

function toProposalDto(proposal: ProposalRow & { votes: VoteRow[] }): Proposal {
  const { x, y } = coordinates(proposal);
  const location = x != null && y != null ? { x, y } : null;
  const votingMetrics = jsonArray<MetricName>(proposal.votingMetrics);
  const expectedBenefits = jsonArray<string>(proposal.expectedBenefits);
  const affectedPersonaIds = jsonArray<string>(proposal.affectedPersonaIds);
  const changes =
    proposal.changes == null ? undefined : (jsonArray(proposal.changes) as Proposal['changes']);
  const overallVotes = proposal.votes.filter((vote) => vote.metric === 'overall');
  const counts: VoteCounts = {
    up: overallVotes.filter((vote) => vote.support || vote.value === 'up').length,
    down: overallVotes.filter((vote) => !vote.support && vote.value !== 'up').length,
  };

  return {
    id: proposal.id,
    title: proposal.title,
    issue: proposal.issue ?? undefined,
    description: proposal.description,
    location,
    ...(changes ? { changes } : {}),
    blockCost: proposal.blockCost,
    expectedBenefits,
    affectedPersonaIds,
    votingMetrics: votingMetrics.length > 0 ? votingMetrics : [...METRIC_NAMES],
    status: proposal.status as Proposal['status'],
    results: computeResults(
      (votingMetrics.length > 0 ? votingMetrics : [...METRIC_NAMES]) as MetricName[],
      proposal.votes,
    ),
    createdAt: proposal.createdAt.toISOString(),
    x,
    y,
    changeType: proposal.changeType as Proposal['changeType'],
    blockTypeId: proposal.blockTypeId,
    counts,
    closedAt: proposal.closedAt?.toISOString() ?? null,
  };
}

async function requireProposal(prisma: Prisma, proposalId: string) {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { votes: true },
  });
  if (!proposal) throw AppError.notFound('Proposal not found.', 'PROPOSAL_NOT_FOUND');
  return proposal;
}

function validateLegacyInput(input: LegacyProposalInput) {
  if (input.x >= 10 || input.y >= 10) {
    throw AppError.badRequest(
      `Cell (${input.x}, ${input.y}) is outside the 10×10 grid.`,
      'OUT_OF_BOUNDS',
    );
  }
  if (input.changeType !== 'remove' && !input.blockTypeId) {
    throw AppError.badRequest(
      'blockTypeId is required unless changeType is remove.',
      'BLOCK_TYPE_REQUIRED',
    );
  }
  if (
    input.blockTypeId &&
    input.changeType !== 'remove' &&
    !METRIC_NAMES.includes(input.blockTypeId as MetricName)
  ) {
    // Block ids are validated by the city catalog below; this branch only keeps the
    // detailed legacy error separate from request-shape validation.
  }
}

async function calculateChangeCost(changes: BlockChangeInput[] | undefined): Promise<number> {
  if (!changes?.length) return 0;

  const { blockTypes } = await import('../city/catalog/index.js');
  let total = 0;

  for (const change of changes) {
    if (change.x >= 10 || change.y >= 10) {
      throw AppError.badRequest(
        `Cell (${change.x}, ${change.y}) is outside the 10×10 grid.`,
        'OUT_OF_BOUNDS',
      );
    }

    if (change.op === 'place') {
      if (!change.typeId) {
        throw AppError.badRequest('typeId is required for a place change.', 'BLOCK_TYPE_REQUIRED');
      }
      const blockType = blockTypes.find((block) => block.id === change.typeId);
      if (!blockType) {
        throw AppError.badRequest(`Unknown block type: "${change.typeId}".`, 'BLOCK_TYPE_INVALID');
      }
      total += blockType.cost;
    } else if (!change.blockId) {
      throw AppError.badRequest(
        `blockId is required for a ${change.op} change.`,
        'BLOCK_ID_REQUIRED',
      );
    }
  }

  return total;
}

export async function listProposals(prisma: Prisma, status?: string): Promise<Proposal[]> {
  const proposals = await prisma.proposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { votes: true },
  });
  return proposals.map((proposal) => toProposalDto(proposal));
}

export async function createProposal(
  prisma: Prisma,
  input: ProposalInput,
  createdById?: string,
): Promise<Proposal> {
  const legacy = 'changeType' in input;
  if (legacy) validateLegacyInput(input);

  const location = legacy ? { x: input.x, y: input.y } : (input.location ?? null);
  if (location && (location.x >= 10 || location.y >= 10)) {
    throw AppError.badRequest(
      `Cell (${location.x}, ${location.y}) is outside the 10×10 grid.`,
      'OUT_OF_BOUNDS',
    );
  }

  if (legacy && input.changeType !== 'remove') {
    const { blockTypes } = await import('../city/catalog/index.js');
    if (!blockTypes.some((block) => block.id === input.blockTypeId)) {
      throw AppError.badRequest(
        `Unknown block type: "${input.blockTypeId}".`,
        'BLOCK_TYPE_INVALID',
      );
    }
  }

  if (location) {
    const openAtCell = await prisma.proposal.findFirst({
      where: { locationX: location.x, locationY: location.y, status: 'open' },
    });
    if (openAtCell) {
      throw AppError.conflict(
        `An open proposal already exists at cell (${location.x}, ${location.y}).`,
        'PROPOSAL_EXISTS_AT_CELL',
      );
    }
  }

  const computedBlockCost = legacy ? 0 : await calculateChangeCost(input.changes);

  const data = legacy
    ? {
        id: generateId(IdPrefix.proposal),
        title: input.title,
        issue: null,
        description: input.description,
        locationX: input.x,
        locationY: input.y,
        changes: [
          {
            op: input.changeType === 'remove' ? 'remove' : 'place',
            ...(input.blockTypeId ? { typeId: input.blockTypeId } : {}),
            x: input.x,
            y: input.y,
          },
        ],
        blockCost: 0,
        expectedBenefits: [],
        affectedPersonaIds: [],
        votingMetrics: [...METRIC_NAMES],
        x: input.x,
        y: input.y,
        changeType: input.changeType,
        blockTypeId: input.changeType === 'remove' ? null : (input.blockTypeId ?? null),
        createdById: createdById ?? null,
      }
    : {
        id: generateId(IdPrefix.proposal),
        title: input.title,
        issue: input.issue ?? null,
        description: input.description,
        locationX: location?.x ?? null,
        locationY: location?.y ?? null,
        ...(input.changes ? { changes: input.changes } : {}),
        blockCost: computedBlockCost,
        expectedBenefits: input.expectedBenefits,
        affectedPersonaIds: input.affectedPersonaIds,
        votingMetrics: input.votingMetrics,
        x: location?.x ?? null,
        y: location?.y ?? null,
        changeType: null,
        blockTypeId: input.changes?.find((change) => change.typeId)?.typeId ?? null,
        createdById: createdById ?? null,
      };

  const proposal = await prisma.proposal.create({
    data,
    include: { votes: true },
  });
  return toProposalDto(proposal);
}

export async function getProposalDetail(
  prisma: Prisma,
  userId: string | null,
  proposalId: string,
): Promise<ProposalDetail> {
  const proposal = await requireProposal(prisma, proposalId);
  const dto = toProposalDto(proposal);
  const myVoteRows = userId ? proposal.votes.filter((vote) => vote.userId === userId) : [];
  const metricVotes = myVoteRows
    .filter((vote) => vote.metric !== 'overall')
    .map((vote) => ({ metric: vote.metric as MetricName, support: vote.support }));
  const overallVote = myVoteRows.find((vote) => vote.metric === 'overall');
  return {
    ...dto,
    myVotes: metricVotes.length > 0 ? metricVotes : null,
    myVote: overallVote ? (overallVote.value as 'up' | 'down') : null,
  };
}

export async function getResults(prisma: Prisma, proposalId: string): Promise<VotingResults> {
  const proposal = await requireProposal(prisma, proposalId);
  const metrics = jsonArray<MetricName>(proposal.votingMetrics);
  return computeResults(metrics.length > 0 ? metrics : [...METRIC_NAMES], proposal.votes);
}

export async function submitVotes(
  prisma: Prisma,
  userId: string,
  proposalId: string,
  votes: MetricVote[],
): Promise<{ myVotes: MetricVote[]; results: VotingResults }> {
  const proposal = await requireProposal(prisma, proposalId);
  if (proposal.status !== 'open') {
    throw AppError.conflict('Voting has closed for this proposal.', 'PROPOSAL_CLOSED');
  }

  const required = new Set(jsonArray<MetricName>(proposal.votingMetrics));
  const submitted = new Set(votes.map((vote) => vote.metric));
  if (required.size === 0) {
    throw AppError.badRequest('Proposal has no voting metrics.', 'INVALID_BALLOT');
  }
  if (submitted.size !== votes.length) {
    throw AppError.badRequest('Ballot has a duplicate metric.', 'DUPLICATE_METRIC');
  }
  for (const metric of submitted) {
    if (!required.has(metric)) {
      throw AppError.badRequest(
        `"${metric}" is not a voting metric on this proposal.`,
        'UNKNOWN_METRIC',
      );
    }
  }
  for (const metric of required) {
    if (!submitted.has(metric)) {
      throw AppError.badRequest(`Ballot is missing a vote for "${metric}".`, 'MISSING_METRIC');
    }
  }

  await prisma.$transaction([
    prisma.vote.deleteMany({ where: { userId, proposalId } }),
    prisma.vote.createMany({
      data: votes.map((vote) => ({
        id: generateId(IdPrefix.vote),
        userId,
        proposalId,
        metric: vote.metric,
        support: vote.support,
        value: vote.support ? 'up' : 'down',
      })),
    }),
  ]);

  const results = await getResults(prisma, proposalId);
  return { myVotes: votes, results };
}

export async function setLegacyVote(
  prisma: Prisma,
  userId: string,
  proposalId: string,
  value: 'up' | 'down',
): Promise<{ myVote: 'up' | 'down'; counts: VoteCounts }> {
  const proposal = await requireProposal(prisma, proposalId);
  if (proposal.status !== 'open') {
    throw AppError.conflict('Voting on this proposal has ended.', 'PROPOSAL_CLOSED');
  }
  await prisma.vote.upsert({
    where: { userId_proposalId_metric: { userId, proposalId, metric: 'overall' } },
    update: { value, support: value === 'up' },
    create: {
      id: generateId(IdPrefix.vote),
      userId,
      proposalId,
      metric: 'overall',
      value,
      support: value === 'up',
    },
  });
  const votes = await prisma.vote.findMany({
    where: { proposalId },
    select: { userId: true, metric: true, support: true, value: true },
  });
  const overall = votes.filter((vote) => vote.metric === 'overall');
  return {
    myVote: value,
    counts: {
      up: overall.filter((vote) => vote.support || vote.value === 'up').length,
      down: overall.filter((vote) => !vote.support && vote.value !== 'up').length,
    },
  };
}

export async function retractLegacyVote(
  prisma: Prisma,
  userId: string,
  proposalId: string,
): Promise<{ myVote: null; counts: VoteCounts }> {
  const proposal = await requireProposal(prisma, proposalId);
  if (proposal.status !== 'open') {
    throw AppError.conflict('Voting on this proposal has ended.', 'PROPOSAL_CLOSED');
  }
  await prisma.vote.deleteMany({ where: { userId, proposalId, metric: 'overall' } });
  const votes = await prisma.vote.findMany({
    where: { proposalId },
    select: { userId: true, metric: true, support: true, value: true },
  });
  const overall = votes.filter((vote) => vote.metric === 'overall');
  return {
    myVote: null,
    counts: {
      up: overall.filter((vote) => vote.support || vote.value === 'up').length,
      down: overall.filter((vote) => !vote.support && vote.value !== 'up').length,
    },
  };
}

export async function closeProposal(prisma: Prisma, proposalId: string): Promise<Proposal> {
  const proposal = await requireProposal(prisma, proposalId);
  if (proposal.status !== 'open') {
    throw AppError.conflict('This proposal is already closed.', 'PROPOSAL_CLOSED');
  }
  const results = computeResults(
    jsonArray<MetricName>(proposal.votingMetrics) as MetricName[],
    proposal.votes,
  );
  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: isLegacyProposal(proposal) ? 'closed' : results.outcomeIfClosedNow },
    include: { votes: true },
  });
  return toProposalDto(updated);
}
