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
