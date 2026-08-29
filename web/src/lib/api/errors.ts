import { ApiErrorEnvelopeSchema } from '@rmc/shared';

/**
 * Every non-2xx response in this app carries `{ error: { code, message, details? } }`.
 * Branch on `.code`; show `.message` to the user — the backend writes it for humans.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    const parsed = ApiErrorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiError(response.status, code, message, details);
    }

    // Prism and proxies can return a non-conforming body; keep something readable.
    return new ApiError(
      response.status,
      `HTTP_${response.status}`,
      response.statusText || 'The request failed.',
    );
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function hasCode(error: unknown, ...codes: string[]): boolean {
  return isApiError(error) && codes.includes(error.code);
}

/** Safe message for a toast, whatever went wrong. */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
