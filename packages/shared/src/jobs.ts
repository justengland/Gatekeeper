import { z } from 'zod'
import { DatabaseTargetSchema, RequesterSchema, RoleSchema } from './types.js'

// =============================================================================
// Job Contract Schemas (Control Plane ↔ Agent)
// =============================================================================

/**
 * Base job schema with common fields
 */
const BaseJobSchema = z.object({
  id: z.string().min(1, 'Job ID is required'), // Idempotency key
  correlationId: z.string().uuid('Correlation ID must be a valid UUID')
})

/**
 * Create ephemeral database session job
 * Sent from Control Plane to Agent
 */
export const CreateSessionJobSchema = BaseJobSchema.extend({
  type: z.literal('create_session'),
  target: DatabaseTargetSchema,
  role: RoleSchema,
  ttlMinutes: z.number()
    .int()
    .min(1, 'TTL must be at least 1 minute')
    .max(1440, 'TTL cannot exceed 24 hours (1440 minutes)'), // SESSION_MAX_TTL_MINUTES
  requester: RequesterSchema,
  reason: z.string().max(256, 'Reason cannot exceed 256 characters').optional()
})

export type CreateSessionJob = z.infer<typeof CreateSessionJobSchema>

/**
 * Revoke existing session job
 * Sent from Control Plane to Agent
 */
export const RevokeSessionJobSchema = BaseJobSchema.extend({
  type: z.literal('revoke_session'),
  sessionId: z.string().min(1, 'Session ID is required')
})

export type RevokeSessionJob = z.infer<typeof RevokeSessionJobSchema>

/**
 * Cleanup expired sessions job
 * Triggered by scheduler or Control Plane
 */
export const CleanupJobSchema = BaseJobSchema.extend({
  type: z.literal('cleanup'),
  olderThanMinutes: z.number()
    .int()
    .min(0, 'Cleanup threshold must be non-negative')
    .optional()
    .default(5)
})

export type CleanupJob = z.infer<typeof CleanupJobSchema>

/**
 * Union of all job types
 */
export const AgentJobSchema = z.discriminatedUnion('type', [
  CreateSessionJobSchema,
  RevokeSessionJobSchema,
  CleanupJobSchema
])

export type AgentJob = z.infer<typeof AgentJobSchema>

// =============================================================================
// Job Result Schemas (Agent → Control Plane)
// =============================================================================

/**
 * Error information for failed jobs
 */
export const JobErrorSchema = z.object({
  code: z.string().min(1, 'Error code is required'),
  message: z.string().min(1, 'Error message is required'),
  retryable: z.boolean().default(false)
})

export type JobError = z.infer<typeof JobErrorSchema>

/**
 * Result of create session job
 */
export const CreateSessionResultSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  status: z.enum(['ready', 'failed']),
  dsn: z.string().optional(), // Only present when status is 'ready', redacted in logs
  expiresAt: z.string().datetime().optional(), // ISO timestamp
  username: z.string().optional(), // Generated ephemeral username (e.g., gk_abc123def456)
  error: JobErrorSchema.optional()
})

export type CreateSessionResult = z.infer<typeof CreateSessionResultSchema>

/**
 * Result of revoke session job
 */
export const RevokeSessionResultSchema = z.object({
  status: z.enum(['revoked', 'failed', 'not_found']),
  error: JobErrorSchema.optional()
})

export type RevokeSessionResult = z.infer<typeof RevokeSessionResultSchema>

/**
 * Result of cleanup job
 */
export const CleanupResultSchema = z.object({
  status: z.enum(['completed', 'failed']),
  cleanedCount: z.number().int().min(0, 'Cleaned count must be non-negative'),
  error: JobErrorSchema.optional()
})

export type CleanupResult = z.infer<typeof CleanupResultSchema>

/**
 * Union of all job result types
 */
export const AgentJobResultSchema = z.union([
  CreateSessionResultSchema,
  RevokeSessionResultSchema,
  CleanupResultSchema
])

export type AgentJobResult = z.infer<typeof AgentJobResultSchema>
