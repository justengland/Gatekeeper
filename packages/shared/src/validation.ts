import { z } from 'zod'
import { ValidationError } from './errors.js'
import {
  DatabaseTargetSchema,
  RequesterSchema,
  RoleSchema,
  SessionStatusSchema
} from './types.js'
import {
  CreateSessionJobSchema,
  RevokeSessionJobSchema,
  CleanupJobSchema,
  AgentJobSchema,
  CreateSessionResultSchema,
  RevokeSessionResultSchema,
  CleanupResultSchema
} from './jobs.js'
import {
  CreateSessionRequestSchema,
  SessionSchema,
  SessionListQuerySchema,
  HealthResponseSchema,
  ApiKeySchema,
  BearerTokenSchema,
  IdempotencyKeySchema
} from './api.js'

// =============================================================================
// Validation Helper Functions
// =============================================================================

/**
 * Generic validation function with error handling
 */
function validate<T> (schema: z.ZodSchema<T>, data: unknown, context?: string): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0]
      const field = firstIssue?.path?.join('.')
      const message = context
        ? `${context}: ${firstIssue?.message || 'Validation failed'}`
        : firstIssue?.message || 'Validation failed'

      throw new ValidationError(message, field)
    }
    throw error
  }
}

/**
 * Safe validation that returns result object instead of throwing
 */
function validateSafe<T> (schema: z.ZodSchema<T>, data: unknown): {
  success: boolean
  data?: T
  error?: ValidationError
} {
  try {
    const result = schema.parse(data)
    return { success: true, data: result }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0]
      const field = firstIssue?.path?.join('.')
      const validationError = new ValidationError(
        firstIssue?.message || 'Validation failed',
        field
      )
      return { success: false, error: validationError }
    }
    return {
      success: false,
      error: new ValidationError('Unexpected validation error')
    }
  }
}

// =============================================================================
// Core Type Validators
// =============================================================================

export const validateDatabaseTarget = (data: unknown) =>
  validate(DatabaseTargetSchema, data, 'Invalid database target')

export const validateRequester = (data: unknown) =>
  validate(RequesterSchema, data, 'Invalid requester')

export const validateRole = (data: unknown) =>
  validate(RoleSchema, data, 'Invalid role')

export const validateSessionStatus = (data: unknown) =>
  validate(SessionStatusSchema, data, 'Invalid session status')

// =============================================================================
// Job Contract Validators
// =============================================================================

export const validateCreateSessionJob = (data: unknown) =>
  validate(CreateSessionJobSchema, data, 'Invalid create session job')

export const validateRevokeSessionJob = (data: unknown) =>
  validate(RevokeSessionJobSchema, data, 'Invalid revoke session job')

export const validateCleanupJob = (data: unknown) =>
  validate(CleanupJobSchema, data, 'Invalid cleanup job')

export const validateAgentJob = (data: unknown) =>
  validate(AgentJobSchema, data, 'Invalid agent job')

// =============================================================================
// Job Result Validators
// =============================================================================

export const validateCreateSessionResult = (data: unknown) =>
  validate(CreateSessionResultSchema, data, 'Invalid create session result')

export const validateRevokeSessionResult = (data: unknown) =>
  validate(RevokeSessionResultSchema, data, 'Invalid revoke session result')

export const validateCleanupResult = (data: unknown) =>
  validate(CleanupResultSchema, data, 'Invalid cleanup result')

// =============================================================================
// API Validators
// =============================================================================

export const validateCreateSessionRequest = (data: unknown) =>
  validate(CreateSessionRequestSchema, data, 'Invalid create session request')

export const validateSession = (data: unknown) =>
  validate(SessionSchema, data, 'Invalid session')

export const validateSessionListQuery = (data: unknown) =>
  validate(SessionListQuerySchema, data, 'Invalid session list query')

export const validateHealthResponse = (data: unknown) =>
  validate(HealthResponseSchema, data, 'Invalid health response')

export const validateApiKey = (data: unknown) =>
  validate(ApiKeySchema, data, 'Invalid API key format')

export const validateBearerToken = (data: unknown) =>
  validate(BearerTokenSchema, data, 'Invalid bearer token format')

export const validateIdempotencyKey = (data: unknown) =>
  validate(IdempotencyKeySchema, data, 'Invalid idempotency key')

// =============================================================================
// Safe Validators (don't throw, return result objects)
// =============================================================================

export const validateCreateSessionRequestSafe = (data: unknown) =>
  validateSafe(CreateSessionRequestSchema, data)

export const validateCreateSessionJobSafe = (data: unknown) =>
  validateSafe(CreateSessionJobSchema, data)

export const validateSessionListQuerySafe = (data: unknown) =>
  validateSafe(SessionListQuerySchema, data)

export const validateAgentJobSafe = (data: unknown) =>
  validateSafe(AgentJobSchema, data)

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate TTL is within acceptable range
 */
export function validateTTL (ttlMinutes: number, maxTTL: number = 1440): number {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) {
    throw new ValidationError('TTL must be at least 1 minute', 'ttlMinutes')
  }

  if (ttlMinutes > maxTTL) {
    throw new ValidationError(
      `TTL cannot exceed ${maxTTL} minutes (${Math.floor(maxTTL / 60)} hours)`,
      'ttlMinutes'
    )
  }

  return ttlMinutes
}

/**
 * Validate correlation ID format (UUID v4)
 */
export function validateCorrelationId (correlationId: string): string {
  const uuidSchema = z.string().uuid('Correlation ID must be a valid UUID')
  return validate(uuidSchema, correlationId, 'Invalid correlation ID')
}

/**
 * Validate session ID format (using expected format: ses_...)
 */
export function validateSessionId (sessionId: string): string {
  const sessionIdSchema = z.string()
    .regex(/^ses_[a-zA-Z0-9]+$/, 'Session ID must start with "ses_" followed by alphanumeric characters')
    .min(8, 'Session ID too short')
    .max(64, 'Session ID too long')

  return validate(sessionIdSchema, sessionId, 'Invalid session ID')
}

/**
 * Validate job ID format (can be any non-empty string, used as idempotency key)
 */
export function validateJobId (jobId: string): string {
  const jobIdSchema = z.string()
    .min(1, 'Job ID cannot be empty')
    .max(128, 'Job ID cannot exceed 128 characters')

  return validate(jobIdSchema, jobId, 'Invalid job ID')
}

/**
 * Validate target ID format (alphanumeric with hyphens and underscores)
 */
export function validateTargetId (targetId: string): string {
  const targetIdSchema = z.string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Target ID can only contain letters, numbers, hyphens, and underscores')
    .min(1, 'Target ID cannot be empty')
    .max(64, 'Target ID cannot exceed 64 characters')

  return validate(targetIdSchema, targetId, 'Invalid target ID')
}

/**
 * Validate username format (for ephemeral users: gk_...)
 */
export function validateEphemeralUsername (username: string): string {
  const usernameSchema = z.string()
    .regex(/^gk_[a-zA-Z0-9]+$/, 'Ephemeral username must start with "gk_" followed by alphanumeric characters')
    .min(4, 'Username too short')
    .max(63, 'Username too long') // PostgreSQL username limit

  return validate(usernameSchema, username, 'Invalid ephemeral username')
}

/**
 * Validate reason text (optional field with length limits)
 */
export function validateReason (reason: string | undefined): string | undefined {
  if (!reason || reason.trim() === '') return undefined

  const reasonSchema = z.string()
    .max(256, 'Reason cannot exceed 256 characters')
    .min(1, 'Reason cannot be empty if provided')

  return validate(reasonSchema, reason, 'Invalid reason')
}

// =============================================================================
// Batch Validation
// =============================================================================

/**
 * Validate multiple values and collect all errors
 */
export function validateBatch (validations: Array<{ name: string, validate: () => any }>): {
  success: boolean
  errors: ValidationError[]
  results?: Record<string, any>
} {
  const errors: ValidationError[] = []
  const results: Record<string, any> = {}

  for (const { name, validate: validateFn } of validations) {
    try {
      results[name] = validateFn()
    } catch (error) {
      if (error instanceof ValidationError) {
        errors.push(error)
      } else {
        errors.push(new ValidationError(`Validation failed for ${name}`))
      }
    }
  }

  return {
    success: errors.length === 0,
    errors,
    ...(errors.length === 0 && { results })
  }
}
