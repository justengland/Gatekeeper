import { z } from 'zod'

// =============================================================================
// Database Provider Abstraction
// Designed to support multiple database types while starting with Postgres
// =============================================================================

/**
 * Supported database types
 */
export const DatabaseTypeSchema = z.enum(['postgres', 'oracle', 'sqlserver', 'mysql'])
export type DatabaseType = z.infer<typeof DatabaseTypeSchema>

/**
 * Database-specific connection configuration
 * Extends the existing DatabaseTarget with type information and provider-specific options
 */
export const DatabaseConnectionConfigSchema = z.object({
  type: DatabaseTypeSchema,
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535, 'Port must be between 1 and 65535'),
  database: z.string().min(1, 'Database name is required'),
  sslMode: z.enum(['disable', 'require', 'prefer']).optional().default('prefer'),
  // Database-specific connection options (e.g., Oracle TNS, SQL Server instance)
  options: z.record(z.string(), z.any()).optional().default({})
})

export type DatabaseConnectionConfig = z.infer<typeof DatabaseConnectionConfigSchema>

/**
 * Database admin credentials for provider operations
 * These are the privileged credentials used by the agent to manage ephemeral users
 */
export const DatabaseCredentialsSchema = z.object({
  username: z.string().min(1, 'Admin username is required'),
  password: z.string().min(1, 'Admin password is required')
})

export type DatabaseCredentials = z.infer<typeof DatabaseCredentialsSchema>

/**
 * Ephemeral user creation request
 * Database-agnostic representation of user creation parameters
 */
export const CreateEphemeralUserRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  role: z.string().min(1, 'Role is required'),
  ttlMinutes: z.number().int().min(1).max(1440, 'TTL must be between 1 and 1440 minutes'),
  connectionLimit: z.number().int().min(1).optional().default(2),
  // Additional provider-specific options
  providerOptions: z.record(z.string(), z.any()).optional().default({})
})

export type CreateEphemeralUserRequest = z.infer<typeof CreateEphemeralUserRequestSchema>

/**
 * Ephemeral user creation result
 * Standardized response across all database providers
 */
export const CreateEphemeralUserResultSchema = z.object({
  username: z.string(),
  dsn: z.string(), // Provider-specific DSN format
  expiresAt: z.string().datetime(),
  connectionLimit: z.number().int().optional(),
  // Provider-specific metadata
  providerMetadata: z.record(z.string(), z.any()).optional().default({})
})

export type CreateEphemeralUserResult = z.infer<typeof CreateEphemeralUserResultSchema>

/**
 * Database provider health status
 */
export const HealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy'])
export type HealthStatus = z.infer<typeof HealthStatusSchema>

/**
 * Database provider health check result
 */
export const HealthCheckResultSchema = z.object({
  status: HealthStatusSchema,
  message: z.string().optional(),
  timestamp: z.string().datetime(),
  details: z.record(z.string(), z.any()).optional().default({})
})

export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>

/**
 * Role pack information for database-specific privilege management
 * Supports versioned role definitions across different database types
 */
export const RolePackSchema = z.object({
  name: z.string().min(1, 'Role pack name is required'),
  databaseType: DatabaseTypeSchema,
  version: z.string().min(1, 'Version is required'),
  description: z.string().optional(),
  permissions: z.array(z.string()).min(1, 'At least one permission is required'),
  // SQL templates or provider-specific role definitions
  definition: z.record(z.string(), z.any())
})

export type RolePack = z.infer<typeof RolePackSchema>

/**
 * User cleanup result for batch operations
 */
export const UserCleanupResultSchema = z.object({
  username: z.string(),
  wasExpired: z.boolean(),
  dropped: z.boolean(),
  errorMessage: z.string().optional()
})

export type UserCleanupResult = z.infer<typeof UserCleanupResultSchema>

/**
 * Abstract database provider interface
 * All database-specific implementations must implement this interface
 * 
 * This interface is designed to:
 * 1. Support the existing Postgres SECURITY DEFINER pattern
 * 2. Allow for different authentication mechanisms (password, IAM, certificate)
 * 3. Handle database-specific connection and privilege patterns
 * 4. Maintain audit trail and security requirements
 */
export interface DatabaseProvider {
  /**
   * Get the database type this provider supports
   */
  readonly type: DatabaseType

  /**
   * Get the current provider version
   */
  readonly version: string

  /**
   * Initialize the provider with connection configuration and credentials
   * This should establish the admin connection and validate permissions
   */
  initialize(config: DatabaseConnectionConfig, credentials: DatabaseCredentials): Promise<void>

  /**
   * Check if the provider is properly initialized and can connect to the database
   * Should validate admin permissions and role pack installation
   */
  healthCheck(): Promise<HealthCheckResult>

  /**
   * Create an ephemeral user with the specified role and TTL
   * Must handle:
   * - Username generation validation (provider-specific patterns)
   * - Role assignment using provider's privilege system
   * - TTL enforcement (database-native where possible)
   * - Connection limits
   */
  createEphemeralUser(request: CreateEphemeralUserRequest): Promise<CreateEphemeralUserResult>

  /**
   * Drop an ephemeral user by username
   * Must be idempotent - no error if user doesn't exist
   * Should handle active connection termination gracefully
   */
  dropUser(username: string): Promise<boolean>

  /**
   * List all ephemeral users managed by this provider
   * Should include expiration status and connection info
   */
  listEphemeralUsers(): Promise<Array<{
    username: string
    expiresAt?: string
    isExpired: boolean
    activeConnections: number
  }>>

  /**
   * Get available role packs for this database type
   */
  getAvailableRolePacks(): Promise<RolePack[]>

  /**
   * Install or update role pack definitions in the database
   * Should be idempotent and handle version upgrades
   */
  installRolePack(rolePack: RolePack): Promise<void>

  /**
   * Clean up expired users based on their TTL
   * Returns number of users successfully cleaned up
   * Should handle batch operations efficiently
   */
  cleanupExpiredUsers(olderThanMinutes?: number): Promise<UserCleanupResult[]>

  /**
   * Generate a connection DSN for the given user and target
   * Must handle provider-specific DSN formats and SSL settings
   */
  generateDsn(config: DatabaseConnectionConfig, username: string, password: string): string

  /**
   * Close the provider and clean up resources
   * Should close connection pools and release resources gracefully
   */
  close(): Promise<void>

  /**
   * Test connectivity with ephemeral credentials
   * Used to validate that created users can actually connect
   */
  testConnection(dsn: string): Promise<boolean>
}

/**
 * Database provider factory function type
 */
export type DatabaseProviderFactory = () => DatabaseProvider

/**
 * Registry for database provider factories
 * Enables runtime provider selection and multi-tenant scenarios
 */
export interface DatabaseProviderRegistry {
  /**
   * Register a provider factory for a specific database type
   */
  register(type: DatabaseType, factory: DatabaseProviderFactory): void

  /**
   * Get a factory for a specific database type
   */
  get(type: DatabaseType): DatabaseProviderFactory | undefined

  /**
   * Create a new provider instance for a specific database type
   */
  create(type: DatabaseType): DatabaseProvider

  /**
   * Get all supported database types
   */
  getSupportedTypes(): DatabaseType[]

  /**
   * Check if a database type is supported
   */
  isSupported(type: DatabaseType): boolean
}

/**
 * Provider configuration for the agent
 * Extends existing AgentConfig to support multiple database types
 */
export const DatabaseProviderConfigSchema = z.object({
  type: DatabaseTypeSchema,
  connection: DatabaseConnectionConfigSchema,
  credentials: DatabaseCredentialsSchema,
  rolePackVersion: z.string().min(1, 'Role pack version is required'),
  // Provider-specific settings
  settings: z.record(z.string(), z.any()).optional().default({})
})

export type DatabaseProviderConfig = z.infer<typeof DatabaseProviderConfigSchema>

/**
 * Error types specific to database provider operations
 */
export class DatabaseProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly provider?: DatabaseType
  ) {
    super(message)
    this.name = 'DatabaseProviderError'
  }
}

export class ProviderNotFoundError extends DatabaseProviderError {
  constructor(type: DatabaseType) {
    super(`Database provider for type '${type}' not found`, 'PROVIDER_NOT_FOUND', false, type)
    this.name = 'ProviderNotFoundError'
  }
}

export class ProviderInitializationError extends DatabaseProviderError {
  constructor(provider: DatabaseType, message: string) {
    super(`Failed to initialize ${provider} provider: ${message}`, 'PROVIDER_INIT_ERROR', true, provider)
    this.name = 'ProviderInitializationError'
  }
}

export class RolePackError extends DatabaseProviderError {
  constructor(provider: DatabaseType, rolePack: string, message: string) {
    super(`Role pack '${rolePack}' error for ${provider}: ${message}`, 'ROLE_PACK_ERROR', false, provider)
    this.name = 'RolePackError'
  }
}