import { describe, it, expect } from 'vitest'
import {
  UserTypeSchema,
  UserStatusSchema,
  DatabaseUserSchema,
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  ListUsersQuerySchema,
  PasswordResetRequestSchema,
  RoleDefinitionSchema,
  PermissionSchema,
  UserAuditEventSchema,
  CLIConfigSchema
} from './types.js'

describe('User Management Types', () => {
  describe('UserTypeSchema', () => {
    it('should validate valid user types', () => {
      expect(() => UserTypeSchema.parse('admin')).not.toThrow()
      expect(() => UserTypeSchema.parse('developer')).not.toThrow()
      expect(() => UserTypeSchema.parse('analyst')).not.toThrow()
      expect(() => UserTypeSchema.parse('service')).not.toThrow()
    })

    it('should reject invalid user types', () => {
      expect(() => UserTypeSchema.parse('invalid')).toThrow()
      expect(() => UserTypeSchema.parse('')).toThrow()
    })
  })

  describe('UserStatusSchema', () => {
    it('should validate valid statuses', () => {
      expect(() => UserStatusSchema.parse('active')).not.toThrow()
      expect(() => UserStatusSchema.parse('inactive')).not.toThrow()
      expect(() => UserStatusSchema.parse('suspended')).not.toThrow()
      expect(() => UserStatusSchema.parse('deleted')).not.toThrow()
    })

    it('should reject invalid statuses', () => {
      expect(() => UserStatusSchema.parse('invalid')).toThrow()
    })
  })

  describe('DatabaseUserSchema', () => {
    it('should validate a complete user object', () => {
      const user = {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        username: 'test_user',
        email: 'test@example.com',
        fullName: 'Test User',
        userType: 'developer',
        roles: ['app_read'],
        status: 'active',
        connectionLimit: 3,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
        createdBy: 'admin'
      }

      expect(() => DatabaseUserSchema.parse(user)).not.toThrow()
    })

    it('should reject invalid username patterns', () => {
      const user = {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        username: 'Test_User', // Capital letters not allowed
        email: 'test@example.com',
        fullName: 'Test User',
        userType: 'developer',
        roles: ['app_read'],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
        createdBy: 'admin'
      }

      expect(() => DatabaseUserSchema.parse(user)).toThrow()
    })
  })

  describe('CreateUserRequestSchema', () => {
    it('should validate user creation request', () => {
      const request = {
        username: 'new_user',
        email: 'new@example.com',
        fullName: 'New User',
        userType: 'developer',
        roles: ['app_read', 'app_write'],
        connectionLimit: 5
      }

      expect(() => CreateUserRequestSchema.parse(request)).not.toThrow()
    })

    it('should apply default connection limit', () => {
      const request = {
        username: 'new_user',
        email: 'new@example.com',
        fullName: 'New User',
        userType: 'developer',
        roles: ['app_read']
      }

      const parsed = CreateUserRequestSchema.parse(request)
      expect(parsed.connectionLimit).toBe(3)
    })

    it('should require at least one role', () => {
      const request = {
        username: 'new_user',
        email: 'new@example.com',
        fullName: 'New User',
        userType: 'developer',
        roles: [] // Empty roles array
      }

      expect(() => CreateUserRequestSchema.parse(request)).toThrow()
    })
  })

  describe('ListUsersQuerySchema', () => {
    it('should validate query parameters with defaults', () => {
      const query = {}
      const parsed = ListUsersQuerySchema.parse(query)

      expect(parsed.limit).toBe(50)
      expect(parsed.offset).toBe(0)
    })

    it('should validate query with filters', () => {
      const query = {
        userType: 'admin',
        status: 'active',
        role: 'app_admin',
        limit: 25,
        offset: 10,
        search: 'test'
      }

      expect(() => ListUsersQuerySchema.parse(query)).not.toThrow()
    })
  })

  describe('PermissionSchema', () => {
    it('should validate permission objects', () => {
      const permission = {
        name: 'table_select',
        description: 'SELECT permission on tables',
        category: 'table',
        resource: 'users',
        action: 'select'
      }

      expect(() => PermissionSchema.parse(permission)).not.toThrow()
    })

    it('should reject invalid actions', () => {
      const permission = {
        name: 'invalid_action',
        description: 'Invalid action permission',
        category: 'table',
        action: 'invalid'
      }

      expect(() => PermissionSchema.parse(permission)).toThrow()
    })
  })

  describe('RoleDefinitionSchema', () => {
    it('should validate role definitions', () => {
      const role = {
        name: 'custom_role',
        description: 'Custom role with specific permissions',
        permissions: ['select', 'insert'],
        isBuiltIn: false,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      }

      expect(() => RoleDefinitionSchema.parse(role)).not.toThrow()
    })

    it('should default isBuiltIn to false', () => {
      const role = {
        name: 'custom_role',
        description: 'Custom role',
        permissions: ['select'],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
      }

      const parsed = RoleDefinitionSchema.parse(role)
      expect(parsed.isBuiltIn).toBe(false)
    })
  })

  describe('UserAuditEventSchema', () => {
    it('should validate audit events', () => {
      const event = {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        eventType: 'user.created',
        username: 'test_user',
        actorUsername: 'admin',
        timestamp: '2023-01-01T00:00:00Z',
        details: { reason: 'New developer account' }
      }

      expect(() => UserAuditEventSchema.parse(event)).not.toThrow()
    })

    it('should validate audit events with optional fields', () => {
      const event = {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        eventType: 'user.login',
        userId: 'user123',
        username: 'test_user',
        actorId: 'admin123',
        actorUsername: 'admin',
        timestamp: '2023-01-01T00:00:00Z',
        details: {},
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0'
      }

      expect(() => UserAuditEventSchema.parse(event)).not.toThrow()
    })
  })

  describe('CLIConfigSchema', () => {
    it('should validate CLI configuration with minimal values', () => {
      const config = {
        database: {
          adminPassword: 'secure_password'
        }
      }

      const parsed = CLIConfigSchema.parse(config)
      expect(parsed.database.host).toBe('localhost')
      expect(parsed.database.port).toBe(5432)
      expect(parsed.defaults.userType).toBe('developer')
      expect(parsed.defaults.connectionLimit).toBe(3)
    })

    it('should validate complete CLI configuration', () => {
      const config = {
        database: {
          host: 'db.example.com',
          port: 5433,
          database: 'production',
          adminUser: 'postgres',
          adminPassword: 'secure_password',
          sslMode: 'require'
        },
        agent: {
          httpUrl: 'https://agent.example.com'
        },
        security: {
          passwordMinLength: 16,
          passwordComplexity: true,
          sessionTimeout: 7200
        },
        defaults: {
          userType: 'analyst',
          connectionLimit: 5,
          defaultRoles: ['app_read', 'app_analyst']
        }
      }

      expect(() => CLIConfigSchema.parse(config)).not.toThrow()
    })
  })
})