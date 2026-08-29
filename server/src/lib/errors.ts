export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorBody(error: { code: string; message: string; details?: Record<string, unknown> }) {
  return { error };
}
