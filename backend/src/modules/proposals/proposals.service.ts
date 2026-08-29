import { BLOCK_TYPE_IDS, DEFAULT_GRID_SIZE } from '../../config/constants.js';
import type { prisma as PrismaClient } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { generateId, IdPrefix } from '../../lib/ids.js';
import type { Proposal, ProposalDetail, ProposalInput, VoteCounts, VoteState } from './proposals.schemas.js';

type Prisma = typeof PrismaClient;

interface ProposalRow {
  id: string;
  title: string;
  description: string;
  x: number;
  y: number;
  changeType: string;
  blockTypeId: string | null;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
}

async function getCounts(prisma: Prisma, proposalId: string): Promise<VoteCounts> {
  const votes = await prisma.vote.findMany({
    where: { proposalId },
    select: { value: true },
  });
  let up = 0;
  let down = 0;
  for (const v of votes) {
    if (v.value === 'up') up++;
    else down++;
  }
  return { up, down };
}

function toProposalDto(row: ProposalRow, counts: VoteCounts): Proposal {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    x: row.x,
    y: row.y,
    changeType: row.changeType as Proposal['changeType'],
    blockTypeId: row.blockTypeId,
    status: row.status as Proposal['status'],
    counts,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

async function requireProposal(prisma: Prisma, proposalId: string): Promise<ProposalRow> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw AppError.notFound('Proposal not found.', 'PROPOSAL_NOT_FOUND');
  return proposal as ProposalRow;
}

function requireOpenProposal(proposal: ProposalRow) {
  if (proposal.status !== 'open') {
    throw AppError.conflict('Voting on this proposal has ended.', 'PROPOSAL_CLOSED');
  }
}

export async function listProposals(
  prisma: Prisma,
  status?: string,
): Promise<Proposal[]> {
  const proposals = await prisma.proposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  const results: Proposal[] = [];
  for (const p of proposals) {
    const counts = await getCounts(prisma, p.id);
    results.push(toProposalDto(p as ProposalRow, counts));
  }
  return results;
}

export async function createProposal(
  prisma: Prisma,
  input: ProposalInput,
  createdById: string,
): Promise<Proposal> {
  if (input.x < 0 || input.y < 0 || input.x >= DEFAULT_GRID_SIZE || input.y >= DEFAULT_GRID_SIZE) {
    throw AppError.badRequest(
      `Cell (${input.x}, ${input.y}) is outside the ${DEFAULT_GRID_SIZE}×${DEFAULT_GRID_SIZE} grid.`,
      'OUT_OF_BOUNDS',
    );
  }

  if (input.changeType !== 'remove') {
    if (!input.blockTypeId) {
      throw AppError.badRequest(
        'blockTypeId is required unless changeType is remove.',
        'BLOCK_TYPE_REQUIRED',
      );
    }
    if (!(BLOCK_TYPE_IDS as readonly string[]).includes(input.blockTypeId)) {
      throw AppError.badRequest(
        `Unknown block type: "${input.blockTypeId}".`,
        'BLOCK_TYPE_INVALID',
      );
    }
  }

  const realCity = await prisma.city.findFirst({ where: { kind: 'real' } });
  if (!realCity) throw AppError.badRequest('No real city exists yet.', 'VALIDATION_ERROR');

  const existingBlock = await prisma.placedBlock.findUnique({
    where: { cityId_x_y: { cityId: realCity.id, x: input.x, y: input.y } },
  });

  if (input.changeType === 'add' && existingBlock) {
    throw AppError.conflict(
      `Cell (${input.x}, ${input.y}) is already occupied.`,
      'CELL_OCCUPIED',
    );
  }
  if ((input.changeType === 'replace' || input.changeType === 'remove') && !existingBlock) {
    throw AppError.conflict(
      `Cell (${input.x}, ${input.y}) is empty.`,
      'CELL_EMPTY',
    );
  }

  const openAtCell = await prisma.proposal.findFirst({
    where: { x: input.x, y: input.y, status: 'open' },
  });
  if (openAtCell) {
    throw AppError.conflict(
      `An open proposal already exists at cell (${input.x}, ${input.y}).`,
      'PROPOSAL_EXISTS_AT_CELL',
    );
  }

  const proposal = await prisma.proposal.create({
    data: {
      id: generateId(IdPrefix.proposal),
      title: input.title,
      description: input.description,
      x: input.x,
      y: input.y,
      changeType: input.changeType,
      blockTypeId: input.changeType === 'remove' ? null : (input.blockTypeId ?? null),
      createdById,
    },
  });

  return toProposalDto(proposal as ProposalRow, { up: 0, down: 0 });
}

export async function getProposalDetail(
  prisma: Prisma,
  userId: string | null,
  proposalId: string,
): Promise<ProposalDetail> {
  const proposal = await requireProposal(prisma, proposalId);
  const counts = await getCounts(prisma, proposalId);

  let myVote: string | null = null;
  if (userId) {
    const vote = await prisma.vote.findUnique({
      where: { userId_proposalId: { userId, proposalId } },
    });
    myVote = vote?.value ?? null;
  }

  return {
    ...toProposalDto(proposal, counts),
    myVote: myVote as ProposalDetail['myVote'],
  };
}

export async function closeProposal(prisma: Prisma, proposalId: string): Promise<Proposal> {
  const proposal = await requireProposal(prisma, proposalId);
  requireOpenProposal(proposal);

  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: 'closed', closedAt: new Date() },
  });
  const counts = await getCounts(prisma, proposalId);
  return toProposalDto(updated as ProposalRow, counts);
}

export async function setVote(
  prisma: Prisma,
  userId: string,
  proposalId: string,
  value: string,
): Promise<VoteState> {
  const proposal = await requireProposal(prisma, proposalId);
  requireOpenProposal(proposal);

  await prisma.vote.upsert({
    where: { userId_proposalId: { userId, proposalId } },
    update: { value },
    create: {
      id: generateId(IdPrefix.vote),
      userId,
      proposalId,
      value,
    },
  });

  const counts = await getCounts(prisma, proposalId);
  return { myVote: value as VoteState['myVote'], counts };
}

export async function retractVote(
  prisma: Prisma,
  userId: string,
  proposalId: string,
): Promise<VoteState> {
  const proposal = await requireProposal(prisma, proposalId);
  requireOpenProposal(proposal);

  await prisma.vote.deleteMany({ where: { userId, proposalId } });

  const counts = await getCounts(prisma, proposalId);
  return { myVote: null, counts };
}
