/**
 * Values that must stay identical across every module (and, per
 * docs/00-architecture-overview.md, across the frontend's Zod schemas too).
 * Single source of truth = specs/city-service.yaml.
 */

export const METRIC_NAMES = [
  'accessibility',
  'sustainability',
  'efficiency',
  'community',
  'resilience',
  'inclusion',
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export const BLOCK_TYPE_IDS = [
  'housing',
  'healthcare',
  'education',
  'transport',
  'park',
  'community_hub',
  'technology_hub',
  'shared_resource_hub',
  'culture_heritage',
] as const;
export type BlockTypeId = (typeof BLOCK_TYPE_IDS)[number];

export const PERSONA_IDS = [
  'older_resident',
  'wheelchair_user',
  'parent_stroller',
  'child_student',
  'remote_worker',
  'limited_digital_access',
  'non_english_speaker',
] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export const EVENT_TYPES = ['flood', 'tech_outage', 'population_change'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const PROPOSAL_STATUSES = ['open', 'approved', 'rejected', 'reconsider'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Outcome thresholds from proposal-service.yaml — config, not hard-coded. */
export const OUTCOME_RULE = {
  approvedAtOrAbovePct: 60,
  rejectedBelowPct: 40,
} as const;

export const DEFAULT_GRID_SIZE = 10;
export const DEFAULT_BLOCK_BUDGET = 100;
