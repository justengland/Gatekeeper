#!/usr/bin/env node
/**
 * User Management Types for Gatekeeper
 * Defines types for managing permanent database users with roles
 */

import { z } from 'zod'

// =============================================================================
// User Management Types
// =============================================================================

/**
 * Available user types
 */
export const UserTypeSchema = z.enum(['admin', 'developer', 'analyst', 'service'])
export type UserType = z.infer<typeof UserTypeSchema>

/**
 * User status values
 */
export const UserStatusSchema = z.enum(['active', 'inactive', 'suspended', 'deleted'])
export type UserStatus = z.infer<typeof UserStatusSchema>

/**
 * Database user configuration
 */
export const DatabaseUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(50).regex(/^[a-z][a-z0-9_]*$/, 'Username must start with letter and contain only lowercase letters, numbers, and underscores'),
  email: z.string().email(),
  fullName: z.string().min(1).max(100),
  userType: UserTypeSchema,
  roles: z.array(z.string()).min(1, 'At least one role is required'),
  status: UserStatusSchema.default('active'),
  connectionLimit: z.number().int().min(1).max(10).default(3),
  validUntil: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().min(1),
  lastLoginAt: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional()
})

export type DatabaseUser = z.infer<typeof DatabaseUserSchema>

/**
 * User creation request
 */
export const CreateUserRequestSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-z][a-z0-9_]*$/, 'Username must start with letter and contain only lowercase letters, numbers, and underscores'),
  email: z.string().email(),
  fullName: z.string().min(1).max(100),
  userType: UserTypeSchema,
  roles: z.array(z.string()).min(1, 'At least one role is required'),
  password: z.string().min(12).max(128).optional(), // Optional - will be generated if not provided
  connectionLimit: z.number().int().min(1).max(10).default(3),
  validUntil: z.string().datetime().optional(),
  reason: z.string().max(256).optional()
})

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>

/**
 * User update request
 */
export const UpdateUserRequestSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(100).optional(),
  userType: UserTypeSchema.optional(),
  roles: z.array(z.string()).min(1).optional(),
  status: UserStatusSchema.optional(),
  connectionLimit: z.number().int().min(1).max(10).optional(),
  validUntil: z.string().datetime().optional(),
  reason: z.string().max(256).optional()
})

export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>

/**
 * User list query parameters
 */
export const ListUsersQuerySchema = z.object({
  userType: UserTypeSchema.optional(),
  status: UserStatusSchema.optional(),
  role: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  search: z.string().max(100).optional()
})

export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>

/**
 * Password reset request
 */
export const PasswordResetRequestSchema = z.object({
  username: z.string().min(3).max(50),
  newPassword: z.string().min(12).max(128).optional(), // Optional - will be generated if not provided
  forceChange: z.boolean().default(true),
  reason: z.string().max(256).optional()
})

export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>

// =============================================================================
// Role and Permission Types
// =============================================================================

/**
 * Role definition
 */
export const RoleDefinitionSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200),
  permissions: z.array(z.string()),
  isBuiltIn: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>

/**
 * Permission definition
 */
export const PermissionSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200),
  category: z.enum(['database', 'schema', 'table', 'system']),
  resource: z.string().max(100).optional(),
  action: z.enum(['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'execute', 'usage'])
})

export type Permission = z.infer<typeof PermissionSchema>

// =============================================================================
// Audit and Logging Types
// =============================================================================

/**
 * User audit event
 */
export const UserAuditEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.enum(['user.created', 'user.updated', 'user.deleted', 'user.suspended', 'user.activated', 'user.password_reset', 'user.login', 'user.login_failed']),
  userId: z.string().optional(),
  username: z.string(),
  actorId: z.string().optional(),
  actorUsername: z.string(),
  timestamp: z.string().datetime(),
  details: z.record(z.any()),
  ipAddress: z.string().ip().optional(),
  userAgent: z.string().max(500).optional()
})

export type UserAuditEvent = z.infer<typeof UserAuditEventSchema>

// =============================================================================
// CLI Configuration Types
// =============================================================================

/**
 * CLI configuration
 */
export const CLIConfigSchema = z.object({
  database: z.object({
    host: z.string().default('localhost'),
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().default('app'),
    adminUser: z.string().default('gatekeeper_admin'),
    adminPassword: z.string(),
    sslMode: z.enum(['disable', 'require', 'prefer']).default('disable')
  }),
  agent: z.object({
    httpUrl: z.string().url().default('http://localhost:4001')
  }).default({}),
  security: z.object({
    passwordMinLength: z.number().int().min(8).max(128).default(12),
    passwordComplexity: z.boolean().default(true),
    sessionTimeout: z.number().int().min(300).max(86400).default(3600) // 1 hour default
  }).default({}),
  defaults: z.object({
    userType: UserTypeSchema.default('developer'),
    connectionLimit: z.number().int().min(1).max(10).default(3),
    defaultRoles: z.array(z.string()).default(['app_read'])
  }).default({})
})

export type CLIConfig = z.infer<typeof CLIConfigSchema>
