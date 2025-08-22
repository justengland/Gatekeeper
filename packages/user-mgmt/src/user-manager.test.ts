import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UserManager, type UserManagerConfig } from './user-manager.js'

// Mock dependencies
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
    on: vi.fn(), // Add the missing 'on' method for event handling
    removeAllListeners: vi.fn()
  }))
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashedpassword'),
    compare: vi.fn().mockResolvedValue(true)
  }
}))

describe('UserManager', () => {
  let userManager: UserManager
  let mockConfig: UserManagerConfig

  beforeEach(() => {
    mockConfig = {
      database: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'test_user',
        password: 'test_password'
      },
      agent: {
        httpUrl: 'http://localhost:4001'
      },
      security: {
        passwordMinLength: 12,
        passwordComplexity: true,
        sessionTimeout: 3600
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis()
      } as any
    }

    userManager = new UserManager(mockConfig)
  })

  describe('constructor', () => {
    it('should create UserManager instance', () => {
      expect(userManager).toBeInstanceOf(UserManager)
    })

    it('should initialize with provided config', () => {
      expect(userManager).toBeDefined()
      // Test that the constructor doesn't throw
    })
  })

  describe('public interface', () => {
    it('should have createUser method', () => {
      expect(typeof userManager.createUser).toBe('function')
    })

    it('should have updateUser method', () => {
      expect(typeof userManager.updateUser).toBe('function')
    })

    it('should have deleteUser method', () => {
      expect(typeof userManager.deleteUser).toBe('function')
    })

    it('should have listUsers method', () => {
      expect(typeof userManager.listUsers).toBe('function')
    })

    it('should have getUser method', () => {
      expect(typeof userManager.getUser).toBe('function')
    })

    it('should have resetPassword method', () => {
      expect(typeof userManager.resetPassword).toBe('function')
    })
  })

  describe('error handling', () => {
    it('should handle configuration errors', () => {
      const invalidConfig = {
        ...mockConfig,
        database: {
          ...mockConfig.database,
          port: -1 // Invalid port
        }
      }

      // Should not throw during construction, but may fail during initialization
      expect(() => new UserManager(invalidConfig)).not.toThrow()
    })
  })

  describe('logging', () => {
    it('should create child logger', () => {
      expect(mockConfig.logger.child).toHaveBeenCalledWith({ component: 'user-manager' })
    })
  })
})