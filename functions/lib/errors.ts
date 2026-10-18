/** Typed application error carrying an HTTP status + machine-readable code. */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static badRequest(message = 'Bad request', details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, details);
  }
  static validation(message = 'Validation failed', details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'Forbidden'): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message = 'Not found'): AppError {
    return new AppError('NOT_FOUND', message);
  }
  static conflict(message = 'Conflict'): AppError {
    return new AppError('CONFLICT', message);
  }
  static rateLimited(message = 'Too many requests', details?: unknown): AppError {
    return new AppError('RATE_LIMITED', message, details);
  }
  static payloadTooLarge(message = 'Payload too large'): AppError {
    return new AppError('PAYLOAD_TOO_LARGE', message);
  }
  static unsupportedMedia(message = 'Unsupported media type'): AppError {
    return new AppError('UNSUPPORTED_MEDIA_TYPE', message);
  }
  static upstream(message = 'Upstream service failed', details?: unknown): AppError {
    return new AppError('UPSTREAM_ERROR', message, details);
  }
  static internal(message = 'Internal server error'): AppError {
    return new AppError('INTERNAL', message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
