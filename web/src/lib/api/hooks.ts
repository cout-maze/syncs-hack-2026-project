import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type {
  City,
  MetricName,
  MetricVote,
  PlacedBlockInput,
  ProposalInput,
  ProposalStatus,
  SimulationResultInput,
  VotingResults,
} from '@rmc/shared';
import { advisorApi, catalogApi, cityApi, proposalApi } from './endpoints';
import { queryKeys } from './queryKeys';

/**
 * React Query wrappers. Every FE workstream should reach the backend through these
 * rather than calling `endpoints.ts` directly — that's what gives us shared caching,
 * one polling implementation, and consistent loading states.
 */

/* ---------------------------------------------------------- catalog (static) */

/** The catalog never changes at runtime, so it's fetched once and shared by all tabs. */
export function useBlockTypes() {
  return useQuery({
    queryKey: queryKeys.blockTypes,
    queryFn: ({ signal }) => catalogApi.blockTypes(signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function usePersonas() {
  return useQuery({
    queryKey: queryKeys.personas,
    queryFn: ({ signal }) => catalogApi.personas(signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/* ------------------------------------------------------------------- cities */

export function useCities() {
  return useQuery({
    queryKey: queryKeys.cities,
    queryFn: ({ signal }) => cityApi.list(signal),
  });
}

export function useCity(cityId: string | null, options?: Partial<UseQueryOptions<City>>) {
  return useQuery({
    queryKey: queryKeys.city(cityId ?? 'none'),
    queryFn: ({ signal }) => cityApi.get(cityId as string, signal),
    enabled: Boolean(cityId),
    ...options,
  });
}

/**
 * The council's city - fixed, the same for every user. Proposal mode shows this
 * instead of `useCity`; it never changes at runtime, so it's cached like catalog data.
 */
export function useCouncilCity() {
  return useQuery({
    queryKey: queryKeys.councilCity,
    queryFn: ({ signal }) => cityApi.getCouncil(signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useCreateCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name?: string) => cityApi.create(name),
    onSuccess: (city) => {
      qc.setQueryData(queryKeys.city(city.id), city);
      void qc.invalidateQueries({ queryKey: queryKeys.cities });
    },
  });
}

export function useRenameCity(cityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => cityApi.rename(cityId, name),
    onSuccess: (city) => {
      qc.setQueryData(queryKeys.city(city.id), city);
      void qc.invalidateQueries({ queryKey: queryKeys.cities });
    },
  });
}

export function useDeleteCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cityId: string) => cityApi.remove(cityId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.cities }),
  });
}

/**
 * Bulk layout save (FE #1's autosave path).
 *
 * Deliberately *not* optimistic: the builder already holds the authoritative local
 * layout while you drag. On success we adopt the server's city (it recomputes
 * `blocksUsed`); on 409 the builder rolls back to its last-good snapshot.
 */
export function useReplaceBlocks(cityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blocks: PlacedBlockInput[]) => cityApi.replaceBlocks(cityId, blocks),
    onSuccess: (city) => {
      qc.setQueryData(queryKeys.city(city.id), city);
      void qc.invalidateQueries({ queryKey: queryKeys.cities });
    },
  });
}

/* --------------------------------------------------------------- simulation */

export function useSaveSimulation(cityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (result: SimulationResultInput) => cityApi.saveSimulation(cityId, result),
    onSuccess: (stored) => {
      qc.setQueryData(queryKeys.simulation(cityId), stored);
      qc.setQueryData<City>(queryKeys.city(cityId), (prev) =>
        prev ? { ...prev, lastSimulation: stored } : prev,
      );
    },
  });
}

export function useStoredSimulation(cityId: string | null) {
  return useQuery({
    queryKey: queryKeys.simulation(cityId ?? 'none'),
    queryFn: ({ signal }) => cityApi.getSimulation(cityId as string, signal),
    enabled: Boolean(cityId),
    retry: false, // 404 just means "no run saved yet"
  });
}

/* ---------------------------------------------------------------- proposals */

export function useProposals(status?: ProposalStatus) {
  return useQuery({
    queryKey: queryKeys.proposals(status),
    queryFn: ({ signal }) => proposalApi.list(status, signal),
  });
}

export function useProposal(proposalId: string | null) {
  return useQuery({
    queryKey: queryKeys.proposal(proposalId ?? 'none'),
    queryFn: ({ signal }) => proposalApi.get(proposalId as string, signal),
    enabled: Boolean(proposalId),
  });
}

/**
 * Poll while a proposal detail view is open. No websockets in the MVP —
 * proposal-service.yaml explicitly says poll every 5-10s.
 */
export function useProposalResults(proposalId: string | null, { poll = true } = {}) {
  return useQuery({
    queryKey: queryKeys.proposalResults(proposalId ?? 'none'),
    queryFn: ({ signal }) => proposalApi.results(proposalId as string, signal),
    enabled: Boolean(proposalId),
    refetchInterval: poll ? 7_000 : false,
    staleTime: 0,
  });
}

/** Authoring a proposal from Proposal mode. */
export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProposalInput) => proposalApi.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
}

export function useSubmitVotes(proposalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (votes: MetricVote[]) => proposalApi.submitVotes(proposalId, votes),
    onSuccess: ({ results }) => {
      // The PUT response carries fresh results — show them without waiting for a poll.
      qc.setQueryData(queryKeys.proposalResults(proposalId), results);
      void qc.invalidateQueries({ queryKey: queryKeys.proposal(proposalId) });
      void qc.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
}

/* ------------------------------------------------------------------ advisor */

export function useAdvisorAnalysis() {
  return useMutation({
    mutationFn: (payload: Parameters<typeof advisorApi.analyse>[0]) => advisorApi.analyse(payload),
  });
}

export function useProposalExplanation() {
  return useMutation({
    mutationFn: (args: { proposalId: string; votingResults?: VotingResults | null }) =>
      advisorApi.explainProposal(args.proposalId, args.votingResults),
  });
}

export type { MetricName };
