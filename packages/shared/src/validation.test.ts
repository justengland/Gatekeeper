import { describe, it, expect } from 'vitest';
import {
  validateTTL,
  validateCorrelationId,
  validateSessionId,
  validateJobId,
  validateTargetId,
  validateEphemeralUsername,
  validateReason,
  validateBatch,
  validateCreateSessionRequest,
  validateCreateSessionRequestSafe,
  validateAgentJob
} from './validation.js';
import { ValidationError } from './errors.js';

describe('validateTTL', () => {
  it('should accept valid TTL values', () => {
    expect(validateTTL(1)).toBe(1);
    expect(validateTTL(30)).toBe(30);
    expect(validateTTL(1440)).toBe(1440);
  });

  it('should reject TTL values that are too low', () => {
    expect(() => validateTTL(0)).toThrow(ValidationError);
    expect(() => validateTTL(-1)).toThrow(ValidationError);
  });

  it('should reject TTL values that are too high', () => {
    expect(() => validateTTL(1441)).toThrow(ValidationError);
    expect(() => validateTTL(2000)).toThrow(ValidationError);
  });

  it('should reject non-integer TTL values', () => {
    expect(() => validateTTL(30.5)).toThrow(ValidationError);
    expect(() => validateTTL(1.1)).toThrow(ValidationError);
  });

  it('should respect custom max TTL', () => {
    expect(validateTTL(60, 120)).toBe(60);
    expect(() => validateTTL(121, 120)).toThrow(ValidationError);
  });
});

describe('validateCorrelationId', () => {
  it('should accept valid UUID v4', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(validateCorrelationId(validUuid)).toBe(validUuid);
  });

  it('should reject invalid UUID formats', () => {
    expect(() => validateCorrelationId('not-a-uuid')).toThrow(ValidationError);
    expect(() => validateCorrelationId('123e4567-e89b-12d3-a456')).toThrow(ValidationError);
    expect(() => validateCorrelationId('')).toThrow(ValidationError);
  });
});

describe('validateSessionId', () => {
  it('should accept valid session IDs', () => {
    expect(validateSessionId('ses_abc123')).toBe('ses_abc123');
    expect(validateSessionId('ses_01HVJ3C5Z6W6WZ')).toBe('ses_01HVJ3C5Z6W6WZ');
  });

  it('should reject invalid session ID formats', () => {
    expect(() => validateSessionId('invalid_format')).toThrow(ValidationError);
    expect(() => validateSessionId('ses_')).toThrow(ValidationError);
    expect(() => validateSessionId('ses_with_special_chars!')).toThrow(ValidationError);
    expect(() => validateSessionId('')).toThrow(ValidationError);
  });

  it('should reject session IDs that are too long', () => {
    const tooLong = 'ses_' + 'a'.repeat(70);
    expect(() => validateSessionId(tooLong)).toThrow(ValidationError);
  });
});

describe('validateJobId', () => {
  it('should accept valid job IDs', () => {
    expect(validateJobId('job_123')).toBe('job_123');
    expect(validateJobId('unique-key-456')).toBe('unique-key-456');
  });

  it('should reject empty job IDs', () => {
    expect(() => validateJobId('')).toThrow(ValidationError);
  });

  it('should reject job IDs that are too long', () => {
    const tooLong = 'a'.repeat(129);
    expect(() => validateJobId(tooLong)).toThrow(ValidationError);
  });
});

describe('validateTargetId', () => {
  it('should accept valid target IDs', () => {
    expect(validateTargetId('pg-local')).toBe('pg-local');
    expect(validateTargetId('mysql_staging')).toBe('mysql_staging');
    expect(validateTargetId('db123')).toBe('db123');
  });

  it('should reject target IDs with invalid characters', () => {
    expect(() => validateTargetId('pg.local')).toThrow(ValidationError);
    expect(() => validateTargetId('db@staging')).toThrow(ValidationError);
    expect(() => validateTargetId('mysql staging')).toThrow(ValidationError);
  });

  it('should reject empty or too long target IDs', () => {
    expect(() => validateTargetId('')).toThrow(ValidationError);
    expect(() => validateTargetId('a'.repeat(65))).toThrow(ValidationError);
  });
});

describe('validateEphemeralUsername', () => {
  it('should accept valid ephemeral usernames', () => {
    expect(validateEphemeralUsername('gk_abc123')).toBe('gk_abc123');
    expect(validateEphemeralUsername('gk_01HVJ3C5Z6W6WZ')).toBe('gk_01HVJ3C5Z6W6WZ');
  });

  it('should reject usernames not starting with gk_', () => {
    expect(() => validateEphemeralUsername('user_abc123')).toThrow(ValidationError);
    expect(() => validateEphemeralUsername('abc123')).toThrow(ValidationError);
  });

  it('should reject usernames with invalid characters', () => {
    expect(() => validateEphemeralUsername('gk_abc-123')).toThrow(ValidationError);
    expect(() => validateEphemeralUsername('gk_abc.123')).toThrow(ValidationError);
  });

  it('should reject usernames that are too short or too long', () => {
    expect(() => validateEphemeralUsername('gk_')).toThrow(ValidationError);
    expect(() => validateEphemeralUsername('gk_' + 'a'.repeat(70))).toThrow(ValidationError);
  });
});

describe('validateReason', () => {
  it('should accept undefined reason', () => {
    expect(validateReason(undefined)).toBeUndefined();
  });

  it('should accept valid reason', () => {
    expect(validateReason('Testing')).toBe('Testing');
    expect(validateReason('Debugging issue #123')).toBe('Debugging issue #123');
  });

  it('should return undefined for empty reason', () => {
    expect(validateReason('')).toBeUndefined();
    expect(validateReason('   ')).toBeUndefined(); // whitespace only
  });

  it('should reject reason that is too long', () => {
    const tooLong = 'a'.repeat(257);
    expect(() => validateReason(tooLong)).toThrow(ValidationError);
  });
});

describe('validateCreateSessionRequest', () => {
  it('should validate a complete request', () => {
    const request = {
      targetId: 'pg-local',
      role: 'app_read',
      ttlMinutes: 30,
      reason: 'Testing',
      requester: {
        userId: 'user123',
        email: 'user@example.com'
      }
    };

    expect(() => validateCreateSessionRequest(request)).not.toThrow();
  });

  it('should throw ValidationError for invalid request', () => {
    const request = {
      targetId: '',
      role: 'invalid_role',
      ttlMinutes: 0
    };

    expect(() => validateCreateSessionRequest(request)).toThrow(ValidationError);
  });
});

describe('validateCreateSessionRequestSafe', () => {
  it('should return success for valid request', () => {
    const request = {
      targetId: 'pg-local',
      role: 'app_read',
      ttlMinutes: 30
    };

    const result = validateCreateSessionRequestSafe(request);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(request);
    expect(result.error).toBeUndefined();
  });

  it('should return error for invalid request', () => {
    const request = {
      targetId: '',
      role: 'invalid_role',
      ttlMinutes: 0
    };

    const result = validateCreateSessionRequestSafe(request);
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeInstanceOf(ValidationError);
  });
});

describe('validateAgentJob', () => {
  it('should validate create session job', () => {
    const job = {
      id: 'job_123',
      correlationId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'create_session',
      target: {
        host: 'localhost',
        port: 5432,
        database: 'testdb'
      },
      role: 'app_read',
      ttlMinutes: 30,
      requester: {
        userId: 'user123'
      }
    };

    expect(() => validateAgentJob(job)).not.toThrow();
  });

  it('should validate revoke session job', () => {
    const job = {
      id: 'job_456',
      correlationId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'revoke_session',
      sessionId: 'ses_123'
    };

    expect(() => validateAgentJob(job)).not.toThrow();
  });
});

describe('validateBatch', () => {
  it('should return success when all validations pass', () => {
    const validations = [
      { name: 'ttl', validate: () => validateTTL(30) },
      { name: 'sessionId', validate: () => validateSessionId('ses_abc123') },
      { name: 'targetId', validate: () => validateTargetId('pg-local') }
    ];

    const result = validateBatch(validations);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.results).toEqual({
      ttl: 30,
      sessionId: 'ses_abc123',
      targetId: 'pg-local'
    });
  });

  it('should collect all validation errors', () => {
    const validations = [
      { name: 'ttl', validate: () => validateTTL(0) }, // Will fail
      { name: 'sessionId', validate: () => validateSessionId('invalid') }, // Will fail
      { name: 'targetId', validate: () => validateTargetId('pg-local') } // Will succeed
    ];

    const result = validateBatch(validations);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.results).toBeUndefined();
  });

  it('should handle non-validation errors', () => {
    const validations = [
      { name: 'error', validate: () => { throw new Error('Generic error'); } }
    ];

    const result = validateBatch(validations);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(ValidationError);
  });
});