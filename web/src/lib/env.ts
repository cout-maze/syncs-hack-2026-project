/**
 * Where the app gets its data from. Set VITE_API_MODE in web/.env.
 *
 *   msw    in-browser stateful mocks, no backend needed (default)
 *   prism  the four Prism processes started from specs/*.yaml
 *   real   the Node backend from BE #1 / BE #2
 */
export type ApiMode = 'msw' | 'prism' | 'real';

const RAW_MODE = import.meta.env.VITE_API_MODE?.trim().toLowerCase();

export const API_MODE: ApiMode =
  RAW_MODE === 'prism' || RAW_MODE === 'real' ? RAW_MODE : 'msw';

const CONFIGURED_API_BASE_URL = (
  import.meta.env.VITE_API_URL?.trim() || 'http://localhost:3000/api/v1'
).replace(/\/$/, '');

// MSW can only guarantee interception for requests made by the controlled app
// origin. Keeping mock traffic same-origin also prevents a mock-mode request from
// accidentally reaching a real backend when the service worker is starting up.
export const API_BASE_URL =
  API_MODE === 'msw' && typeof window !== 'undefined'
    ? `${window.location.origin}/api/v1`
    : CONFIGURED_API_BASE_URL;

/** Prism serves one process per spec — see the mock:* scripts in the root package.json. */
const PRISM_BASE_URLS = {
  auth: 'http://localhost:4013',
  city: 'http://localhost:4010',
  proposals: 'http://localhost:4011',
  advisor: 'http://localhost:4012',
} as const;

type ApiModule = keyof typeof PRISM_BASE_URLS;

function moduleFor(path: string): ApiModule {
  if (path.startsWith('/auth')) return 'auth';
  if (path.startsWith('/proposals')) return 'proposals';
  if (path.startsWith('/advisor')) return 'advisor';
  return 'city'; // /catalog/* and /cities/*
}

/**
 * Turn a spec-relative path (`/cities/abc/blocks`) into a full URL for the active mode.
 * MSW and the real backend share one origin; Prism splits by module.
 */
export function resolveUrl(path: string): string {
  if (API_MODE === 'prism') {
    return `${PRISM_BASE_URLS[moduleFor(path)]}/api/v1${path}`;
  }
  return `${API_BASE_URL}${path}`;
}
