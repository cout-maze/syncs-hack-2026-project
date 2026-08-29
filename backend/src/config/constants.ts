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

export const CHANGE_TYPES = ['add', 'replace', 'remove'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const VOTE_VALUES = ['up', 'down'] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];

export const PROPOSAL_STATUSES = ['open', 'closed'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_GRID_SIZE = 40;
