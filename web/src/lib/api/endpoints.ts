import { z } from 'zod';
import {
  AdvisorReportSchema,
  AuthResponseSchema,
  BlockMutationResultSchema,
  BlockTypeSchema,
  CitySchema,
  CitySummarySchema,
  PersonaSchema,
  ProposalDetailSchema,
  ProposalSchema,
  ProposalExplanationSchema,
  SimulationResultSchema,
  SubmitVotesResponseSchema,
  UserSchema,
  VotingResultsSchema,
  type CitySnapshot,
  type LoginInput,
  type MetricName,
  type MetricVote,
  type PlacedBlockInput,
  type ProposalStatus,
  type RegisterInput,
  type SimulationResultInput,
  type VotingResults,
} from '@rmc/shared';
import { apiRequest } from './client';

/**
 * One function per operationId in specs/. Nothing here knows about React —
 * the hooks in ./hooks.ts wrap these.
 */

/* -------------------------------------------------- auth-service.yaml */

export const authApi = {
  register: (input: RegisterInput) =>
    apiRequest('/auth/register', {
      method: 'POST',
      body: input,
      schema: AuthResponseSchema,
      auth: false,
    }),

  login: (input: LoginInput) =>
    apiRequest('/auth/login', {
      method: 'POST',
      body: input,
      schema: AuthResponseSchema,
      auth: false,
    }),

  me: (signal?: AbortSignal) => apiRequest('/auth/me', { schema: UserSchema, signal }),
};

/* -------------------------------------------------- city-service.yaml */

export const catalogApi = {
  blockTypes: (signal?: AbortSignal) =>
    apiRequest('/catalog/block-types', {
      schema: z.array(BlockTypeSchema),
      auth: false,
      signal,
    }),

  personas: (signal?: AbortSignal) =>
    apiRequest('/catalog/personas', {
      schema: z.array(PersonaSchema),
      auth: false,
      signal,
    }),
};

export const cityApi = {
  list: (signal?: AbortSignal) =>
    apiRequest('/cities', { schema: z.array(CitySummarySchema), signal }),

  create: (name?: string) =>
    apiRequest('/cities', {
      method: 'POST',
      body: name ? { name } : {},
      schema: CitySchema,
    }),

  get: (cityId: string, signal?: AbortSignal) =>
    apiRequest(`/cities/${cityId}`, { schema: CitySchema, signal }),

  rename: (cityId: string, name: string) =>
    apiRequest(`/cities/${cityId}`, { method: 'PATCH', body: { name }, schema: CitySchema }),

  remove: (cityId: string) => apiRequest(`/cities/${cityId}`, { method: 'DELETE' }),

  /** FE #1's primary save path: debounced bulk autosave of the whole layout. */
  replaceBlocks: (cityId: string, blocks: PlacedBlockInput[]) =>
    apiRequest(`/cities/${cityId}/blocks`, {
      method: 'PUT',
      body: { blocks },
      schema: CitySchema,
    }),

  placeBlock: (cityId: string, block: PlacedBlockInput) =>
    apiRequest(`/cities/${cityId}/blocks`, {
      method: 'POST',
      body: block,
      schema: BlockMutationResultSchema,
    }),

  moveBlock: (cityId: string, blockId: string, x: number, y: number) =>
    apiRequest(`/cities/${cityId}/blocks/${blockId}`, {
      method: 'PATCH',
      body: { x, y },
      schema: BlockMutationResultSchema,
    }),

  removeBlock: (cityId: string, blockId: string) =>
    apiRequest(`/cities/${cityId}/blocks/${blockId}`, {
      method: 'DELETE',
      schema: BlockMutationResultSchema,
    }),

  /** FE #2 stores each run here so it survives reloads and can feed the Advisor. */
  saveSimulation: (cityId: string, result: SimulationResultInput) =>
    apiRequest(`/cities/${cityId}/simulation`, {
      method: 'PUT',
      body: result,
      schema: SimulationResultSchema,
    }),

  getSimulation: (cityId: string, signal?: AbortSignal) =>
    apiRequest(`/cities/${cityId}/simulation`, { schema: SimulationResultSchema, signal }),
};

/* ---------------------------------------------- proposal-service.yaml */

export const proposalApi = {
  list: (status?: ProposalStatus, signal?: AbortSignal) =>
    apiRequest(`/proposals${status ? `?status=${status}` : ''}`, {
      schema: z.array(ProposalSchema),
      signal,
    }),

  get: (proposalId: string, signal?: AbortSignal) =>
    apiRequest(`/proposals/${proposalId}`, { schema: ProposalDetailSchema, signal }),

  /**
   * Idempotent per user — submitting again replaces the previous ballot, so
   * "change my vote" is the same call. Must cover every metric in `votingMetrics`.
   */
  submitVotes: (proposalId: string, votes: MetricVote[]) =>
    apiRequest(`/proposals/${proposalId}/votes`, {
      method: 'PUT',
      body: { votes },
      schema: SubmitVotesResponseSchema,
    }),

  results: (proposalId: string, signal?: AbortSignal) =>
    apiRequest(`/proposals/${proposalId}/results`, { schema: VotingResultsSchema, signal }),
};

/* ----------------------------------------------- advisor-service.yaml */

export const advisorApi = {
  analyse: (payload: {
    city: CitySnapshot;
    simulation: SimulationResultInput;
    focus?: MetricName | null;
  }) =>
    apiRequest('/advisor/analysis', {
      method: 'POST',
      body: payload,
      schema: AdvisorReportSchema,
    }),

  explainProposal: (proposalId: string, votingResults?: VotingResults | null) =>
    apiRequest('/advisor/proposal-explanation', {
      method: 'POST',
      body: { proposalId, votingResults: votingResults ?? null },
      schema: ProposalExplanationSchema,
    }),
};
