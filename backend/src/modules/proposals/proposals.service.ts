import { METRIC_NAMES, OUTCOME_RULE } from '../../config/constants.js';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { generateId, IdPrefix } from '../../lib/ids.js';
import type {
  MetricName,
  MetricVote,
  Proposal,
  ProposalDetail,
  ProposalInput,
  VotingResults,
} from './proposals.schemas.js';

type Prisma = typeof PrismaClient;
type ProposalRow = NonNullable<Awaited<ReturnType<Prisma['proposal']['findFirst']>>>;
type VoteRow = { userId: string; metric: string; support: boolean };

const round1 = (n: number) => Math.round(n * 10) / 10;

function computeResults(votingMetrics: MetricName[], votes: VoteRow[]): VotingResults {
  const metricResults = votingMetrics.map((metric) => {
    const forMetric = votes.filter((v) => v.metric === metric);
    const supportCount = forMetric.filter((v) => v.support).length;
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
      : round1(metricResults.reduce((sum, m) => sum + m.supportPct, 0) / metricResults.length);

  const outcomeIfClosedNow =
    overallApprovalPct >= OUTCOME_RULE.approvedAtOrAbovePct
      ? 'approved'
      : overallApprovalPct < OUTCOME_RULE.rejectedBelowPct
        ? 'rejected'
        : 'reconsider';

  return {
    totalVoters: new Set(votes.map((v) => v.userId)).size,
    metricResults,
    overallApprovalPct,
    outcomeIfClosedNow,
  };
}

function toProposalDto(proposal: ProposalRow & { votes: VoteRow[] }): Proposal {
  const votingMetrics = proposal.votingMetrics as MetricName[];
  return {
    id: proposal.id,
    title: proposal.title,
    description: proposal.description,
    location:
      proposal.locationX != null && proposal.locationY != null
        ? { x: proposal.locationX, y: proposal.locationY }
        : null,
    blockCost: proposal.blockCost,
    expectedBenefits: proposal.expectedBenefits as string[],
    affectedPersonaIds: proposal.affectedPersonaIds as string[],
    votingMetrics,
    status: proposal.status as Proposal['status'],
    results: computeResults(votingMetrics, proposal.votes),
    createdAt: proposal.createdAt.toISOString(),
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

export async function listProposals(
  prisma: Prisma,
  status?: Proposal['status'],
): Promise<Proposal[]> {
  const proposals = await prisma.proposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { votes: true },
  });
  return proposals.map(toProposalDto);
}

export async function createProposal(prisma: Prisma, input: ProposalInput): Promise<Proposal> {
  const proposal = await prisma.proposal.create({
    data: {
      id: generateId(IdPrefix.proposal),
      title: input.title,
      description: input.description,
      locationX: input.location?.x ?? null,
      locationY: input.location?.y ?? null,
      blockCost: input.blockCost,
      expectedBenefits: input.expectedBenefits ?? [],
      affectedPersonaIds: input.affectedPersonaIds ?? [],
      votingMetrics: input.votingMetrics,
    },
    include: { votes: true },
  });
  return toProposalDto(proposal);
}

export async function getProposalDetail(
  prisma: Prisma,
  userId: string,
  proposalId: string,
): Promise<ProposalDetail> {
  const proposal = await requireProposal(prisma, proposalId);
  const myVoteRows = proposal.votes.filter((v) => v.userId === userId);
  const myVotes: MetricVote[] | null =
    myVoteRows.length === 0
      ? null
      : myVoteRows.map((v) => ({ metric: v.metric as MetricName, support: v.support }));
  return { ...toProposalDto(proposal), myVotes };
}

export async function getResults(prisma: Prisma, proposalId: string): Promise<VotingResults> {
  const proposal = await requireProposal(prisma, proposalId);
  return computeResults(proposal.votingMetrics as MetricName[], proposal.votes);
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

  const required = new Set(proposal.votingMetrics as MetricName[]);
  const submitted = new Set(votes.map((v) => v.metric));
  if (submitted.size !== votes.length) {
    throw AppError.badRequest('Ballot has a duplicate metric.', 'DUPLICATE_METRIC');
  }
  for (const metric of submitted) {
    if (!required.has(metric))
      throw AppError.badRequest(
        `"${metric}" is not a voting metric on this proposal.`,
        'UNKNOWN_METRIC',
      );
  }
  for (const metric of required) {
    if (!submitted.has(metric))
      throw AppError.badRequest(`Ballot is missing a vote for "${metric}".`, 'MISSING_METRIC');
  }

  await prisma.$transaction([
    prisma.vote.deleteMany({ where: { userId, proposalId } }),
    prisma.vote.createMany({
      data: votes.map((v) => ({
        id: generateId(IdPrefix.vote),
        userId,
        proposalId,
        metric: v.metric,
        support: v.support,
      })),
    }),
  ]);

  const results = await getResults(prisma, proposalId);
  return { myVotes: votes, results };
}

export async function closeProposal(prisma: Prisma, proposalId: string): Promise<Proposal> {
  const proposal = await requireProposal(prisma, proposalId);
  if (proposal.status !== 'open') {
    throw AppError.conflict('This proposal is already closed.', 'ALREADY_CLOSED');
  }
  const results = computeResults(proposal.votingMetrics as MetricName[], proposal.votes);
  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: results.outcomeIfClosedNow },
    include: { votes: true },
  });
  return toProposalDto(updated);
}

// Re-exported so the seed script can build ballots without duplicating the metric list.
export const ALL_METRIC_NAMES = METRIC_NAMES;
