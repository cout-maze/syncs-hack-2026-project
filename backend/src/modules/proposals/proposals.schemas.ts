import { z } from 'zod';
import {
  BLOCK_TYPE_IDS,
  CHANGE_TYPES,
  PROPOSAL_STATUSES,
  VOTE_VALUES,
} from '../../config/constants.js';

export const ChangeTypeSchema = z.enum(CHANGE_TYPES);
export const VoteValueSchema = z.enum(VOTE_VALUES);
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export const BlockTypeIdSchema = z.enum(BLOCK_TYPE_IDS);

export const ProposalInputSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  changeType: ChangeTypeSchema,
  blockTypeId: z.string().nullable().optional(),
});

export const VoteCountsSchema = z.object({
  up: z.number().int().min(0),
  down: z.number().int().min(0),
});

export const ProposalSchema = ProposalInputSchema.extend({
  id: z.string(),
  status: ProposalStatusSchema,
  counts: VoteCountsSchema,
  createdAt: z.string(),
  closedAt: z.string().nullable(),
});

export const ProposalDetailSchema = ProposalSchema.extend({
  myVote: VoteValueSchema.nullable(),
});

export const SetVoteBodySchema = z.object({
  value: VoteValueSchema,
});

export const VoteStateSchema = z.object({
  myVote: VoteValueSchema.nullable(),
  counts: VoteCountsSchema,
});

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const ProposalIdParamsSchema = z.object({ proposalId: z.string() });
export const ListProposalsQuerySchema = z.object({ status: ProposalStatusSchema.optional() });

export type ProposalInput = z.infer<typeof ProposalInputSchema>;
export type VoteCounts = z.infer<typeof VoteCountsSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalDetail = z.infer<typeof ProposalDetailSchema>;
export type VoteValue = z.infer<typeof VoteValueSchema>;
export type VoteState = z.infer<typeof VoteStateSchema>;
