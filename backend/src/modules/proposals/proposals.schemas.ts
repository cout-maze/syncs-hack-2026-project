import { z } from 'zod';
import { METRIC_NAMES, PROPOSAL_STATUSES } from '../../config/constants.js';

export const MetricNameSchema = z.enum(METRIC_NAMES);
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export const OutcomeSchema = z.enum(['approved', 'rejected', 'reconsider']);

export const ProposalInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  location: z
    .object({ x: z.number().int().min(0), y: z.number().int().min(0) })
    .nullable()
    .optional(),
  blockCost: z.number().int().min(0),
  expectedBenefits: z.array(z.string()).optional(),
  affectedPersonaIds: z.array(z.string()).optional(),
  votingMetrics: z.array(MetricNameSchema).min(1),
});

export const MetricVoteSchema = z.object({ metric: MetricNameSchema, support: z.boolean() });

export const MetricResultSchema = z.object({
  metric: MetricNameSchema,
  supportCount: z.number().int(),
  opposeCount: z.number().int(),
  supportPct: z.number(),
});

export const VotingResultsSchema = z.object({
  totalVoters: z.number().int(),
  metricResults: z.array(MetricResultSchema),
  overallApprovalPct: z.number(),
  outcomeIfClosedNow: OutcomeSchema.optional(),
});

export const ProposalSchema = ProposalInputSchema.extend({
  id: z.string(),
  status: ProposalStatusSchema,
  results: VotingResultsSchema,
  createdAt: z.iso.datetime(),
});

export const ProposalDetailSchema = ProposalSchema.extend({
  myVotes: z.array(MetricVoteSchema).nullable(),
});

export const SubmitVotesBodySchema = z.object({ votes: z.array(MetricVoteSchema).min(1) });
export const SubmitVotesResponseSchema = z.object({
  myVotes: z.array(MetricVoteSchema),
  results: VotingResultsSchema,
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

export type MetricName = z.infer<typeof MetricNameSchema>;
export type ProposalInput = z.infer<typeof ProposalInputSchema>;
export type MetricVote = z.infer<typeof MetricVoteSchema>;
export type VotingResults = z.infer<typeof VotingResultsSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalDetail = z.infer<typeof ProposalDetailSchema>;
