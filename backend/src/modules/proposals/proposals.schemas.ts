import { z } from 'zod';
import { METRIC_NAMES, PROPOSAL_STATUSES } from '../../config/constants.js';

export const MetricNameSchema = z.enum(METRIC_NAMES);
export const ProposalStatusSchema = z.enum([...PROPOSAL_STATUSES, 'closed'] as [
  string,
  ...string[],
]);
export const OutcomeSchema = z.enum(['approved', 'rejected', 'reconsider']);

export const RichProposalInputSchema = z.object({
  title: z.string().min(1),
  issue: z.string().optional(),
  description: z.string().min(1),
  location: z
    .object({ x: z.number().int().min(0), y: z.number().int().min(0) })
    .nullable()
    .optional(),
  changes: z
    .array(
      z.object({
        op: z.enum(['place', 'remove', 'move']),
        typeId: z.string().optional(),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        blockId: z.string().nullable().optional(),
      }),
    )
    .optional(),
  blockCost: z.number().int().min(0),
  expectedBenefits: z.array(z.string()).default([]),
  affectedPersonaIds: z.array(z.string()).default([]),
  votingMetrics: z.array(MetricNameSchema).min(1),
});

export const LegacyProposalInputSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  changeType: z.enum(['add', 'replace', 'remove']),
  blockTypeId: z.string().nullable().optional(),
});

export const ProposalInputSchema = z.union([RichProposalInputSchema, LegacyProposalInputSchema]);
export const MetricVoteSchema = z.object({ metric: MetricNameSchema, support: z.boolean() });

export const MetricResultSchema = z.object({
  metric: MetricNameSchema,
  supportCount: z.number().int().min(0),
  opposeCount: z.number().int().min(0),
  supportPct: z.number(),
});

export const VotingResultsSchema = z.object({
  totalVoters: z.number().int().min(0),
  metricResults: z.array(MetricResultSchema),
  overallApprovalPct: z.number(),
  outcomeIfClosedNow: OutcomeSchema.optional(),
});

export const VoteCountsSchema = z.object({
  up: z.number().int().min(0),
  down: z.number().int().min(0),
});

export const ProposalSchema = RichProposalInputSchema.extend({
  id: z.string(),
  status: ProposalStatusSchema,
  results: VotingResultsSchema,
  createdAt: z.iso.datetime(),
  // Compatibility fields used by the original backend client.
  x: z.number().int().nullable().optional(),
  y: z.number().int().nullable().optional(),
  changeType: z.enum(['add', 'replace', 'remove']).nullable().optional(),
  blockTypeId: z.string().nullable().optional(),
  counts: VoteCountsSchema.optional(),
  closedAt: z.iso.datetime().nullable().optional(),
});

export const ProposalDetailSchema = ProposalSchema.extend({
  myVotes: z.array(MetricVoteSchema).nullable().optional(),
  myVote: z.enum(['up', 'down']).nullable().optional(),
});

export const SubmitVotesBodySchema = z.object({ votes: z.array(MetricVoteSchema).min(1) });
export const SubmitVotesResponseSchema = z.object({
  myVotes: z.array(MetricVoteSchema),
  results: VotingResultsSchema,
});

export const SetVoteBodySchema = z.object({ value: z.enum(['up', 'down']) });
export const VoteStateSchema = z.object({
  myVote: z.enum(['up', 'down']).nullable(),
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
export const ListProposalsQuerySchema = z.object({
  status: z.enum([...PROPOSAL_STATUSES, 'closed'] as [string, ...string[]]).optional(),
});

export type MetricName = z.infer<typeof MetricNameSchema>;
export type ProposalInput = z.infer<typeof ProposalInputSchema>;
export type LegacyProposalInput = z.infer<typeof LegacyProposalInputSchema>;
export type MetricVote = z.infer<typeof MetricVoteSchema>;
export type VotingResults = z.infer<typeof VotingResultsSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalDetail = z.infer<typeof ProposalDetailSchema>;
export type VoteCounts = z.infer<typeof VoteCountsSchema>;
