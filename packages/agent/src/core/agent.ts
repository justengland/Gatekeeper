/**
 * Gatekeeper Agent Core
 * Handles ephemeral database session management using provider abstraction
 * Supports multiple database types through the DatabaseProvider interface
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { Logger } from 'pino';
import {
  type CreateSessionJob,
  type RevokeSessionJob,
  type CleanupJob,
  type CreateSessionResult,
  type RevokeSessionResult,
  type CleanupResult,
  ValidationError,
  DatabaseError,
  validateAgentJob,
  DatabaseProvider,
  DatabaseProviderConfig
} from '@gatekeeper/shared';
import { registerDatabaseProviders, createDatabaseProvider } from '../providers/provider-factory.js';

export interface AgentConfig {
  database: DatabaseProviderConfig;
  sessionMaxTtlMinutes: number;
  logger: Logger;
  // Optional provider instance (for testing or custom providers)
  provider?: DatabaseProvider;
}

export class GatekeeperAgent {
  private provider: DatabaseProvider;
  private config: AgentConfig;
  private logger: Logger;
  private initialized = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.logger = config.logger.child({ component: 'agent' });
    
    // Register all providers on first instantiation
    registerDatabaseProviders(this.logger);
    
    // Use provided provider or create based on database type
    if (config.provider) {
      this.provider = config.provider;
    } else {
      this.provider = createDatabaseProvider(config.database.type, this.logger);
    }

    this.logger.info({ databaseType: config.database.type }, 'Gatekeeper Agent initialized');
  }

  /**
   * Initialize the agent and its database provider
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.provider.initialize(this.config.database.connection, this.config.database.credentials);
      this.initialized = true;
      this.logger.info('Agent provider initialized successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize agent provider');
      throw error;
    }
  }

  /**
   * Process any agent job (main entry point)
   */
  async processJob(jobData: unknown, correlationId?: string): Promise<CreateSessionResult | RevokeSessionResult | CleanupResult> {
    // Ensure provider is initialized
    if (!this.initialized) {
      await this.initialize();
    }

    const requestId = correlationId || uuidv4();
    const jobLogger = this.logger.child({ correlationId: requestId });
    
    try {
      // Validate job structure
      const job = validateAgentJob(jobData);
      jobLogger.info({ jobType: job.type, jobId: job.id }, 'Processing agent job');

      // Route to appropriate handler
      switch (job.type) {
        case 'create_session':
          // Type assertion safe since validation applies defaults
          return await this.createSession(job as CreateSessionJob & { target: { sslMode: NonNullable<CreateSessionJob['target']['sslMode']> } }, jobLogger);
        case 'revoke_session':
          return await this.revokeSession(job, jobLogger);
        case 'cleanup':
          // Type assertion safe since validation applies defaults
          return await this.cleanup(job as CleanupJob & { olderThanMinutes: NonNullable<CleanupJob['olderThanMinutes']> }, jobLogger);
        default:
          throw new ValidationError(`Unknown job type: ${(job as any).type}`);
      }
    } catch (error: unknown) {
      jobLogger.error({ error }, 'Job processing failed');
      
      if (error instanceof ValidationError) {
        return {
          status: 'failed' as const,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message,
            retryable: false
          }
        } as any;
      }
      
      return {
        status: 'failed' as const,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          retryable: true
        }
      } as any;
    }
  }

  /**
   * Create ephemeral database session using provider
   */
  private async createSession(job: CreateSessionJob, logger: Logger): Promise<CreateSessionResult> {
    const { id: jobId, target, role, ttlMinutes, requester, reason } = job;
    
    // Validate TTL
    if (ttlMinutes > this.config.sessionMaxTtlMinutes) {
      throw new ValidationError(`TTL ${ttlMinutes} exceeds maximum allowed ${this.config.sessionMaxTtlMinutes} minutes`);
    }
    
    try {
      // Generate session credentials
      const sessionId = `ses_${this.generateId()}`;
      const username = `gk_${this.generateId()}`;
      const password = this.generatePassword();

      logger.info({ 
        sessionId, 
        username, 
        role, 
        ttlMinutes,
        target: { host: target.host, port: target.port, database: target.database },
        requester: requester.userId
      }, 'Creating ephemeral session via provider');

      // Create user via provider
      const result = await this.provider.createEphemeralUser({
        username,
        password,
        role,
        ttlMinutes,
        connectionLimit: 2,
        providerOptions: {}
      });

      // Log audit event (provider-agnostic)
      await this.auditEvent({
        eventType: 'session.created',
        sessionId,
        username,
        correlationId: job.correlationId,
        eventData: {
          jobId,
          role,
          ttlMinutes,
          requester,
          reason,
          target: {
            host: target.host,
            port: target.port,
            database: target.database
          },
          provider: {
            type: this.provider.type,
            version: this.provider.version
          }
        }
      });
        
      logger.info({ 
        sessionId, 
        username,
        expiresAt: result.expiresAt
      }, 'Session created successfully via provider');

      return {
        sessionId,
        status: 'ready',
        dsn: result.dsn,
        expiresAt: result.expiresAt,
        username
      };

    } catch (error) {
      logger.error({ error, jobId }, 'Failed to create session via provider');
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to create ephemeral session', true);
    }
  }

  /**
   * Revoke existing session using provider
   */
  private async revokeSession(job: RevokeSessionJob, logger: Logger): Promise<RevokeSessionResult> {
    const { sessionId } = job;
    
    try {
      logger.info({ sessionId }, 'Revoking session via provider');

      // For now, we need to find the username from audit log
      // TODO: Implement session tracking in provider interface
      const username = await this.findUsernameForSession(sessionId);

      if (!username) {
        logger.warn({ sessionId }, 'Session not found for revocation');
        return { status: 'not_found' };
      }

      // Drop the user via provider
      const success = await this.provider.dropUser(username);
      
      if (success) {
        // Log audit event
        await this.auditEvent({
          eventType: 'session.revoked',
          sessionId,
          username,
          correlationId: job.correlationId,
          eventData: {
            jobId: job.id,
            revokedBy: 'agent',
            provider: {
              type: this.provider.type,
              version: this.provider.version
            }
          }
        });

        logger.info({ sessionId, username }, 'Session revoked successfully via provider');
        return { status: 'revoked' };
      } else {
        logger.warn({ sessionId, username }, 'User was already removed or not found');
        return { status: 'not_found' };
      }

    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to revoke session via provider');
      
      return {
        status: 'failed',
        error: {
          code: 'REVOCATION_ERROR',
          message: 'Failed to revoke session',
          retryable: true
        }
      };
    }
  }

  /**
   * Cleanup expired sessions using provider
   */
  private async cleanup(job: CleanupJob, logger: Logger): Promise<CleanupResult> {
    const { olderThanMinutes } = job;
    
    try {
      logger.info({ olderThanMinutes }, 'Starting cleanup of expired sessions via provider');

      // Use provider cleanup
      const cleanupResults = await this.provider.cleanupExpiredUsers(olderThanMinutes);
      const successfulCleanups = cleanupResults.filter(result => result.dropped);
      
      if (successfulCleanups.length > 0) {
        // Log audit event for cleanup
        await this.auditEvent({
          eventType: 'sessions.cleaned',
          correlationId: job.correlationId,
          eventData: {
            jobId: job.id,
            olderThanMinutes,
            cleanedCount: successfulCleanups.length,
            cleanedUsers: successfulCleanups.map(result => result.username),
            provider: {
              type: this.provider.type,
              version: this.provider.version
            }
          }
        });
      }

      logger.info({ 
        cleanedCount: successfulCleanups.length,
        totalProcessed: cleanupResults.length 
      }, 'Cleanup completed via provider');

      return {
        status: 'completed',
        cleanedCount: successfulCleanups.length
      };

    } catch (error) {
      logger.error({ error }, 'Cleanup failed via provider');
      
      return {
        status: 'failed',
        cleanedCount: 0,
        error: {
          code: 'CLEANUP_ERROR',
          message: 'Failed to cleanup expired sessions',
          retryable: true
        }
      };
    }
  }

  /**
   * Health check using provider
   */
  async healthCheck(): Promise<{ status: 'ok' | 'degraded' | 'down', details: any }> {
    try {
      // Ensure provider is initialized
      if (!this.initialized) {
        await this.initialize();
      }

      const healthResult = await this.provider.healthCheck();
      
      return {
        status: healthResult.status === 'healthy' ? 'ok' : 
               healthResult.status === 'degraded' ? 'degraded' : 'down',
        details: {
          provider: {
            type: this.provider.type,
            version: this.provider.version
          },
          ...healthResult.details
        }
      };
      
    } catch (error) {
      this.logger.error({ error }, 'Health check failed');
      
      return {
        status: 'down',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down agent...');
    if (this.initialized) {
      await this.provider.close();
    }
    this.initialized = false;
    this.logger.info('Agent shutdown complete');
  }

  // Private helper methods

  private generateId(): string {
    return crypto.randomBytes(6).toString('hex'); // 12 character hex string
  }

  private generatePassword(): string {
    return crypto.randomBytes(16).toString('base64') + crypto.randomBytes(4).toString('hex');
  }

  /**
   * Find username for a session ID from audit log
   * TODO: This is a temporary solution - consider adding session tracking to provider interface
   */
  private async findUsernameForSession(sessionId: string): Promise<string | null> {
    try {
      // This requires database access - for now, we'll need to implement this differently
      // or add session tracking to the provider interface
      this.logger.warn({ sessionId }, 'Session username lookup not implemented for provider pattern');
      return null;
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Failed to find username for session');
      return null;
    }
  }

  private async auditEvent(event: {
    eventType: string;
    sessionId?: string;
    username?: string;
    correlationId?: string;
    eventData: any;
  }): Promise<void> {
    try {
      const eventHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ type: event.eventType, data: event.eventData }))
        .digest('hex');

      // TODO: Implement audit logging through provider interface
      // For now, audit events are logged but not persisted to database
      this.logger.info({
        audit: {
          eventType: event.eventType,
          sessionId: event.sessionId,
          username: event.username,
          correlationId: event.correlationId,
          eventHash
        }
      }, 'Audit event (provider pattern - not yet persisted to database)');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to log audit event');
      // Don't fail the main operation if audit logging fails
    }
  }
}