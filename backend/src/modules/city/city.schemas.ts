import { z } from 'zod';
import {
  BLOCK_CATEGORIES,
  BLOCK_TYPE_IDS,
  EVENT_TYPES,
  PERSONA_IDS,
} from '../../config/constants.js';

// --- Catalog (public) -----------------------------------------------------

export const BlockTypeIdSchema = z.enum(BLOCK_TYPE_IDS);

export const BlockTypeSchema = z.object({
  id: BlockTypeIdSchema,
  name: z.string(),
  category: z.enum(BLOCK_CATEGORIES),
  cost: z.number().int().min(1),
  description: z.string(),
  benefits: z.array(z.string()).optional(),
  tradeoffs: z.array(z.string()).optional(),
  icon: z.string().optional(),
});
export type BlockType = z.infer<typeof BlockTypeSchema>;

export const PersonaSchema = z.object({
  id: z.enum(PERSONA_IDS),
  name: z.string(),
  description: z.string(),
  priorityServices: z.array(z.string()),
  accessibilityNeeds: z.array(z.string()).optional(),
  maxComfortableJourneyMinutes: z.number().int().optional(),
});
export type Persona = z.infer<typeof PersonaSchema>;

// --- Placed blocks ----------------------------------------------------------

export const PlacedBlockInputSchema = z.object({
  typeId: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});
export type PlacedBlockInput = z.infer<typeof PlacedBlockInputSchema>;

export const PlacedBlockSchema = PlacedBlockInputSchema.extend({ id: z.string() });
export type PlacedBlock = z.infer<typeof PlacedBlockSchema>;

export const PlaceBlockBodySchema = PlacedBlockInputSchema;

export const MoveBlockBodySchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const ReplaceBlocksBodySchema = z.object({
  blocks: z.array(PlacedBlockInputSchema),
});

export const BlockMutationResultSchema = z.object({
  block: PlacedBlockSchema,
  blocksUsed: z.number().int(),
  blockBudget: z.number().int(),
});
export type BlockMutationResult = z.infer<typeof BlockMutationResultSchema>;

// --- Cities ---------------------------------------------------------------

export const CreateCityBodySchema = z.object({
  name: z.string().max(60).optional(),
});

export const RenameCityBodySchema = z.object({
  name: z.string().max(60),
});

export const CitySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  blocksUsed: z.number().int(),
  blockBudget: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type CitySummary = z.infer<typeof CitySummarySchema>;

export const CitySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  gridWidth: z.number().int(),
  gridHeight: z.number().int(),
  blockBudget: z.number().int(),
  blocksUsed: z.number().int(),
  blocks: z.array(PlacedBlockSchema),
  lastSimulation: z.lazy(() => SimulationResultSchema).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type City = z.infer<typeof CitySchema>;

// --- Simulation results (stored verbatim from the client-side engine) -------

export const MetricsSchema = z
  .object({
    accessibility: z.number().min(0).max(100),
    sustainability: z.number().min(0).max(100),
    efficiency: z.number().min(0).max(100),
    community: z.number().min(0).max(100),
    resilience: z.number().min(0).max(100),
    inclusion: z.number().min(0).max(100),
  })
  .strict();
export type Metrics = z.infer<typeof MetricsSchema>;

export const JourneySchema = z.object({
  personaId: z.string(),
  fromBlockId: z.string().nullable().optional(),
  targetService: z.string(),
  pathBlockIds: z.array(z.string()).default([]),
  travelTimeMinutes: z.number(),
  accessible: z.boolean(),
  issues: z.array(z.string()).default([]),
});
export type Journey = z.infer<typeof JourneySchema>;

export const EventResultSchema = z.object({
  eventType: z.enum(EVENT_TYPES),
  passed: z.boolean(),
  affectedBlockIds: z.array(z.string()).default([]),
  affectedPersonaIds: z.array(z.string()).default([]),
  summary: z.string(),
});
export type EventResult = z.infer<typeof EventResultSchema>;

export const SimulationResultInputSchema = z.object({
  metrics: MetricsSchema,
  journeys: z.array(JourneySchema),
  events: z.array(EventResultSchema),
  engineVersion: z.string().optional(),
});
export type SimulationResultInput = z.infer<typeof SimulationResultInputSchema>;

export const SimulationResultSchema = SimulationResultInputSchema.extend({
  runAt: z.iso.datetime(),
});
export type SimulationResult = z.infer<typeof SimulationResultSchema>;

// --- Params / errors ---------------------------------------------------------

export const CityIdParamsSchema = z.object({
  cityId: z.string().min(1),
});

export const BlockIdParamsSchema = CityIdParamsSchema.extend({
  blockId: z.string().min(1),
});

export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
