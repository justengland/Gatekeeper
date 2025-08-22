import { describe, it, expect } from 'vitest';
import { ZodError, z } from 'zod';
import {
  GatekeeperError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  DatabaseError,
  AgentError,
  NotFoundError,
  RateLimitError,
  ERROR_CODES,
  toErrorResponse,
  isRetryableError,
  getCorrelationId
} from './errors.js';

describe('GatekeeperError', () => {
  it('should create error with basic properties', () => {
    const error = new GatekeeperError('Test message', 'TEST_CODE');
    
    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.retryable).toBe(false);
    expect(error.correlationId).toBeUndefined();
    expect(error.name).toBe('GatekeeperError');
  });

  it('should create error with all properties', () => {
    const correlationId = '123e4567-e89b-12d3-a456-426614174000';
    const error = new GatekeeperError('Test message', 'TEST_CODE', true, correlationId);
    
    expect(error.retryable).toBe(true);
    expect(error.correlationId).toBe(correlationId);
  });

  it('should serialize to JSON correctly', () => {
    const correlationId = '123e4567-e89b-12d3-a456-426614174000';
    const error = new GatekeeperError('Test message', 'TEST_CODE', true, correlationId);
    
    const json = error.toJSON();
    expect(json).toEqual({
      name: 'GatekeeperError',
      message: 'Test message',
      code: 'TEST_CODE',
      retryable: true,
      correlationId,
      stack: error.stack
    });
  });
});

describe('ValidationError', () => {
  it('should create validation error with field', () => {
    const error = new ValidationError('Invalid input', 'username');
    
    expect(error.message).toBe('Invalid input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.retryable).toBe(false);
    expect(error.field).toBe('username');
    expect(error.name).toBe('ValidationError');
  });

  it('should create validation error without field', () => {
    const error = new ValidationError('Invalid input');
    
    expect(error.field).toBeUndefined();
  });
});

describe('AuthenticationError', () => {
  it('should create authentication error with default message', () => {
    const error = new AuthenticationError();
    
    expect(error.message).toBe('Authentication required');
    expect(error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.retryable).toBe(false);
  });

  it('should create authentication error with custom message', () => {
    const error = new AuthenticationError('Invalid API key');
    
    expect(error.message).toBe('Invalid API key');
  });
});

describe('AuthorizationError', () => {
  it('should create authorization error with default message', () => {
    const error = new AuthorizationError();
    
    expect(error.message).toBe('Insufficient permissions');
    expect(error.code).toBe('AUTHORIZATION_ERROR');
    expect(error.retryable).toBe(false);
  });
});

describe('DatabaseError', () => {
  it('should create database error as retryable by default', () => {
    const error = new DatabaseError('Connection failed');
    
    expect(error.message).toBe('Connection failed');
    expect(error.code).toBe('DATABASE_ERROR');
    expect(error.retryable).toBe(true);
  });

  it('should create non-retryable database error when specified', () => {
    const error = new DatabaseError('Permission denied', false);
    
    expect(error.retryable).toBe(false);
  });
});

describe('AgentError', () => {
  it('should create agent error as retryable by default', () => {
    const error = new AgentError('Agent unavailable');
    
    expect(error.message).toBe('Agent unavailable');
    expect(error.code).toBe('AGENT_ERROR');
    expect(error.retryable).toBe(true);
  });
});

describe('NotFoundError', () => {
  it('should create not found error with resource and id', () => {
    const error = new NotFoundError('Session', 'ses_123');
    
    expect(error.message).toBe('Session not found: ses_123');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.retryable).toBe(false);
  });
});

describe('RateLimitError', () => {
  it('should create rate limit error with default message', () => {
    const error = new RateLimitError();
    
    expect(error.message).toBe('Rate limit exceeded');
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(error.retryable).toBe(true);
    expect(error.retryAfter).toBeUndefined();
  });

  it('should create rate limit error with retry after', () => {
    const error = new RateLimitError('Too many requests', 60);
    
    expect(error.retryAfter).toBe(60);
  });
});

describe('ERROR_CODES', () => {
  it('should contain all expected error codes', () => {
    expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ERROR_CODES.AUTHENTICATION_ERROR).toBe('AUTHENTICATION_ERROR');
    expect(ERROR_CODES.AUTHORIZATION_ERROR).toBe('AUTHORIZATION_ERROR');
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(ERROR_CODES.DATABASE_ERROR).toBe('DATABASE_ERROR');
    expect(ERROR_CODES.AGENT_ERROR).toBe('AGENT_ERROR');
    expect(ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});

describe('toErrorResponse', () => {
  it('should convert GatekeeperError to ErrorResponse', () => {
    const correlationId = '123e4567-e89b-12d3-a456-426614174000';
    const error = new GatekeeperError('Test error', 'TEST_CODE', true, correlationId);
    
    const response = toErrorResponse(error);
    expect(response).toEqual({
      code: 'TEST_CODE',
      message: 'Test error',
      correlationId,
      retryable: true
    });
  });

  it('should convert ValidationError with field to ErrorResponse', () => {
    const error = new ValidationError('Invalid field', 'username');
    
    const response = toErrorResponse(error);
    expect(response).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid field',
      field: 'username'
    });
  });

  it('should convert RateLimitError with retryAfter to ErrorResponse', () => {
    const error = new RateLimitError('Rate limit exceeded', 60);
    
    const response = toErrorResponse(error);
    expect(response).toEqual({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded',
      retryable: true,
      retryAfter: 60
    });
  });

  it('should convert ZodError to ErrorResponse', () => {
    const schema = z.object({ name: z.string().min(1) });
    let zodError: ZodError;
    
    try {
      schema.parse({ name: '' });
    } catch (error) {
      zodError = error as ZodError;
    }
    
    const response = toErrorResponse(zodError!, 'corr_123');
    expect(response.code).toBe('VALIDATION_ERROR');
    expect(response.correlationId).toBe('corr_123');
    expect(response.field).toBe('name');
  });

  it('should convert generic Error to ErrorResponse', () => {
    const error = new Error('Generic error');
    
    const response = toErrorResponse(error);
    expect(response).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Generic error'
    });
  });

  it('should convert unknown error to ErrorResponse', () => {
    const response = toErrorResponse('Unknown error');
    expect(response).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    });
  });

  it('should use provided correlation ID when error does not have one', () => {
    const error = new Error('Test error');
    const correlationId = '123e4567-e89b-12d3-a456-426614174000';
    
    const response = toErrorResponse(error, correlationId);
    expect(response.correlationId).toBe(correlationId);
  });
});

describe('isRetryableError', () => {
  it('should return true for retryable GatekeeperError', () => {
    const error = new DatabaseError('Connection failed');
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return false for non-retryable GatekeeperError', () => {
    const error = new ValidationError('Invalid input');
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return false for non-GatekeeperError', () => {
    const error = new Error('Generic error');
    expect(isRetryableError(error)).toBe(false);
  });
});

describe('getCorrelationId', () => {
  it('should return correlation ID from GatekeeperError', () => {
    const correlationId = '123e4567-e89b-12d3-a456-426614174000';
    const error = new GatekeeperError('Test', 'TEST', false, correlationId);
    
    expect(getCorrelationId(error)).toBe(correlationId);
  });

  it('should return undefined for error without correlation ID', () => {
    const error = new GatekeeperError('Test', 'TEST');
    
    expect(getCorrelationId(error)).toBeUndefined();
  });

  it('should return undefined for non-GatekeeperError', () => {
    const error = new Error('Generic error');
    
    expect(getCorrelationId(error)).toBeUndefined();
  });
});