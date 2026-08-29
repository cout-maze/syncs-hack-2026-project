import { z } from 'zod';
import { EVENT_TYPES, METRIC_NAMES } from '../../config/constants.js';

const MetricNameSchema = z.enum(METRIC_NAMES);

export const CitySnapshotSchema = z.object({
  gridWidth: z.number().int(),
  gridHeight: z.number().int(),
  blockBudget: z.number().int(),
  blocksUsed: z.number().int(),
  blocks: z.array(
    z.object({ id: z.string(), typeId: z.string(), x: z.number().int(), y: z.number().int() }),
  ),
});

export const SimulationPayloadSchema = z.object({
  metrics: z.object({
    accessibility: z.number().min(0).max(100),
    sustainability: z.number().min(0).max(100),
    efficiency: z.number().min(0).max(100),
    community: z.number().min(0).max(100),
    resilience: z.number().min(0).max(100),
    inclusion: z.number().min(0).max(100),
  }),
  journeys: z.array(
    z.object({
      personaId: z.string(),
      targetService: z.string(),
      travelTimeMinutes: z.number(),
      accessible: z.boolean(),
      issues: z.array(z.string()).optional(),
    }),
  ),
  events: z.array(
    z.object({
      eventType: z.enum(EVENT_TYPES),
      passed: z.boolean(),
      affectedPersonaIds: z.array(z.string()).optional(),
      summary: z.string(),
    }),
  ),
});

export const AnalyseCityBodySchema = z.object({
  city: CitySnapshotSchema,
  simulation: SimulationPayloadSchema,
  focus: MetricNameSchema.nullable().optional(),
});

export const AdvisorReportSchema = z.object({
  headline: z.string(),
  biggestWeakness: z.object({ metric: MetricNameSchema, explanation: z.string() }),
  affectedGroups: z.array(z.object({ personaId: z.string(), impact: z.string() })),
  tradeoffs: z.array(z.string()).optional(),
  suggestions: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        expectedImpact: z.array(MetricNameSchema).optional(),
      }),
    )
    .max(3),
  fallback: z.boolean().default(false),
});

export const ExplainProposalBodySchema = z.object({
  proposalId: z.string(),
  votingResults: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const ProposalExplanationSchema = z.object({
  explanation: z.string(),
  tradeoffs: z.array(z.string()).optional(),
  communityReadout: z.string().nullable().optional(),
  fallback: z.boolean().default(false),
});

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type CitySnapshot = z.infer<typeof CitySnapshotSchema>;
export type SimulationPayload = z.infer<typeof SimulationPayloadSchema>;
export type AdvisorReport = z.infer<typeof AdvisorReportSchema>;
export type ProposalExplanation = z.infer<typeof ProposalExplanationSchema>;
