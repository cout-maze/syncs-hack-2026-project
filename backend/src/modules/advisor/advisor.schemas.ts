import { z } from 'zod';

export const ExplainProposalBodySchema = z.object({
  proposalId: z.string(),
});

export const ProposalExplanationSchema = z.object({
  explanation: z.string(),
  tradeoffs: z.array(z.string()).optional(),
  fallback: z.boolean(),
});

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ProposalExplanation = z.infer<typeof ProposalExplanationSchema>;

export const NewspaperSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  voteResult: z.string(),
  otherHeadlines: z.array(z.string()),
  fallback: z.boolean(),
});

export type Newspaper = z.infer<typeof NewspaperSchema>;

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

export type CitizenPerspectivesResponse = z.infer<typeof CitizenPerspectivesResponseSchema>;
