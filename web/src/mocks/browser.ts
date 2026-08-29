import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { resetMockDb } from './db';

export const worker = setupWorker(...handlers);

/**
 * Start the in-browser mock backend. Called from main.tsx only when
 * VITE_API_MODE is `msw`, and awaited so no request escapes before it is ready.
 */
export async function startMockBackend(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass', // fonts, vite HMR, source maps
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
  });

  // Escape hatch for the demo: wipe seeded state from the console.
  (window as unknown as { __rmcResetMocks: () => void }).__rmcResetMocks = () => {
    resetMockDb();
    window.location.reload();
  };

  console.info(
    '%c[The Missing Block]%c mock backend running. Sign in as demo@city.dev / demo1234. Run __rmcResetMocks() to reseed.',
    'color:#9c5f0f;font-weight:bold',
    'color:inherit',
  );
}
