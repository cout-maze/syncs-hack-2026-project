import type { z } from 'zod';
import { resolveUrl } from '@/lib/env';
import { getToken } from '@/lib/tokenStore';
import { ApiError } from './errors';

/**
 * The one place a network request is made.
 *
 * Responsibilities: attach the bearer token, unwrap the shared error envelope, and
 * validate every response against its Zod schema so contract drift shows up here
 * rather than three components deep.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions<TSchema extends z.ZodType | undefined> {
  method?: Method;
  body?: unknown;
  schema?: TSchema;
  signal?: AbortSignal;
  /** Set false for register/login and the public catalog endpoints. */
  auth?: boolean;
}

/** Called when any request comes back 401 — AuthProvider hooks into this to log out. */
let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema> & { schema: TSchema },
): Promise<z.infer<TSchema>>;
export async function apiRequest(
  path: string,
  options?: RequestOptions<undefined>,
): Promise<void>;
export async function apiRequest(
  path: string,
  options: RequestOptions<z.ZodType | undefined> = {},
): Promise<unknown> {
  const { method = 'GET', body, schema, signal, auth = true } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(resolveUrl(path), {
    method,
    headers,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) {
    unauthorizedHandler?.();
  }

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }

  if (!schema) return undefined;

  // 204 No Content, or an empty body from a proxy.
  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const json: unknown = await response.json();
  const parsed = schema.safeParse(json);

  if (!parsed.success) {
    // Loud on purpose: this means the backend and specs/ have diverged.
    console.error(
      `[api] Response for ${method} ${path} did not match its schema.`,
      parsed.error.issues,
      json,
    );
    throw new ApiError(
      response.status,
      'SCHEMA_MISMATCH',
      'The server sent data this app did not expect. Check the console for details.',
    );
  }

  return parsed.data;
}
