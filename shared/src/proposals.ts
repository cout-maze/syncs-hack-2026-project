import { z } from 'zod';
import { IsoDateTimeSchema } from './common';
import { PROPOSAL_STATUSES } from './constants';
import { MetricNameSchema } from './city';

/** Mirrors specs/proposal-service.yaml. */

export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export const MetricVoteSchema = z.object({
  metric: MetricNameSchema,
  /** true = support, false = oppose. */
  support: z.boolean(),
});

export const MetricResultSchema = z.object({
  metric: MetricNameSchema,
  supportCount: z.number().int(),
  opposeCount: z.number().int(),
  /** supportCount / (supportCount + opposeCount) x 100, 1 dp. 0 voters -> 0. */
  supportPct: z.number(),
});

/**
 * Derived purely from submitted vote rows — never AI-generated.
 * This is a hard rule from the proposal doc; the UI must show counts, not just percentages.
 */
export const VotingResultsSchema = z.object({
  totalVoters: z.number().int(),
  metricResults: z.array(MetricResultSchema),
  overallApprovalPct: z.number(),
  /** What the outcome rule would decide right now — a UI hint while voting is open. */
  outcomeIfClosedNow: z.enum(['approved', 'rejected', 'reconsider']).optional(),
});

export const ProposalLocationSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const ProposalInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  location: ProposalLocationSchema.nullable().optional(),
  blockCost: z.number().int().min(0),
  expectedBenefits: z.array(z.string()).default([]),
  /** Persona ids from the City service catalog. */
  affectedPersonaIds: z.array(z.string()).default([]),
  /** Which metrics citizens vote on for this proposal. Build the ballot UI from this. */
  votingMetrics: z.array(MetricNameSchema).min(1),
});

export const ProposalSchema = ProposalInputSchema.extend({
  id: z.string(),
  status: ProposalStatusSchema,
  results: VotingResultsSchema,
  createdAt: IsoDateTimeSchema,
});

export const ProposalDetailSchema = ProposalSchema.extend({
  /** The current user's submitted ballot; null if they haven't voted. */
  myVotes: z.array(MetricVoteSchema).nullable().optional(),
});

export const SubmitVotesResponseSchema = z.object({
  myVotes: z.array(MetricVoteSchema),
  results: VotingResultsSchema,
});

export type ProposalStatusValue = z.infer<typeof ProposalStatusSchema>;
export type MetricVote = z.infer<typeof MetricVoteSchema>;
export type MetricResult = z.infer<typeof MetricResultSchema>;
export type VotingResults = z.infer<typeof VotingResultsSchema>;
export type ProposalInput = z.infer<typeof ProposalInputSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalDetail = z.infer<typeof ProposalDetailSchema>;
export type SubmitVotesResponse = z.infer<typeof SubmitVotesResponseSchema>;
