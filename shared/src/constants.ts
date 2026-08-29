export const METRIC_NAMES = [
  "accessibility",
  "sustainability",
  "efficiency",
  "community",
  "resilience",
  "inclusion",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export const METRIC_LABELS: Record<MetricName, string> = {
  accessibility: "Access",
  sustainability: "Sustain",
  efficiency: "Efficiency",
  community: "Community",
  resilience: "Resilience",
  inclusion: "Inclusion",
};

export const BLOCK_TYPE_IDS = [
  "housing",
  "healthcare",
  "education",
  "transport",
  "park",
  "community_hub",
  "technology_hub",
  "shared_resource_hub",
  "culture_heritage",
] as const;

export type BlockTypeId = (typeof BLOCK_TYPE_IDS)[number];

export const PERSONA_IDS = [
  "older_resident",
  "wheelchair_user",
  "parent_stroller",
  "child_student",
  "remote_worker",
  "limited_digital_access",
  "non_english_speaker",
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export const EVENT_TYPES = ["flood", "tech_outage", "population_change"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const PROPOSAL_STATUSES = ["open", "approved", "rejected", "reconsider"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const GRID_SIZE = 10;
export const DEFAULT_BLOCK_BUDGET = 100;
export const ENGINE_VERSION = "0.3.0";

export const APPROVAL_APPROVED_AT = 60;
export const APPROVAL_REJECTED_BELOW = 40;

export const PUBLIC_PATHS = [
  "/auth/register",
  "/auth/login",
  "/catalog/block-types",
  "/catalog/personas",
];
