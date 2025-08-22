import { z } from 'zod'
import { RoleSchema, SessionStatusSchema, RequesterSchema } from './types.js'

// =============================================================================
// API Request/Response Schemas (Control Plane Public API)
// =============================================================================

/**
 * Health check response
 */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  uptimeSeconds: z.number().optional(),
  checks: z.record(z.string()).optional() // e.g., { "db": "ok", "queue": "ok" }
})

export type HealthResponse = z.infer<typeof HealthResponseSchema>

/**
 * Create session request (from client to Control Plane)
 * Uses targetId instead of full database connection details for security
 */
export const CreateSessionRequestSchema = z.object({
  targetId: z.string().min(1, 'Target ID is required'),
  role: RoleSchema,
  ttlMinutes: z.number()
    .int()
    .min(1, 'TTL must be at least 1 minute')
    .max(1440, 'TTL cannot exceed 24 hours (1440 minutes)'),
  reason: z.string().max(256, 'Reason cannot exceed 256 characters').optional(),
  requester: RequesterSchema.optional() // Usually inferred from auth
})

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

/**
 * Session information (returned by Control Plane API)
 */
export const SessionSchema = z.object({
  id: z.string(), // e.g., "ses_01HVJ3C5Z6W6WZ"
  status: SessionStatusSchema,
  role: RoleSchema,
  targetId: z.string(),
  requester: RequesterSchema.optional(),
  ttlMinutes: z.number().int(),
  createdAt: z.string().datetime(), // ISO timestamp
  expiresAt: z.string().datetime().nullable(), // ISO timestamp, null if not ready
  dsn: z.string().nullable(), // Only returned when status is 'ready', redacted in logs
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional()
})

export type Session = z.infer<typeof SessionSchema>

/**
 * Paginated session list response
 */
export const SessionListSchema = z.object({
  items: z.array(SessionSchema),
  pageInfo: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(200),
    totalItems: z.number().int().min(0),
    totalPages: z.number().int().min(0)
  })
})

export type SessionList = z.infer<typeof SessionListSchema>

/**
 * Session list query parameters
 */
export const SessionListQuerySchema = z.object({
  status: SessionStatusSchema.optional(),
  role: RoleSchema.optional(),
  targetId: z.string().optional(),
  requesterId: z.string().optional(),
  createdFrom: z.string().datetime().optional(), // ISO timestamp filter (start)
  createdTo: z.string().datetime().optional(), // ISO timestamp filter (end)
  page: z.number().int().min(1).default(1).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  sort: z.string().optional() // e.g., "createdAt:desc"
})

export type SessionListQuery = z.infer<typeof SessionListQuerySchema>

/**
 * API error response
 */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().uuid().optional()
})

export type ApiError = z.infer<typeof ApiErrorSchema>

// =============================================================================
// Common HTTP Headers
// =============================================================================

/**
 * Idempotency key header validation
 */
export const IdempotencyKeySchema = z.string()
  .min(1, 'Idempotency key cannot be empty')
  .max(128, 'Idempotency key cannot exceed 128 characters')
  .optional()

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>

/**
 * API Key validation
 */
export const ApiKeySchema = z.string()
  .min(1, 'API key cannot be empty')
  .regex(/^gk_[a-zA-Z0-9_]+$/, 'API key must start with gk_ and contain only alphanumeric characters and underscores')

export type ApiKey = z.infer<typeof ApiKeySchema>

/**
 * JWT Bearer token validation
 */
export const BearerTokenSchema = z.string()
  .min(1, 'Bearer token cannot be empty')
  .regex(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/, 'Invalid JWT token format')

export type BearerToken = z.infer<typeof BearerTokenSchema>
