export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'RULE_VIOLATION',
  'NEEDS_CONFIRMATION',
  'INTERNAL'
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export interface AppErrorShape {
  code: ErrorCode
  message: string
  /** Field-level validation issues or rule warnings requiring acknowledgement. */
  details?: string[]
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: string[]
  constructor(code: ErrorCode, message: string, details?: string[]) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
  toJSON(): AppErrorShape {
    return { code: this.code, message: this.message, details: this.details }
  }
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape }
