import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { City, CitySummary } from '@rmc/shared';
import { useCities, useCity, useCreateCity } from '@/lib/api/hooks';

/**
 * Which city the whole app is looking at.
 *
 * All four tabs read from the same city - that shared state is the integration
 * contract described in docs/00-architecture-overview.md. Nothing outside this
 * provider should fetch a city by id on its own.
 */

const STORAGE_KEY = 'rmc.activeCityId';

interface ActiveCityState {
  cityId: string | null;
  city: City | undefined;
  cities: CitySummary[];
  isLoading: boolean;
  error: unknown;
  select: (cityId: string) => void;
  createCity: (name?: string) => Promise<City>;
  isCreating: boolean;
}

const ActiveCityContext = createContext<ActiveCityState | null>(null);

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ActiveCityProvider({ children }: { children: ReactNode }) {
  const [cityId, setCityId] = useState<string | null>(readStoredId);

  const citiesQuery = useCities();
  const createMutation = useCreateCity();
  const cityQuery = useCity(cityId);

  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);

  const select = useCallback((next: string) => {
    setCityId(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Pick a city as soon as we know what exists: keep the stored one if it is still
  // ours, otherwise fall back to the most recent, otherwise create the first city.
  useEffect(() => {
    if (!citiesQuery.isSuccess) return;

    const stored = cityId;
    if (stored && cities.some((city) => city.id === stored)) return;

    const first = cities[0];
    if (first) {
      select(first.id);
      return;
    }

    if (!createMutation.isPending && !createMutation.isSuccess && !createMutation.isError) {
      createMutation.mutate(undefined, { onSuccess: (created) => select(created.id) });
    }
  }, [
    citiesQuery.isSuccess,
    cities,
    cityId,
    createMutation.isPending,
    createMutation.isSuccess,
    createMutation.isError,
    createMutation.mutate,
    select,
  ]);

  const createCity = useCallback(
    async (name?: string) => {
      const created = await createMutation.mutateAsync(name);
      select(created.id);
      return created;
    },
    [createMutation, select],
  );

  const value = useMemo<ActiveCityState>(
    () => ({
      cityId,
      city: cityQuery.data,
      cities,
      isLoading: citiesQuery.isLoading || cityQuery.isLoading || createMutation.isPending,
      error: citiesQuery.error ?? cityQuery.error ?? createMutation.error,
      select,
      createCity,
      isCreating: createMutation.isPending,
    }),
    [cityId, cityQuery.data, cityQuery.isLoading, cityQuery.error, cities, citiesQuery.isLoading, citiesQuery.error, createMutation.isPending, createMutation.error, select, createCity],
  );

  return <ActiveCityContext.Provider value={value}>{children}</ActiveCityContext.Provider>;
}

export function useActiveCity(): ActiveCityState {
  const context = useContext(ActiveCityContext);
  if (!context) throw new Error('useActiveCity must be used inside <ActiveCityProvider>.');
  return context;
}
