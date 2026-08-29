import { z } from "zod";
import {
  BLOCK_TYPE_IDS,
  EVENT_TYPES,
  METRIC_NAMES,
  PERSONA_IDS,
  PROPOSAL_STATUSES,
} from "./constants";

export const metricNameSchema = z.enum(METRIC_NAMES);
export const blockTypeIdSchema = z.enum(BLOCK_TYPE_IDS);
export const personaIdSchema = z.enum(PERSONA_IDS);
export const eventTypeSchema = z.enum(EVENT_TYPES);
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  createdAt: z.string(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: userSchema,
});

export const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(40),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const metricsSchema = z.object({
  accessibility: z.number().min(0).max(100),
  sustainability: z.number().min(0).max(100),
  efficiency: z.number().min(0).max(100),
  community: z.number().min(0).max(100),
  resilience: z.number().min(0).max(100),
  inclusion: z.number().min(0).max(100),
});

export const journeySchema = z.object({
  personaId: z.string(),
  fromBlockId: z.string().nullable().optional(),
  targetService: z.string(),
  pathBlockIds: z.array(z.string()).optional(),
  travelTimeMinutes: z.number(),
  accessible: z.boolean(),
  issues: z.array(z.string()).optional(),
});

export const eventResultSchema = z.object({
  eventType: eventTypeSchema,
  passed: z.boolean(),
  affectedBlockIds: z.array(z.string()).optional(),
  affectedPersonaIds: z.array(z.string()).optional(),
  summary: z.string(),
});

export const simulationResultInputSchema = z.object({
  metrics: metricsSchema,
  journeys: z.array(journeySchema),
  events: z.array(eventResultSchema),
  engineVersion: z.string().optional(),
});

export const simulationResultSchema = simulationResultInputSchema.extend({
  runAt: z.string(),
});

export const placedBlockInputSchema = z.object({
  typeId: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const placedBlockSchema = placedBlockInputSchema.extend({
  id: z.string(),
});

export const citySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  gridWidth: z.number().int(),
  gridHeight: z.number().int(),
  blockBudget: z.number().int(),
  blocksUsed: z.number().int(),
  blocks: z.array(placedBlockSchema),
  lastSimulation: simulationResultSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const citySnapshotSchema = z.object({
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

export const advisorAnalysisBodySchema = z.object({
  city: citySnapshotSchema,
  simulation: z.object({
    metrics: metricsSchema,
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
        eventType: eventTypeSchema,
        passed: z.boolean(),
        affectedPersonaIds: z.array(z.string()).optional(),
        summary: z.string(),
      }),
    ),
  }),
  focus: metricNameSchema.nullable().optional(),
});

export const advisorReportSchema = z.object({
  headline: z.string(),
  biggestWeakness: z.object({
    metric: metricNameSchema,
    explanation: z.string(),
  }),
  affectedGroups: z.array(
    z.object({
      personaId: z.string(),
      impact: z.string(),
    }),
  ),
  tradeoffs: z.array(z.string()).optional(),
  suggestions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      expectedImpact: z.array(metricNameSchema).optional(),
    }),
  ),
  fallback: z.boolean().optional(),
});

export const metricVoteSchema = z.object({
  metric: metricNameSchema,
  support: z.boolean(),
});

export const submitVotesBodySchema = z.object({
  votes: z.array(metricVoteSchema).min(1),
});

export const proposalInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  location: z
    .object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  blockCost: z.number().int().min(0),
  expectedBenefits: z.array(z.string()).optional(),
  affectedPersonaIds: z.array(z.string()).optional(),
  votingMetrics: z.array(metricNameSchema).min(1),
});
