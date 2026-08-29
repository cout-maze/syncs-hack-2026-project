/**
 * JWT storage. Kept in memory for the request path and mirrored to localStorage so a
 * page reload doesn't log you out mid-demo. Token lifetime is 24h (auth spec).
 */
const STORAGE_KEY = 'rmc.token';

let inMemoryToken: string | null = readFromStorage();

function readFromStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode / storage disabled
  }
}

export function getToken(): string | null {
  return inMemoryToken;
}

export function setToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — in-memory still works for this session */
  }
}
