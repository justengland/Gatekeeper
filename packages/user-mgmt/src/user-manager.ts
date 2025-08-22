/**
 * User Management Service
 * Manages permanent database users using the Gatekeeper Agent stack
 */

import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import type { Logger } from 'pino'
import {
  type DatabaseUser,
  type CreateUserRequest,
  type UpdateUserRequest,
  type ListUsersQuery,
  type PasswordResetRequest,
  type UserAuditEvent
} from './types.js'

export interface UserManagerConfig {
  database: {
    host: string
    port: number
    database: string
    user: string
    password: string
    ssl?: boolean | 'require' | 'prefer' | 'disable'
    maxConnections?: number
  }
  agent: {
    httpUrl: string
  }
  security: {
    passwordMinLength: number
    passwordComplexity: boolean
  }
  logger: Logger
}

export class UserManager {
  private readonly pool: Pool
  private readonly config: UserManagerConfig
  private readonly logger: Logger

  constructor (config: UserManagerConfig) {
    this.config = config
    this.logger = config.logger.child({ component: 'user-manager' })

    // Initialize PostgreSQL connection pool
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      ssl: config.database.ssl === 'require'
        ? { rejectUnauthorized: false }
        : config.database.ssl === 'disable'
          ? false
          : false,
      max: config.database.maxConnections || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })

    this.pool.on('error', (err) => {
      this.logger.error({ error: err }, 'PostgreSQL pool error')
    })

    this.logger.info('UserManager initialized')
  }

  /**
   * Create a new permanent database user
   */
  async createUser (request: CreateUserRequest, createdBy: string): Promise<DatabaseUser> {
    const userId = uuidv4()
    const correlationId = uuidv4()
    const logger = this.logger.child({ correlationId, userId })

    logger.info({ username: request.username, userType: request.userType }, 'Creating new user')

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      // Check if user already exists
      const existingUser = await client.query(
        'SELECT username FROM gatekeeper_users WHERE username = $1 OR email = $2',
        [request.username, request.email]
      )

      if (existingUser.rows.length > 0) {
        throw new Error(`User with username '${request.username}' or email '${request.email}' already exists`)
      }

      // Generate password if not provided
      const password = request.password || this.generateSecurePassword()
      const hashedPassword = await bcrypt.hash(password, 12)

      // Create the database user record
      const now = new Date().toISOString()
      const user: DatabaseUser = {
        id: userId,
        username: request.username,
        email: request.email,
        fullName: request.fullName,
        userType: request.userType,
        roles: request.roles,
        status: 'active',
        connectionLimit: request.connectionLimit,
        validUntil: request.validUntil,
        createdAt: now,
        updatedAt: now,
        createdBy,
        lastLoginAt: undefined,
        metadata: {}
      }

      // Insert user into gatekeeper_users table
      await client.query(`
        INSERT INTO gatekeeper_users (
          id, username, email, full_name, user_type, roles, status, 
          connection_limit, valid_until, password_hash, created_at, 
          updated_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        user.id,
        user.username,
        user.email,
        user.fullName,
        user.userType,
        JSON.stringify(user.roles),
        user.status,
        user.connectionLimit,
        user.validUntil || null,
        hashedPassword,
        user.createdAt,
        user.updatedAt,
        user.createdBy
      ])

      // Create the actual PostgreSQL user using SECURITY DEFINER function
      const validUntilDate = request.validUntil ? new Date(request.validUntil) : null

      await client.query(`
        SELECT gk_create_permanent_user($1, $2, $3, $4, $5)
      `, [
        request.username,
        password,
        validUntilDate?.toISOString() || null,
        JSON.stringify(request.roles),
        request.connectionLimit
      ])

      // Log audit event
      await this.logAuditEvent(client, {
        id: uuidv4(),
        eventType: 'user.created',
        userId,
        username: request.username,
        actorId: undefined,
        actorUsername: createdBy,
        timestamp: now,
        details: {
          userType: request.userType,
          roles: request.roles,
          connectionLimit: request.connectionLimit,
          reason: request.reason
        }
      })

      await client.query('COMMIT')

      logger.info({
        userId,
        username: request.username,
        roles: request.roles
      }, 'User created successfully')

      // Return user without password
      return user
    } catch (error) {
      await client.query('ROLLBACK')
      logger.error({ error }, 'Failed to create user')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * List users with optional filtering
   */
  async listUsers (query: Partial<ListUsersQuery> = {}): Promise<{ users: DatabaseUser[], total: number }> {
    const logger = this.logger.child({ query })
    logger.info('Listing users')

    const client = await this.pool.connect()

    try {
      // Build WHERE clause
      const conditions: string[] = ['status != $1']
      const params: any[] = ['deleted']
      let paramIndex = 2

      if (query.userType) {
        conditions.push(`user_type = $${paramIndex}`)
        params.push(query.userType)
        paramIndex++
      }

      if (query.status) {
        conditions.push(`status = $${paramIndex}`)
        params.push(query.status)
        paramIndex++
      }

      if (query.role) {
        conditions.push(`roles @> $${paramIndex}`)
        params.push(JSON.stringify([query.role]))
        paramIndex++
      }

      if (query.search) {
        conditions.push(`(username ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR full_name ILIKE $${paramIndex})`)
        params.push(`%${query.search}%`)
        paramIndex++
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // Get total count
      const countResult = await client.query(`
        SELECT COUNT(*) as total 
        FROM gatekeeper_users 
        ${whereClause}
      `, params)

      const total = parseInt(countResult.rows[0].total)

      // Get users with pagination
      const usersResult = await client.query(`
        SELECT 
          id, username, email, full_name, user_type, roles, status,
          connection_limit, valid_until, created_at, updated_at, 
          created_by, last_login_at
        FROM gatekeeper_users 
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...params, query.limit || 50, query.offset || 0])

      const users: DatabaseUser[] = usersResult.rows.map(row => ({
        id: row.id,
        username: row.username,
        email: row.email,
        fullName: row.full_name,
        userType: row.user_type,
        roles: typeof row.roles === 'string' ? JSON.parse(row.roles || '[]') : (row.roles || []),
        status: row.status,
        connectionLimit: row.connection_limit,
        validUntil: row.valid_until?.toISOString(),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        lastLoginAt: row.last_login_at?.toISOString(),
        metadata: {}
      }))

      logger.info({ total, returned: users.length }, 'Listed users')

      return { users, total }
    } finally {
      client.release()
    }
  }

  /**
   * Get user by username
   */
  async getUser (username: string): Promise<DatabaseUser | null> {
    const logger = this.logger.child({ username })
    logger.info('Getting user')

    const client = await this.pool.connect()

    try {
      const result = await client.query(`
        SELECT 
          id, username, email, full_name, user_type, roles, status,
          connection_limit, valid_until, created_at, updated_at, 
          created_by, last_login_at
        FROM gatekeeper_users 
        WHERE username = $1 AND status != 'deleted'
      `, [username])

      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0]
      return {
        id: row.id,
        username: row.username,
        email: row.email,
        fullName: row.full_name,
        userType: row.user_type,
        roles: typeof row.roles === 'string' ? JSON.parse(row.roles || '[]') : (row.roles || []),
        status: row.status,
        connectionLimit: row.connection_limit,
        validUntil: row.valid_until?.toISOString(),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        lastLoginAt: row.last_login_at?.toISOString(),
        metadata: {}
      }
    } finally {
      client.release()
    }
  }

  /**
   * Update user
   */
  async updateUser (username: string, request: UpdateUserRequest, updatedBy: string): Promise<DatabaseUser> {
    const correlationId = uuidv4()
    const logger = this.logger.child({ correlationId, username })

    logger.info({ updates: Object.keys(request) }, 'Updating user')

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      // Get current user
      const currentUser = await this.getUser(username)
      if (currentUser == null) {
        throw new Error(`User '${username}' not found`)
      }

      // Build update query
      const updateFields: string[] = ['updated_at = $1']
      const params: any[] = [new Date().toISOString()]
      let paramIndex = 2

      if (request.email) {
        updateFields.push(`email = $${paramIndex}`)
        params.push(request.email)
        paramIndex++
      }

      if (request.fullName) {
        updateFields.push(`full_name = $${paramIndex}`)
        params.push(request.fullName)
        paramIndex++
      }

      if (request.userType) {
        updateFields.push(`user_type = $${paramIndex}`)
        params.push(request.userType)
        paramIndex++
      }

      if (request.roles != null) {
        updateFields.push(`roles = $${paramIndex}`)
        params.push(JSON.stringify(request.roles))
        paramIndex++
      }

      if (request.status) {
        updateFields.push(`status = $${paramIndex}`)
        params.push(request.status)
        paramIndex++
      }

      if (request.connectionLimit) {
        updateFields.push(`connection_limit = $${paramIndex}`)
        params.push(request.connectionLimit)
        paramIndex++
      }

      if (request.validUntil !== undefined) {
        updateFields.push(`valid_until = $${paramIndex}`)
        params.push(request.validUntil)
        paramIndex++
      }

      // Update user record
      await client.query(`
        UPDATE gatekeeper_users 
        SET ${updateFields.join(', ')}
        WHERE username = $${paramIndex}
      `, [...params, username])

      // Update PostgreSQL user if needed
      if ((request.roles != null) || request.connectionLimit || request.status === 'suspended' || request.status === 'active') {
        await client.query(`
          SELECT gk_update_permanent_user($1, $2, $3, $4)
        `, [
          username,
          (request.roles != null) ? JSON.stringify(request.roles) : null,
          request.connectionLimit || null,
          request.status === 'suspended' ? false : null // disable login if suspended
        ])
      }

      // Log audit event
      await this.logAuditEvent(client, {
        id: uuidv4(),
        eventType: 'user.updated',
        userId: currentUser.id,
        username,
        actorId: undefined,
        actorUsername: updatedBy,
        timestamp: new Date().toISOString(),
        details: {
          changes: request,
          reason: request.reason
        }
      })

      await client.query('COMMIT')

      logger.info('User updated successfully')

      // Return updated user
      const updatedUser = await this.getUser(username)
      return updatedUser!
    } catch (error) {
      await client.query('ROLLBACK')
      logger.error({ error }, 'Failed to update user')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Reset user password
   */
  async resetPassword (request: PasswordResetRequest, actorUsername: string): Promise<{ password: string }> {
    const correlationId = uuidv4()
    const logger = this.logger.child({ correlationId, username: request.username })

    logger.info('Resetting user password')

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      // Get current user
      const currentUser = await this.getUser(request.username)
      if (currentUser == null) {
        throw new Error(`User '${request.username}' not found`)
      }

      // Generate new password if not provided
      const newPassword = request.newPassword || this.generateSecurePassword()
      const hashedPassword = await bcrypt.hash(newPassword, 12)

      // Update password hash in database
      await client.query(`
        UPDATE gatekeeper_users 
        SET password_hash = $1, updated_at = $2
        WHERE username = $3
      `, [hashedPassword, new Date().toISOString(), request.username])

      // Update PostgreSQL user password
      await client.query(`
        SELECT gk_reset_user_password($1, $2)
      `, [request.username, newPassword])

      // Log audit event
      await this.logAuditEvent(client, {
        id: uuidv4(),
        eventType: 'user.password_reset',
        userId: currentUser.id,
        username: request.username,
        actorId: undefined,
        actorUsername,
        timestamp: new Date().toISOString(),
        details: {
          forceChange: request.forceChange,
          reason: request.reason
        }
      })

      await client.query('COMMIT')

      logger.info('Password reset successfully')

      return { password: newPassword }
    } catch (error) {
      await client.query('ROLLBACK')
      logger.error({ error }, 'Failed to reset password')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Delete user (soft delete)
   */
  async deleteUser (username: string, deletedBy: string, reason?: string): Promise<void> {
    const correlationId = uuidv4()
    const logger = this.logger.child({ correlationId, username })

    logger.info('Deleting user')

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      // Get current user
      const currentUser = await this.getUser(username)
      if (currentUser == null) {
        throw new Error(`User '${username}' not found`)
      }

      // Soft delete user
      await client.query(`
        UPDATE gatekeeper_users 
        SET status = 'deleted', updated_at = $1
        WHERE username = $2
      `, [new Date().toISOString(), username])

      // Drop PostgreSQL user
      await client.query(`
        SELECT gk_drop_user($1)
      `, [username])

      // Log audit event
      await this.logAuditEvent(client, {
        id: uuidv4(),
        eventType: 'user.deleted',
        userId: currentUser.id,
        username,
        actorId: undefined,
        actorUsername: deletedBy,
        timestamp: new Date().toISOString(),
        details: { reason }
      })

      await client.query('COMMIT')

      logger.info('User deleted successfully')
    } catch (error) {
      await client.query('ROLLBACK')
      logger.error({ error }, 'Failed to delete user')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Initialize user management schema
   */
  async initializeSchema (): Promise<void> {
    this.logger.info('Initializing user management schema')

    const client = await this.pool.connect()

    try {
      // Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS gatekeeper_users (
          id UUID PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          full_name VARCHAR(100) NOT NULL,
          user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('admin', 'developer', 'analyst', 'service')),
          roles JSONB NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'deleted')),
          connection_limit INTEGER DEFAULT 3,
          valid_until TIMESTAMPTZ,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          created_by VARCHAR(50) NOT NULL,
          last_login_at TIMESTAMPTZ,
          metadata JSONB DEFAULT '{}'::jsonb
        )
      `)

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gatekeeper_users_username ON gatekeeper_users(username)
      `)
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gatekeeper_users_email ON gatekeeper_users(email)
      `)
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gatekeeper_users_status ON gatekeeper_users(status)
      `)
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gatekeeper_users_user_type ON gatekeeper_users(user_type)
      `)

      // Create user audit table
      await client.query(`
        CREATE TABLE IF NOT EXISTS gatekeeper_user_audit (
          id UUID PRIMARY KEY,
          event_type VARCHAR(50) NOT NULL,
          user_id UUID,
          username VARCHAR(50) NOT NULL,
          actor_id UUID,
          actor_username VARCHAR(50) NOT NULL,
          timestamp TIMESTAMPTZ DEFAULT NOW(),
          details JSONB,
          ip_address INET,
          user_agent TEXT
        )
      `)

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gatekeeper_user_audit_username ON gatekeeper_user_audit(username)
      `)
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gatekeeper_user_audit_timestamp ON gatekeeper_user_audit(timestamp)
      `)

      this.logger.info('Schema initialized successfully')
    } finally {
      client.release()
    }
  }

  /**
   * Shutdown gracefully
   */
  async shutdown (): Promise<void> {
    this.logger.info('Shutting down UserManager...')
    await this.pool.end()
    this.logger.info('UserManager shutdown complete')
  }

  // Private helper methods

  private generateSecurePassword (): string {
    const length = Math.max(this.config.security.passwordMinLength, 16)
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
    let password = ''

    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length))
    }

    return password
  }

  private async logAuditEvent (client: any, event: UserAuditEvent): Promise<void> {
    try {
      await client.query(`
        INSERT INTO gatekeeper_user_audit (
          id, event_type, user_id, username, actor_id, actor_username, 
          timestamp, details, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        event.id,
        event.eventType,
        event.userId || null,
        event.username,
        event.actorId || null,
        event.actorUsername,
        event.timestamp,
        JSON.stringify(event.details),
        event.ipAddress || null,
        event.userAgent || null
      ])
    } catch (error) {
      this.logger.warn({ error }, 'Failed to log audit event')
      // Don't fail the main operation if audit logging fails
    }
  }
}
