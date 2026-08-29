const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

type ErrorBody = { error?: { code?: string; message?: string } };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function getToken() {
  return localStorage.getItem("rmc_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("rmc_token", token);
  else localStorage.removeItem("rmc_token");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      setToken(null);
      window.dispatchEvent(new Event("rmc-unauthorized"));
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? "ERROR",
      body.error?.message ?? response.statusText,
    );
  }
  return body;
}
