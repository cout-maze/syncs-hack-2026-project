/**
 * Every non-2xx response across the whole app uses this shape (see
 * docs/04-be1-auth-city.md "Error convention"):
 *   { "error": { "code": "UPPER_SNAKE", "message": "human readable", "details?": {} } }
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(
    message = 'Missing, expired, or invalid bearer token.',
    code = 'UNAUTHORIZED',
  ) {
    return new AppError(401, code, message);
  }

  static forbidden(message: string, code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  /** Spec convention: unowned/missing resources both 404 — never leak existence via 403. */
  static notFound(message: string, code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT', details?: Record<string, unknown>) {
    return new AppError(409, code, message, details);
  }

  static serviceUnavailable(message: string, code = 'SERVICE_UNAVAILABLE') {
    return new AppError(503, code, message);
  }
}
