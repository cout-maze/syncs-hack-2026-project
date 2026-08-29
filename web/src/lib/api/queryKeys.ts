import type { ProposalStatus } from '@rmc/shared';

/** Central key factory so invalidation never guesses. */
export const queryKeys = {
  me: ['me'] as const,
  blockTypes: ['catalog', 'block-types'] as const,
  personas: ['catalog', 'personas'] as const,
  cities: ['cities'] as const,
  city: (cityId: string) => ['cities', cityId] as const,
  councilCity: ['cities', 'council'] as const,
  simulation: (cityId: string) => ['cities', cityId, 'simulation'] as const,
  proposals: (status?: ProposalStatus) => ['proposals', status ?? 'all'] as const,
  proposal: (proposalId: string) => ['proposals', 'detail', proposalId] as const,
  proposalResults: (proposalId: string) => ['proposals', 'detail', proposalId, 'results'] as const,
} as const;
