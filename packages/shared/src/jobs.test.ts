import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  CreateSessionJobSchema,
  RevokeSessionJobSchema,
  CleanupJobSchema,
  AgentJobSchema,
  CreateSessionResultSchema,
  RevokeSessionResultSchema,
  CleanupResultSchema,
  type CreateSessionJob,
  type RevokeSessionJob,
  type CleanupJob,
  type CreateSessionResult,
  type RevokeSessionResult,
  type CleanupResult
} from './jobs.js';

describe('CreateSessionJobSchema', () => {
  const validJob: CreateSessionJob = {
    id: 'job_123',
    correlationId: '123e4567-e89b-12d3-a456-426614174000',
    type: 'create_session',
    target: {
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      sslMode: 'prefer'
    },
    role: 'app_read',
    ttlMinutes: 30,
    requester: {
      userId: 'user123',
      email: 'user@example.com'
    },
    reason: 'Testing'
  };

  it('should validate a complete create session job', () => {
    expect(CreateSessionJobSchema.parse(validJob)).toEqual(validJob);
  });

  it('should work without optional reason', () => {
    const jobWithoutReason = { ...validJob };
    delete jobWithoutReason.reason;
    
    expect(CreateSessionJobSchema.parse(jobWithoutReason)).toEqual(jobWithoutReason);
  });

  it('should reject invalid job id', () => {
    expect(() => CreateSessionJobSchema.parse({
      ...validJob,
      id: ''
    })).toThrow(ZodError);
  });

  it('should reject invalid correlation id', () => {
    expect(() => CreateSessionJobSchema.parse({
      ...validJob,
      correlationId: 'not-a-uuid'
    })).toThrow(ZodError);
  });

  it('should reject invalid ttl values', () => {
    // TTL too low
    expect(() => CreateSessionJobSchema.parse({
      ...validJob,
      ttlMinutes: 0
    })).toThrow(ZodError);

    // TTL too high
    expect(() => CreateSessionJobSchema.parse({
      ...validJob,
      ttlMinutes: 1500
    })).toThrow(ZodError);

    // Non-integer TTL
    expect(() => CreateSessionJobSchema.parse({
      ...validJob,
      ttlMinutes: 30.5
    })).toThrow(ZodError);
  });

  it('should reject reason that is too long', () => {
    expect(() => CreateSessionJobSchema.parse({
      ...validJob,
      reason: 'x'.repeat(257)
    })).toThrow(ZodError);
  });

  it('should reject wrong job type', () => {
    expect(() => CreateSessionJobSchema.parse({
      ...validJob,
      type: 'revoke_session'
    })).toThrow(ZodError);
  });
});

describe('RevokeSessionJobSchema', () => {
  const validJob: RevokeSessionJob = {
    id: 'job_456',
    correlationId: '123e4567-e89b-12d3-a456-426614174000',
    type: 'revoke_session',
    sessionId: 'ses_123456'
  };

  it('should validate a complete revoke session job', () => {
    expect(RevokeSessionJobSchema.parse(validJob)).toEqual(validJob);
  });

  it('should reject empty session id', () => {
    expect(() => RevokeSessionJobSchema.parse({
      ...validJob,
      sessionId: ''
    })).toThrow(ZodError);
  });

  it('should reject wrong job type', () => {
    expect(() => RevokeSessionJobSchema.parse({
      ...validJob,
      type: 'create_session'
    })).toThrow(ZodError);
  });
});

describe('CleanupJobSchema', () => {
  const validJob: CleanupJob = {
    id: 'job_789',
    correlationId: '123e4567-e89b-12d3-a456-426614174000',
    type: 'cleanup',
    olderThanMinutes: 10
  };

  it('should validate a complete cleanup job', () => {
    expect(CleanupJobSchema.parse(validJob)).toEqual(validJob);
  });

  it('should use default olderThanMinutes when not provided', () => {
    const jobWithoutThreshold = { ...validJob };
    delete jobWithoutThreshold.olderThanMinutes;
    
    const result = CleanupJobSchema.parse(jobWithoutThreshold);
    expect(result.olderThanMinutes).toBe(5); // default value
  });

  it('should reject negative olderThanMinutes', () => {
    expect(() => CleanupJobSchema.parse({
      ...validJob,
      olderThanMinutes: -1
    })).toThrow(ZodError);
  });

  it('should reject wrong job type', () => {
    expect(() => CleanupJobSchema.parse({
      ...validJob,
      type: 'create_session'
    })).toThrow(ZodError);
  });
});

describe('AgentJobSchema', () => {
  it('should discriminate between job types correctly', () => {
    const createJob: CreateSessionJob = {
      id: 'job_1',
      correlationId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'create_session',
      target: {
        host: 'localhost',
        port: 5432,
        database: 'testdb'
      },
      role: 'app_read',
      ttlMinutes: 30,
      requester: { userId: 'user123' }
    };

    const revokeJob: RevokeSessionJob = {
      id: 'job_2',
      correlationId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'revoke_session',
      sessionId: 'ses_123'
    };

    const cleanupJob: CleanupJob = {
      id: 'job_3',
      correlationId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'cleanup'
    };

    const expectedCreateJob = {
      ...createJob,
      target: {
        ...createJob.target,
        sslMode: 'prefer' // default value will be added
      }
    };
    
    const expectedCleanupJob = {
      ...cleanupJob,
      olderThanMinutes: 5 // default value will be added
    };
    
    expect(AgentJobSchema.parse(createJob)).toEqual(expectedCreateJob);
    expect(AgentJobSchema.parse(revokeJob)).toEqual(revokeJob);
    expect(AgentJobSchema.parse(cleanupJob)).toEqual(expectedCleanupJob);
  });
});

describe('CreateSessionResultSchema', () => {
  it('should validate successful result', () => {
    const result: CreateSessionResult = {
      sessionId: 'ses_123',
      status: 'ready',
      dsn: 'postgresql://user:pass@localhost:5432/db',
      expiresAt: '2024-01-01T12:00:00Z',
      username: 'gk_abc123'
    };

    expect(CreateSessionResultSchema.parse(result)).toEqual(result);
  });

  it('should validate failed result with error', () => {
    const result: CreateSessionResult = {
      sessionId: 'ses_123',
      status: 'failed',
      error: {
        code: 'DB_CONNECTION_FAILED',
        message: 'Could not connect to database',
        retryable: true
      }
    };

    expect(CreateSessionResultSchema.parse(result)).toEqual(result);
  });

  it('should reject invalid status', () => {
    expect(() => CreateSessionResultSchema.parse({
      sessionId: 'ses_123',
      status: 'invalid'
    })).toThrow(ZodError);
  });

  it('should reject invalid datetime format', () => {
    expect(() => CreateSessionResultSchema.parse({
      sessionId: 'ses_123',
      status: 'ready',
      expiresAt: 'invalid-date'
    })).toThrow(ZodError);
  });
});

describe('RevokeSessionResultSchema', () => {
  it('should validate successful revocation', () => {
    const result: RevokeSessionResult = {
      status: 'revoked'
    };

    expect(RevokeSessionResultSchema.parse(result)).toEqual(result);
  });

  it('should validate not found result', () => {
    const result: RevokeSessionResult = {
      status: 'not_found'
    };

    expect(RevokeSessionResultSchema.parse(result)).toEqual(result);
  });

  it('should validate failed result with error', () => {
    const result: RevokeSessionResult = {
      status: 'failed',
      error: {
        code: 'DB_ERROR',
        message: 'Database error',
        retryable: false
      }
    };

    expect(RevokeSessionResultSchema.parse(result)).toEqual(result);
  });
});

describe('CleanupResultSchema', () => {
  it('should validate successful cleanup', () => {
    const result: CleanupResult = {
      status: 'completed',
      cleanedCount: 5
    };

    expect(CleanupResultSchema.parse(result)).toEqual(result);
  });

  it('should validate failed cleanup', () => {
    const result: CleanupResult = {
      status: 'failed',
      cleanedCount: 0,
      error: {
        code: 'CLEANUP_ERROR',
        message: 'Failed to cleanup sessions'
      }
    };

    const expectedResult = {
      ...result,
      error: {
        ...result.error!,
        retryable: false // default value will be added
      }
    };
    expect(CleanupResultSchema.parse(result)).toEqual(expectedResult);
  });

  it('should reject negative cleaned count', () => {
    expect(() => CleanupResultSchema.parse({
      status: 'completed',
      cleanedCount: -1
    })).toThrow(ZodError);
  });
});