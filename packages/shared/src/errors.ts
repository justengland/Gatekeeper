import { z } from 'zod'

// =============================================================================
// Error Classes and Schemas
// =============================================================================

/**
 * Base Gatekeeper error class
 */
export class GatekeeperError extends Error {
  constructor (
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly correlationId?: string
  ) {
    super(message)
    this.name = 'GatekeeperError'
  }

  toJSON () {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      correlationId: this.correlationId,
      stack: this.stack
    }
  }
}

/**
 * Validation error for invalid input data
 */
export class ValidationError extends GatekeeperError {
  constructor (
    message: string,
    public readonly field?: string,
    correlationId?: string
  ) {
    super(message, 'VALIDATION_ERROR', false, correlationId)
    this.name = 'ValidationError'
  }
}

/**
 * Authentication error for missing/invalid credentials
 */
export class AuthenticationError extends GatekeeperError {
  constructor (
    message: string = 'Authentication required',
    correlationId?: string
  ) {
    super(message, 'AUTHENTICATION_ERROR', false, correlationId)
    this.name = 'AuthenticationError'
  }
}

/**
 * Authorization error for insufficient permissions
 */
export class AuthorizationError extends GatekeeperError {
  constructor (
    message: string = 'Insufficient permissions',
    correlationId?: string
  ) {
    super(message, 'AUTHORIZATION_ERROR', false, correlationId)
    this.name = 'AuthorizationError'
  }
}

/**
 * Database connection or operation error
 */
export class DatabaseError extends GatekeeperError {
  constructor (
    message: string,
    retryable: boolean = true,
    correlationId?: string
  ) {
    super(message, 'DATABASE_ERROR', retryable, correlationId)
    this.name = 'DatabaseError'
  }
}

/**
 * Agent service unavailable or failed
 */
export class AgentError extends GatekeeperError {
  constructor (
    message: string,
    retryable: boolean = true,
    correlationId?: string
  ) {
    super(message, 'AGENT_ERROR', retryable, correlationId)
    this.name = 'AgentError'
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends GatekeeperError {
  constructor (
    resource: string,
    id: string,
    correlationId?: string
  ) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', false, correlationId)
    this.name = 'NotFoundError'
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends GatekeeperError {
  constructor (
    message: string = 'Rate limit exceeded',
    public readonly retryAfter?: number, // seconds
    correlationId?: string
  ) {
    super(message, 'RATE_LIMIT_EXCEEDED', true, correlationId)
    this.name = 'RateLimitError'
  }
}

// =============================================================================
// Error Code Constants
// =============================================================================

export const ERROR_CODES = {
  // General errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Database errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  USER_CREATION_FAILED: 'USER_CREATION_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_ROLE: 'INVALID_ROLE',

  // Agent errors
  AGENT_ERROR: 'AGENT_ERROR',
  AGENT_UNAVAILABLE: 'AGENT_UNAVAILABLE',
  JOB_PROCESSING_FAILED: 'JOB_PROCESSING_FAILED',

  // Session errors
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  INVALID_TTL: 'INVALID_TTL',
  TTL_EXCEEDED: 'TTL_EXCEEDED',

  // Configuration errors
  INVALID_TARGET: 'INVALID_TARGET',
  ROLEPACK_NOT_FOUND: 'ROLEPACK_NOT_FOUND',

  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR'
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

// =============================================================================
// Error Schema for API responses
// =============================================================================

/**
 * Standardized error response schema
 */
export const ErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().uuid().optional(),
  field: z.string().optional(), // For validation errors
  retryable: z.boolean().optional(),
  retryAfter: z.number().int().positive().optional() // For rate limit errors
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

// =============================================================================
// Error Utilities
// =============================================================================

/**
 * Convert any error to a standardized ErrorResponse
 */
export function toErrorResponse (error: unknown, correlationId?: string): ErrorResponse {
  if (error instanceof GatekeeperError) {
    return {
      code: error.code,
      message: error.message,
      correlationId: error.correlationId || correlationId,
      ...(error instanceof ValidationError && error.field && { field: error.field }),
      ...(error.retryable && { retryable: true }),
      ...(error instanceof RateLimitError && error.retryAfter && { retryAfter: error.retryAfter })
    }
  }

  if (error instanceof z.ZodError) {
    const firstIssue = error.issues[0]
    return {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: firstIssue?.message || 'Validation failed',
      correlationId,
      field: firstIssue?.path?.join('.') || undefined
    }
  }

  if (error instanceof Error) {
    return {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
      correlationId
    }
  }

  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    correlationId
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError (error: unknown): boolean {
  if (error instanceof GatekeeperError) {
    return error.retryable
  }
  return false
}

/**
 * Extract correlation ID from error
 */
export function getCorrelationId (error: unknown): string | undefined {
  if (error instanceof GatekeeperError) {
    return error.correlationId
  }
  return undefined
}
