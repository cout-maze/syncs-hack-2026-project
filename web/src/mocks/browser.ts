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

  // `worker.start()` waits for registration, but a first-load document can still
  // be uncontrolled until the worker claims it. Never render the app in that
  // window: otherwise mock requests can leak to a real backend, especially the
  // mutating autosave calls. A single reload gives the active worker control and
  // makes every subsequent request deterministic.
  if (!navigator.serviceWorker.controller) {
    const reloadKey = '__rmc_msw_control_reload__';
    let alreadyRetried = false;
    try {
      alreadyRetried = sessionStorage.getItem(reloadKey) === '1';
      if (!alreadyRetried) sessionStorage.setItem(reloadKey, '1');
    } catch {
      // If session storage is unavailable, the one-shot reload below is still safe
      // because this page will be replaced and bootstrap will run once more.
    }

    if (!alreadyRetried) {
      window.location.reload();
      await new Promise<void>(() => undefined);
    }

    throw new Error('The mock service worker could not take control of this page.');
  }

  try {
    sessionStorage.removeItem('__rmc_msw_control_reload__');
  } catch {
    // Storage is optional; mocking is already active.
  }

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
