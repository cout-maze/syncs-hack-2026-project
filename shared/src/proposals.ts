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
 * The same ballots, split by the group each voter said they were speaking for.
 *
 * This is what turns "78% support" into the sentence the product is actually about:
 * older residents backed this 91%, remote workers 40%. Voters who did not name a group
 * are counted in the totals but not here.
 */
export const GroupResultSchema = z.object({
  /** Persona id from the City service catalog. */
  personaId: z.string(),
  voterCount: z.number().int(),
  /** Same rule as the overall figure, over this group's ballots only. */
  overallApprovalPct: z.number(),
});

/**
 * Derived purely from submitted vote rows — never AI-generated.
 * This is a hard rule from the proposal doc; the UI must show counts, not just percentages.
 */
export const VotingResultsSchema = z.object({
  totalVoters: z.number().int(),
  metricResults: z.array(MetricResultSchema),
  overallApprovalPct: z.number(),
  /** Empty when nobody rated as a group. Ordered strongest support first. */
  groupResults: z.array(GroupResultSchema).default([]),
  /** What the outcome rule would decide right now — a UI hint while voting is open. */
  outcomeIfClosedNow: z.enum(['approved', 'rejected', 'reconsider']).optional(),
});

export const ProposalLocationSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

/**
 * One edit a proposal would make to the city map.
 *
 * Shared shape: Proposal mode authors these by editing the builder, and Simulation mode's
 * auto-proposals emit the same thing, so a simulated change and a real one preview on the
 * map through identical code.
 */
export const BlockChangeSchema = z.object({
  op: z.enum(['place', 'remove', 'move']),
  /** Block-type id from the catalog. Required for `place`. */
  typeId: z.string().optional(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  /** Existing placed-block id. Required for `remove` and `move`. */
  blockId: z.string().nullable().optional(),
});

export const ProposalInputSchema = z.object({
  title: z.string(),
  /** The problem this proposal exists to solve, in plain language. Shown above the ballot. */
  issue: z.string().optional(),
  description: z.string(),
  location: ProposalLocationSchema.nullable().optional(),
  /** The block delta this proposal would apply. Absent on discussion-only proposals. */
  changes: z.array(BlockChangeSchema).optional(),
  blockCost: z.number().int().min(0),
  expectedBenefits: z.array(z.string()).default([]),
  /** Persona ids from the City service catalog. */
  affectedPersonaIds: z.array(z.string()).default([]),
  /** Which qualities citizens rate this proposal on. Build the ballot UI from this. */
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
  /** The group the current user rated as, if they named one. */
  myVoterGroup: z.string().nullable().optional(),
});

/**
 * A ballot, plus who the voter was speaking for.
 *
 * `voterGroup` is optional on purpose: nobody is forced to declare a persona to take
 * part, and a ballot without one still counts in every total.
 */
export const BallotSchema = z.object({
  votes: z.array(MetricVoteSchema).min(1),
  voterGroup: z.string().nullable().optional(),
});

export const SubmitVotesResponseSchema = z.object({
  myVotes: z.array(MetricVoteSchema),
  myVoterGroup: z.string().nullable().optional(),
  results: VotingResultsSchema,
});

export type ProposalStatusValue = z.infer<typeof ProposalStatusSchema>;
export type MetricVote = z.infer<typeof MetricVoteSchema>;
export type MetricResult = z.infer<typeof MetricResultSchema>;
export type GroupResult = z.infer<typeof GroupResultSchema>;
export type Ballot = z.infer<typeof BallotSchema>;
export type VotingResults = z.infer<typeof VotingResultsSchema>;
export type BlockChange = z.infer<typeof BlockChangeSchema>;
export type ProposalInput = z.infer<typeof ProposalInputSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalDetail = z.infer<typeof ProposalDetailSchema>;
export type SubmitVotesResponse = z.infer<typeof SubmitVotesResponseSchema>;
