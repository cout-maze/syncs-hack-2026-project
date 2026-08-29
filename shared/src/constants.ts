/**
 * Locked vocabulary for the whole product.
 *
 * These ids appear in four places at once: the OpenAPI specs, the simulation engine,
 * the proposal voting metrics and the Advisor prompts. Changing one of them is a
 * spec change — see docs/00-architecture-overview.md before touching this file.
 */

/* ------------------------------------------------------------------ metrics */

export const METRIC_NAMES = [
  'accessibility',
  'sustainability',
  'efficiency',
  'community',
  'resilience',
  'inclusion',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

/** Display order and copy. Reuse everywhere so sim results and voting speak the same language. */
export const METRIC_LABELS: Record<MetricName, string> = {
  accessibility: 'Accessibility',
  sustainability: 'Sustainability',
  efficiency: 'Efficiency',
  community: 'Community',
  resilience: 'Resilience',
  inclusion: 'Inclusion',
};

export const METRIC_DESCRIPTIONS: Record<MetricName, string> = {
  accessibility: 'How easily different residents can reach essential services and public spaces.',
  sustainability: 'How efficiently the city uses land, infrastructure and shared resources.',
  efficiency: 'How effectively the city uses its limited block budget.',
  community: 'How well public and community infrastructure supports social interaction.',
  resilience: 'How well the city keeps working when infrastructure is disrupted.',
  inclusion: 'How effectively people with different needs can take part in city life.',
};

/* -------------------------------------------------------------- block types */

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

export const BLOCK_CATEGORIES = [
  'people',
  'service',
  'infrastructure',
  'community',
  'technology',
  'culture',
] as const;

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

/* ----------------------------------------------------------------- personas */

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

/* ------------------------------------------------------------------- events */

export const EVENT_TYPES = ['flood', 'tech_outage', 'population_change'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  flood: 'Flood',
  tech_outage: 'Technology outage',
  population_change: 'Population change',
};

/* ---------------------------------------------------------------- proposals */

export const PROPOSAL_STATUSES = ['open', 'approved', 'rejected', 'reconsider'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  open: 'Open for voting',
  approved: 'Approved',
  rejected: 'Rejected',
  reconsider: 'Needs reconsideration',
};

/**
 * Outcome rule from proposal-service.yaml. The backend is authoritative — this copy
 * exists so the UI can explain the thresholds, never to compute an outcome itself.
 */
export const OUTCOME_THRESHOLDS = { approved: 60, rejected: 40 } as const;

/* -------------------------------------------------------------- grid basics */

export const DEFAULT_GRID_WIDTH = 10;
export const DEFAULT_GRID_HEIGHT = 10;
export const DEFAULT_BLOCK_BUDGET = 100;

/* ---------------------------------------------------------- error envelope */

/** Error codes the frontend branches on. The server may send others; treat them as generic. */
export const ERROR_CODES = {
  emailTaken: 'EMAIL_TAKEN',
  invalidCredentials: 'INVALID_CREDENTIALS',
  unauthorized: 'UNAUTHORIZED',
  notFound: 'NOT_FOUND',
  cellOccupied: 'CELL_OCCUPIED',
  outOfBounds: 'OUT_OF_BOUNDS',
  budgetExceeded: 'BUDGET_EXCEEDED',
  proposalClosed: 'PROPOSAL_CLOSED',
  invalidBallot: 'INVALID_BALLOT',
  llmUnavailable: 'LLM_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
