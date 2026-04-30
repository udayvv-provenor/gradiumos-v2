export type ErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_EMAIL_TAKEN'
  | 'AUTH_PASSWORD_WEAK'
  | 'VALIDATION'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'SIGNAL_BELOW_THRESHOLD'
  | 'SIGNAL_CHECKLIST_INCOMPLETE'
  // v3 — upload + signup
  | 'UPLOAD_REQUIRED'
  | 'UPLOAD_BAD_TYPE'
  | 'UPLOAD_PDF_EMPTY'
  | 'SIGNUP_INVALID_INVITE'
  // BC 43-44 — frontend-distinguishable invite code error
  | 'INVALID_INVITE_CODE'
  // BC 45 — duplicate email (Prisma P2002 catch path)
  | 'EMAIL_ALREADY_EXISTS'
  // BC 51 — Groq extraction zod failure
  | 'AI_EXTRACTION_FAILED'
  // BC 48 — PDF extraction returned empty text
  | 'PDF_EXTRACTION_EMPTY'
  // BC 58 — Groq mapCurriculum output failed zod validation
  | 'AI_MAPPING_FAILED'
  // BC 72 — feature flag disabled
  | 'FEATURE_DISABLED';

const STATUS: Record<ErrorCode, number> = {
  AUTH_INVALID: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_EMAIL_TAKEN: 409,
  AUTH_PASSWORD_WEAK: 400,
  VALIDATION: 400,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SIGNAL_BELOW_THRESHOLD: 403,
  SIGNAL_CHECKLIST_INCOMPLETE: 409,
  UPLOAD_REQUIRED: 400,
  UPLOAD_BAD_TYPE: 415,
  UPLOAD_PDF_EMPTY: 422,
  SIGNUP_INVALID_INVITE: 404,
  INVALID_INVITE_CODE: 400,
  EMAIL_ALREADY_EXISTS: 409,
  AI_EXTRACTION_FAILED: 502,
  PDF_EXTRACTION_EMPTY: 400,
  AI_MAPPING_FAILED: 502,
  FEATURE_DISABLED: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
    this.name = 'AppError';
  }
}
