import { z } from 'zod';
import { IsoDateTimeSchema } from './common';
import {
  BLOCK_CATEGORIES,
  BLOCK_TYPE_IDS,
  EVENT_TYPES,
  METRIC_NAMES,
  PERSONA_IDS,
} from './constants';

/**
 * Mirrors specs/city-service.yaml.
 *
 * Rule of thumb used throughout: where the spec declares an `enum`, we enforce it;
 * where the spec says plain `string` (cross-references like `targetService` or
 * `priorityServices`), we keep it a string so a catalog tweak on the backend can't
 * hard-fail the UI mid-demo.
 */

export const BlockTypeIdSchema = z.enum(BLOCK_TYPE_IDS);
export const BlockCategorySchema = z.enum(BLOCK_CATEGORIES);
export const PersonaIdSchema = z.enum(PERSONA_IDS);
export const MetricNameSchema = z.enum(METRIC_NAMES);
export const EventTypeSchema = z.enum(EVENT_TYPES);

/* ----------------------------------------------------------------- catalog */

export const BlockTypeSchema = z.object({
  id: BlockTypeIdSchema,
  name: z.string(),
  category: BlockCategorySchema,
  /** Blocks of budget consumed per placement. */
  cost: z.number().int().min(1),
  description: z.string(),
  benefits: z.array(z.string()).default([]),
  tradeoffs: z.array(z.string()).default([]),
  /** Asset key for the Phaser sprite / UI icon. */
  icon: z.string().optional(),
});

export const PersonaSchema = z.object({
  id: PersonaIdSchema,
  name: z.string(),
  description: z.string(),
  /** Block-type ids this persona most needs to reach. */
  priorityServices: z.array(z.string()),
  accessibilityNeeds: z.array(z.string()).default([]),
  /** Journey-time threshold the sim engine uses to flag problems. */
  maxComfortableJourneyMinutes: z.number().int().optional(),
});

/* ------------------------------------------------------------------ blocks */

export const PlacedBlockInputSchema = z.object({
  typeId: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const PlacedBlockSchema = PlacedBlockInputSchema.extend({
  id: z.string(),
});

/* --------------------------------------------------------------- simulation */

export const MetricsSchema = z.object({
  accessibility: z.number().min(0).max(100),
  sustainability: z.number().min(0).max(100),
  efficiency: z.number().min(0).max(100),
  community: z.number().min(0).max(100),
  resilience: z.number().min(0).max(100),
  inclusion: z.number().min(0).max(100),
});

export const JourneySchema = z.object({
  personaId: z.string(),
  fromBlockId: z.string().nullable().optional(),
  /** Block-type id the resident is trying to reach. */
  targetService: z.string(),
  /** Ordered placed-block ids along the route — this is what drives the map animation. */
  pathBlockIds: z.array(z.string()).default([]),
  travelTimeMinutes: z.number(),
  /** False when the route is too long or unusable for this persona. */
  accessible: z.boolean(),
  issues: z.array(z.string()).default([]),
});

export const EventResultSchema = z.object({
  eventType: EventTypeSchema,
  passed: z.boolean(),
  affectedBlockIds: z.array(z.string()).default([]),
  affectedPersonaIds: z.array(z.string()).default([]),
  summary: z.string(),
});

/** What FE #2's engine must produce, and what gets PUT to the backend verbatim. */
export const SimulationResultInputSchema = z.object({
  metrics: MetricsSchema,
  journeys: z.array(JourneySchema),
  events: z.array(EventResultSchema),
  engineVersion: z.string().optional(),
});

export const SimulationResultSchema = SimulationResultInputSchema.extend({
  /** Server timestamp when the result was stored. */
  runAt: IsoDateTimeSchema,
});

/* ------------------------------------------------------------------ cities */

export const CitySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  blocksUsed: z.number().int(),
  blockBudget: z.number().int(),
  updatedAt: IsoDateTimeSchema,
});

/**
 * The single shared representation. Map, sim engine, advisor and proposals all read
 * from this — see docs/00-architecture-overview.md § "The integration contract".
 */
export const CitySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  gridWidth: z.number().int(),
  gridHeight: z.number().int(),
  blockBudget: z.number().int(),
  /** Sum of cost over placed blocks. Derived by the server; never trusted from the client. */
  blocksUsed: z.number().int(),
  blocks: z.array(PlacedBlockSchema),
  lastSimulation: SimulationResultSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const BlockMutationResultSchema = z.object({
  block: PlacedBlockSchema,
  blocksUsed: z.number().int(),
  blockBudget: z.number().int(),
});

/* ------------------------------------------------------------------- types */

export type BlockType = z.infer<typeof BlockTypeSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type PlacedBlockInput = z.infer<typeof PlacedBlockInputSchema>;
export type PlacedBlock = z.infer<typeof PlacedBlockSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type EventResult = z.infer<typeof EventResultSchema>;
export type SimulationResultInput = z.infer<typeof SimulationResultInputSchema>;
export type SimulationResult = z.infer<typeof SimulationResultSchema>;
export type CitySummary = z.infer<typeof CitySummarySchema>;
export type City = z.infer<typeof CitySchema>;
export type BlockMutationResult = z.infer<typeof BlockMutationResultSchema>;
