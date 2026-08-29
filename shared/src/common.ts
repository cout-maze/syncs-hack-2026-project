import { z } from 'zod';

/**
 * The error envelope every non-2xx response uses, app-wide.
 * See docs/00-architecture-overview.md § "Error shape".
 */
export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

/** ISO 8601 timestamp as produced by the backend. Kept lenient — Date.parse handles the rest. */
export const IsoDateTimeSchema = z.string().min(1);
