import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a cancelled fetch. React's dev-mode Strict Mode mounts every
        // component twice, aborting the first effect's fetch - without this, that
        // abort reads as a failure and eats a full exponential-backoff retry cycle
        // (~1s, then ~2s) before the second, real mount's data ever shows up.
        if (error instanceof Error && error.name === 'AbortError') return false;
        // Never retry a contract or auth failure — it will fail identically.
        if (isApiError(error) && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
