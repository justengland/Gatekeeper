import { z } from 'zod'

// =============================================================================
// Core Types and Schemas
// =============================================================================

/**
 * Database connection target configuration
 */
export const DatabaseTargetSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535, 'Port must be between 1 and 65535'),
  database: z.string().min(1, 'Database name is required'),
  sslMode: z.enum(['disable', 'require', 'prefer']).optional().default('prefer')
})

export type DatabaseTarget = z.infer<typeof DatabaseTargetSchema>

/**
 * User information for session requests
 */
export const RequesterSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  email: z.string().email().optional()
})

export type Requester = z.infer<typeof RequesterSchema>

/**
 * Available roles for ephemeral sessions
 * Milestone 0 supports app_read only
 */
export const RoleSchema = z.enum(['app_read', 'app_write', 'app_admin'])
export type Role = z.infer<typeof RoleSchema>

/**
 * Session status values
 */
export const SessionStatusSchema = z.enum(['pending', 'ready', 'revoked', 'expired', 'failed'])
export type SessionStatus = z.infer<typeof SessionStatusSchema>
