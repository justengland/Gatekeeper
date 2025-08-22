import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  DatabaseTargetSchema,
  RequesterSchema,
  RoleSchema,
  SessionStatusSchema,
  type DatabaseTarget,
  type Requester,
  type Role,
  type SessionStatus
} from './types.js';

describe('DatabaseTargetSchema', () => {
  it('should validate a complete database target', () => {
    const validTarget: DatabaseTarget = {
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      sslMode: 'prefer'
    };

    expect(DatabaseTargetSchema.parse(validTarget)).toEqual(validTarget);
  });

  it('should use default sslMode when not provided', () => {
    const target = {
      host: 'localhost',
      port: 5432,
      database: 'testdb'
    };

    const result = DatabaseTargetSchema.parse(target);
    expect(result.sslMode).toBe('prefer');
  });

  it('should reject invalid host', () => {
    expect(() => DatabaseTargetSchema.parse({
      host: '',
      port: 5432,
      database: 'testdb'
    })).toThrow(ZodError);
  });

  it('should reject invalid port numbers', () => {
    // Port too low
    expect(() => DatabaseTargetSchema.parse({
      host: 'localhost',
      port: 0,
      database: 'testdb'
    })).toThrow(ZodError);

    // Port too high
    expect(() => DatabaseTargetSchema.parse({
      host: 'localhost',
      port: 70000,
      database: 'testdb'
    })).toThrow(ZodError);

    // Non-integer port
    expect(() => DatabaseTargetSchema.parse({
      host: 'localhost',
      port: 5432.5,
      database: 'testdb'
    })).toThrow(ZodError);
  });

  it('should reject invalid database name', () => {
    expect(() => DatabaseTargetSchema.parse({
      host: 'localhost',
      port: 5432,
      database: ''
    })).toThrow(ZodError);
  });

  it('should reject invalid sslMode', () => {
    expect(() => DatabaseTargetSchema.parse({
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      sslMode: 'invalid'
    })).toThrow(ZodError);
  });
});

describe('RequesterSchema', () => {
  it('should validate requester with userId only', () => {
    const requester: Requester = {
      userId: 'user123'
    };

    expect(RequesterSchema.parse(requester)).toEqual(requester);
  });

  it('should validate requester with userId and email', () => {
    const requester: Requester = {
      userId: 'user123',
      email: 'user@example.com'
    };

    expect(RequesterSchema.parse(requester)).toEqual(requester);
  });

  it('should reject empty userId', () => {
    expect(() => RequesterSchema.parse({
      userId: '',
      email: 'user@example.com'
    })).toThrow(ZodError);
  });

  it('should reject invalid email format', () => {
    expect(() => RequesterSchema.parse({
      userId: 'user123',
      email: 'invalid-email'
    })).toThrow(ZodError);
  });

  it('should reject missing userId', () => {
    expect(() => RequesterSchema.parse({
      email: 'user@example.com'
    })).toThrow(ZodError);
  });
});

describe('RoleSchema', () => {
  it('should accept valid roles', () => {
    const validRoles: Role[] = ['app_read', 'app_write', 'app_admin'];
    
    validRoles.forEach(role => {
      expect(RoleSchema.parse(role)).toBe(role);
    });
  });

  it('should reject invalid roles', () => {
    const invalidRoles = ['invalid', 'admin', 'read', ''];
    
    invalidRoles.forEach(role => {
      expect(() => RoleSchema.parse(role)).toThrow(ZodError);
    });
  });
});

describe('SessionStatusSchema', () => {
  it('should accept valid session statuses', () => {
    const validStatuses: SessionStatus[] = ['pending', 'ready', 'revoked', 'expired', 'failed'];
    
    validStatuses.forEach(status => {
      expect(SessionStatusSchema.parse(status)).toBe(status);
    });
  });

  it('should reject invalid session statuses', () => {
    const invalidStatuses = ['invalid', 'running', 'complete', ''];
    
    invalidStatuses.forEach(status => {
      expect(() => SessionStatusSchema.parse(status)).toThrow(ZodError);
    });
  });
});