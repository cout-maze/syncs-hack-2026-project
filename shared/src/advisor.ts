import { z } from 'zod';
import { MetricNameSchema } from './city';

/**
 * Mirrors specs/advisor-service.yaml.
 *
 * Hard rules from the proposal doc: the Advisor explains and advises. It never changes
 * game state, and it never predicts, assigns or decides proposal voting scores.
 */

export const CitySnapshotSchema = z.object({
  gridWidth: z.number().int(),
  gridHeight: z.number().int(),
  blockBudget: z.number().int(),
  blocksUsed: z.number().int(),
  blocks: z.array(
    z.object({
      id: z.string(),
      typeId: z.string(),
      x: z.number().int(),
      y: z.number().int(),
    }),
  ),
});

export const AdvisorReportSchema = z.object({
  /** One-sentence summary, concrete over generic. */
  headline: z.string(),
  biggestWeakness: z.object({
    metric: MetricNameSchema,
    explanation: z.string(),
  }),
  affectedGroups: z.array(
    z.object({
      personaId: z.string(),
      impact: z.string(),
    }),
  ),
  tradeoffs: z.array(z.string()).default([]),
  /** 1-3 small, concrete changes the player can try. */
  suggestions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      /** Metrics this change should improve — advisory, not a promise. */
      expectedImpact: z.array(MetricNameSchema).default([]),
    }),
  ),
  /** True when this is a canned response because the LLM was unavailable. */
  fallback: z.boolean().default(false),
});

export const ProposalExplanationSchema = z.object({
  explanation: z.string(),
  tradeoffs: z.array(z.string()).default([]),
  /**
   * Present only when votingResults were sent. Describes what the votes show —
   * never a prediction, never a recommendation on how to vote.
   */
  communityReadout: z.string().nullable().optional(),
  fallback: z.boolean().default(false),
});

export const NewspaperSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  voteResult: z.string(),
  otherHeadlines: z.array(z.string()),
  fallback: z.boolean(),
});

export const CitizenPerspectiveSchema = z.object({
  persona: z.string(),
  emoji: z.string(),
  quote: z.string(),
});

export const CitizenPerspectivesResponseSchema = z.object({
  perspectives: z.array(CitizenPerspectiveSchema),
  advisorSummary: z.string(),
  fallback: z.boolean(),
});

export type CitySnapshot = z.infer<typeof CitySnapshotSchema>;
export type AdvisorReport = z.infer<typeof AdvisorReportSchema>;
export type ProposalExplanation = z.infer<typeof ProposalExplanationSchema>;
export type Newspaper = z.infer<typeof NewspaperSchema>;
export type CitizenPerspective = z.infer<typeof CitizenPerspectiveSchema>;
export type CitizenPerspectivesResponse = z.infer<typeof CitizenPerspectivesResponseSchema>;
