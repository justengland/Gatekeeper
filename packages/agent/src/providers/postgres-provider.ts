/**
 * PostgreSQL Database Provider
 * Implements the DatabaseProvider interface using PostgreSQL-specific features
 * Uses SECURITY DEFINER functions for safe ephemeral user management
 */

import { Pool, PoolClient } from 'pg'
import type { Logger } from 'pino'
import {
  DatabaseProvider,
  DatabaseType,
  DatabaseConnectionConfig,
  DatabaseCredentials,
  CreateEphemeralUserRequest,
  CreateEphemeralUserResult,
  HealthCheckResult,
  HealthStatus,
  RolePack,
  UserCleanupResult,
  DatabaseProviderError,
  ProviderInitializationError,
  RolePackError
} from '@gatekeeper/shared'

/**
 * PostgreSQL-specific configuration options
 */
export interface PostgresProviderOptions {
  maxConnections?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
  statementTimeout?: number
  queryTimeout?: number
}

/**
 * PostgreSQL provider implementation
 * Leverages existing SECURITY DEFINER functions for user management
 */
export class PostgresProvider implements DatabaseProvider {
  readonly type: DatabaseType = 'postgres'
  readonly version: string = '1.0.0'

  private pool: Pool | undefined
  private config?: DatabaseConnectionConfig
  private logger: Logger
  private options: PostgresProviderOptions

  constructor(logger: Logger, options: PostgresProviderOptions = {}) {
    this.logger = logger.child({ component: 'postgres-provider' })
    this.options = {
      maxConnections: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statementTimeout: 30000,
      queryTimeout: 25000,
      ...options
    }
  }

  /**
   * Initialize the provider with connection configuration and credentials
   */
  async initialize(config: DatabaseConnectionConfig, credentials: DatabaseCredentials): Promise<void> {
    try {
      this.config = config

      // Validate that this is a Postgres configuration
      if (config.type !== 'postgres') {
        throw new ProviderInitializationError('postgres', `Invalid database type: ${config.type}`)
      }

      // Create PostgreSQL connection pool
      this.pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: credentials.username,
        password: credentials.password,
        ssl: this.getSslConfig(config.sslMode),
        max: this.options.maxConnections,
        idleTimeoutMillis: this.options.idleTimeoutMillis,
        connectionTimeoutMillis: this.options.connectionTimeoutMillis,
        statement_timeout: this.options.statementTimeout,
        query_timeout: this.options.queryTimeout,
        // PostgreSQL-specific options from config
        ...config.options
      })

      // Set up error handling
      this.pool.on('error', (err) => {
        this.logger.error({ error: err }, 'PostgreSQL pool error')
      })

      // Test the connection
      const client = await this.pool.connect()
      try {
        await client.query('SELECT 1')
        this.logger.info('PostgreSQL provider initialized successfully')
      } finally {
        client.release()
      }

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize PostgreSQL provider')
      if (error instanceof Error) {
        throw new ProviderInitializationError('postgres', error.message)
      }
      throw new ProviderInitializationError('postgres', 'Unknown initialization error')
    }
  }

  /**
   * Health check implementation
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString()

    if (!this.pool) {
      return {
        status: 'unhealthy',
        message: 'Provider not initialized',
        timestamp,
        details: { error: 'Pool not created' }
      }
    }

    try {
      const client = await this.pool.connect()
      
      try {
        // Test basic connectivity
        await client.query('SELECT 1')
        
        // Test validation function (from bootstrap SQL)
        const validation = await client.query('SELECT * FROM gk_validate_setup()')
        const checks = validation.rows.reduce((acc, row) => {
          acc[row.check_name] = row.status
          return acc
        }, {} as Record<string, string>)
        
        const allOk = Object.values(checks).every(status => status === 'OK')
        const status: HealthStatus = allOk ? 'healthy' : 'degraded'
        
        return {
          status,
          message: allOk ? 'All checks passed' : 'Some validation checks failed',
          timestamp,
          details: {
            database: 'connected',
            setupValidation: checks,
            poolStats: {
              totalCount: this.pool.totalCount,
              idleCount: this.pool.idleCount,
              waitingCount: this.pool.waitingCount
            }
          }
        }
        
      } finally {
        client.release()
      }
      
    } catch (error) {
      this.logger.error({ error }, 'PostgreSQL health check failed')
      
      return {
        status: 'unhealthy',
        message: 'Health check failed',
        timestamp,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  }

  /**
   * Create ephemeral user using SECURITY DEFINER function
   */
  async createEphemeralUser(request: CreateEphemeralUserRequest): Promise<CreateEphemeralUserResult> {
    if (!this.pool || !this.config) {
      throw new DatabaseProviderError('Provider not initialized', 'NOT_INITIALIZED', false, 'postgres')
    }

    const client = await this.pool.connect()
    
    try {
      const expiresAt = new Date(Date.now() + request.ttlMinutes * 60 * 1000)

      this.logger.info({ 
        username: request.username,
        role: request.role,
        ttlMinutes: request.ttlMinutes,
        connectionLimit: request.connectionLimit
      }, 'Creating PostgreSQL ephemeral user')

      // Begin transaction
      await client.query('BEGIN')
      
      try {
        // Use existing SECURITY DEFINER function
        await client.query(`
          SELECT gk_create_ephemeral_user($1, $2, $3, $4, $5)
        `, [
          request.username,
          request.password,
          expiresAt.toISOString(),
          request.role,
          request.connectionLimit
        ])

        await client.query('COMMIT')

        // Generate PostgreSQL DSN
        const dsn = this.generateDsn(this.config, request.username, request.password)
        
        this.logger.info({ 
          username: request.username,
          expiresAt: expiresAt.toISOString()
        }, 'PostgreSQL ephemeral user created successfully')

        return {
          username: request.username,
          dsn,
          expiresAt: expiresAt.toISOString(),
          connectionLimit: request.connectionLimit,
          providerMetadata: {
            postgresVersion: await this.getPostgresVersion(client)
          }
        }

      } catch (dbError) {
        await client.query('ROLLBACK')
        throw dbError
      }

    } catch (error) {
      this.logger.error({ error, username: request.username }, 'Failed to create PostgreSQL ephemeral user')
      
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          throw new DatabaseProviderError(`User ${request.username} already exists`, 'USER_EXISTS', false, 'postgres')
        }
        if (error.message.includes('Role') && error.message.includes('does not exist')) {
          throw new DatabaseProviderError(`Role ${request.role} does not exist`, 'ROLE_NOT_FOUND', false, 'postgres')
        }
      }
      
      throw new DatabaseProviderError('Failed to create ephemeral user', 'USER_CREATION_FAILED', true, 'postgres')
      
    } finally {
      client.release()
    }
  }

  /**
   * Drop user using SECURITY DEFINER function
   */
  async dropUser(username: string): Promise<boolean> {
    if (!this.pool) {
      throw new DatabaseProviderError('Provider not initialized', 'NOT_INITIALIZED', false, 'postgres')
    }

    const client = await this.pool.connect()
    
    try {
      this.logger.info({ username }, 'Dropping PostgreSQL user')

      // Use existing SECURITY DEFINER function
      const result = await client.query('SELECT gk_drop_user($1)', [username])
      const success = result.rows[0]?.gk_drop_user === true

      if (success) {
        this.logger.info({ username }, 'PostgreSQL user dropped successfully')
      } else {
        this.logger.warn({ username }, 'PostgreSQL user was not found or already dropped')
      }

      return success

    } catch (error) {
      this.logger.error({ error, username }, 'Failed to drop PostgreSQL user')
      throw new DatabaseProviderError('Failed to drop user', 'USER_DROP_FAILED', true, 'postgres')
    } finally {
      client.release()
    }
  }

  /**
   * List ephemeral users using SECURITY DEFINER function
   */
  async listEphemeralUsers(): Promise<Array<{
    username: string
    expiresAt?: string
    isExpired: boolean
    activeConnections: number
  }>> {
    if (!this.pool) {
      throw new DatabaseProviderError('Provider not initialized', 'NOT_INITIALIZED', false, 'postgres')
    }

    const client = await this.pool.connect()
    
    try {
      // Use existing SECURITY DEFINER function
      const result = await client.query('SELECT * FROM gk_list_ephemeral_users()')
      
      return result.rows.map(row => ({
        username: row.username,
        expiresAt: row.valid_until?.toISOString(),
        isExpired: row.is_expired,
        activeConnections: parseInt(row.active_connections, 10) || 0
      }))

    } catch (error) {
      this.logger.error({ error }, 'Failed to list PostgreSQL ephemeral users')
      throw new DatabaseProviderError('Failed to list users', 'USER_LIST_FAILED', true, 'postgres')
    } finally {
      client.release()
    }
  }

  /**
   * Clean up expired users using SECURITY DEFINER function
   */
  async cleanupExpiredUsers(olderThanMinutes: number = 5): Promise<UserCleanupResult[]> {
    if (!this.pool) {
      throw new DatabaseProviderError('Provider not initialized', 'NOT_INITIALIZED', false, 'postgres')
    }

    const client = await this.pool.connect()
    
    try {
      this.logger.info({ olderThanMinutes }, 'Starting PostgreSQL cleanup of expired users')

      // Use existing SECURITY DEFINER function
      const result = await client.query(`
        SELECT * FROM gk_cleanup_expired_users($1)
      `, [olderThanMinutes])

      const cleanupResults: UserCleanupResult[] = result.rows.map(row => ({
        username: row.username,
        wasExpired: row.was_expired,
        dropped: row.dropped,
        errorMessage: row.error_message || undefined
      }))

      const successCount = cleanupResults.filter(r => r.dropped).length
      this.logger.info({ 
        cleanedCount: successCount,
        totalProcessed: cleanupResults.length 
      }, 'PostgreSQL cleanup completed')

      return cleanupResults

    } catch (error) {
      this.logger.error({ error }, 'PostgreSQL cleanup failed')
      throw new DatabaseProviderError('Failed to cleanup expired users', 'CLEANUP_FAILED', true, 'postgres')
    } finally {
      client.release()
    }
  }

  /**
   * Get available role packs (PostgreSQL-specific)
   */
  async getAvailableRolePacks(): Promise<RolePack[]> {
    // For now, return the built-in role packs
    // In the future, this could read from a role pack registry
    return [
      {
        name: 'app_read',
        databaseType: 'postgres',
        version: 'pg-1.0.0',
        description: 'Read-only access to application tables',
        permissions: ['SELECT on all tables in schema public'],
        definition: {
          grants: ['CONNECT ON DATABASE', 'USAGE ON SCHEMA public', 'SELECT ON ALL TABLES IN SCHEMA public']
        }
      },
      {
        name: 'app_write',
        databaseType: 'postgres',
        version: 'pg-1.0.0',
        description: 'Read and write access to application tables',
        permissions: ['SELECT, INSERT, UPDATE on all tables in schema public'],
        definition: {
          grants: ['CONNECT ON DATABASE', 'USAGE ON SCHEMA public', 'SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public']
        }
      },
      {
        name: 'app_admin',
        databaseType: 'postgres',
        version: 'pg-1.0.0',
        description: 'Full administrative access to application database',
        permissions: ['ALL PRIVILEGES on all tables, sequences, functions in schema public'],
        definition: {
          grants: ['CONNECT ON DATABASE', 'ALL PRIVILEGES ON ALL TABLES IN SCHEMA public', 'ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public']
        }
      }
    ]
  }

  /**
   * Install role pack (PostgreSQL implementation)
   */
  async installRolePack(rolePack: RolePack): Promise<void> {
    if (rolePack.databaseType !== 'postgres') {
      throw new RolePackError('postgres', rolePack.name, `Invalid database type: ${rolePack.databaseType}`)
    }

    // For now, role packs are pre-installed via bootstrap SQL
    // This method would be used for dynamic role pack installation
    this.logger.info({ rolePackName: rolePack.name, version: rolePack.version }, 'Role pack installation requested (using pre-installed roles)')
  }

  /**
   * Generate PostgreSQL DSN
   */
  generateDsn(config: DatabaseConnectionConfig, username: string, password: string): string {
    const sslMode = config.sslMode || 'prefer'
    return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${config.host}:${config.port}/${config.database}?sslmode=${sslMode}`
  }

  /**
   * Test connection with given DSN
   */
  async testConnection(dsn: string): Promise<boolean> {
    try {
      const testPool = new Pool({ connectionString: dsn })
      const client = await testPool.connect()
      
      try {
        await client.query('SELECT 1')
        return true
      } finally {
        client.release()
        await testPool.end()
      }
    } catch (error) {
      this.logger.debug({ error }, 'Test connection failed')
      return false
    }
  }

  /**
   * Close provider and clean up resources
   */
  async close(): Promise<void> {
    if (this.pool) {
      this.logger.info('Closing PostgreSQL provider')
      await this.pool.end()
      this.pool = undefined
    }
  }

  // Private helper methods

  private getSslConfig(sslMode: string = 'prefer'): boolean | { rejectUnauthorized: boolean } {
    switch (sslMode) {
      case 'require':
        return { rejectUnauthorized: false }
      case 'disable':
        return false
      case 'prefer':
      default:
        return false // Let PostgreSQL decide
    }
  }

  private async getPostgresVersion(client: PoolClient): Promise<string> {
    try {
      const result = await client.query('SELECT version()')
      return result.rows[0]?.version || 'unknown'
    } catch {
      return 'unknown'
    }
  }
}