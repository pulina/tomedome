export class ApiError extends Error {
  readonly status: number;
  readonly body?: string;

  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Parses JSON error bodies `{ type, message }` or legacy `{ error }`. */
export function messageFromErrorResponseBody(text: string): string {
  try {
    const j = JSON.parse(text) as { message?: string; error?: string };
    if (typeof j.message === 'string') return j.message;
    if (typeof j.error === 'string') return j.error;
  } catch {
    /* not JSON */
  }
  return text;
}
