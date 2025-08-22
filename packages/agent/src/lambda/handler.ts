/**
 * AWS Lambda Handler for Gatekeeper Agent
 * Supports both API Gateway and direct Lambda invocation
 */

import pino from 'pino';
import { GatekeeperAgent } from '../core/agent.js';

// Lambda event types
interface LambdaEvent {
  httpMethod?: string;
  path?: string;
  body?: string;
  headers?: Record<string, string>;
  requestContext?: {
    requestId: string;
  };
  // Direct invocation
  jobData?: any;
  correlationId?: string;
}

interface LambdaContext {
  requestId: string;
  functionName: string;
  functionVersion: string;
  logGroupName: string;
  logStreamName: string;
  remainingTimeInMillis: () => number;
}

interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

// Global agent instance (reused across invocations for performance)
let agentInstance: GatekeeperAgent | null = null;

/**
 * Initialize agent instance (cold start)
 */
function initializeAgent(): GatekeeperAgent {
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    name: 'gatekeeper-agent-lambda',
    ...(process.env.NODE_ENV === 'development' ? {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true }
      }
    } : {})
  });

  const config = {
    database: {
      type: 'postgres' as const,
      connection: {
        type: 'postgres' as const,
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        database: process.env.PGDATABASE || 'app',
        sslMode: process.env.PGSSLMODE === 'require' ? 'require' as const : 
                 process.env.PGSSLMODE === 'disable' ? 'disable' as const :
                 'prefer' as const,
        options: {}
      },
      credentials: {
        username: process.env.PGUSER || 'gatekeeper_admin',
        password: process.env.PGPASSWORD || 'gatekeeper_admin_password_change_in_production'
      },
      rolePackVersion: process.env.ROLEPACK_VERSION || 'pg-1.0.0',
      settings: {
        maxConnections: parseInt(process.env.PGMAXCONNECTIONS || '5'),
        idleTimeoutMillis: parseInt(process.env.PGIDLETIMEOUT || '30000'),
        connectionTimeoutMillis: parseInt(process.env.PGCONNECTIONTIMEOUT || '10000')
      }
    },
    sessionMaxTtlMinutes: parseInt(process.env.SESSION_MAX_TTL_MINUTES || '1440'),
    logger
  };

  return new GatekeeperAgent(config);
}

/**
 * Get or create agent instance
 */
function getAgent(): GatekeeperAgent {
  if (!agentInstance) {
    agentInstance = initializeAgent();
  }
  return agentInstance;
}

/**
 * Main Lambda handler
 */
export async function handler(event: LambdaEvent, context: LambdaContext): Promise<LambdaResponse | any> {
  const agent = getAgent();
  const correlationId = event.correlationId || event.requestContext?.requestId || context.requestId;
  
  const logger = pino().child({ 
    correlationId,
    functionName: context.functionName,
    remainingTime: context.remainingTimeInMillis()
  });

  try {
    // Handle HTTP requests (API Gateway)
    if (event.httpMethod) {
      return await handleHttpRequest(event, agent, logger, correlationId);
    }
    
    // Handle direct invocation
    if (event.jobData) {
      const result = await agent.processJob(event.jobData, correlationId);
      return result;
    }
    
    // Fallback - try to parse body as job data
    let jobData;
    if (event.body) {
      try {
        jobData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      } catch (error) {
        logger.error({ error, body: event.body }, 'Failed to parse job data from body');
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Invalid JSON in request body'
          })
        };
      }
    } else {
      // Default job for testing
      jobData = event;
    }

    const result = await agent.processJob(jobData, correlationId);
    
    // For direct invocation, return result directly
    return result;

  } catch (error) {
    logger.error({ error }, 'Lambda handler error');
    
    if (event.httpMethod) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Internal server error',
          correlationId
        })
      };
    }
    
    return {
      status: 'failed',
      error: {
        code: 'LAMBDA_ERROR',
        message: 'Lambda execution failed',
        retryable: false
      }
    };
  }
}

/**
 * Handle HTTP requests from API Gateway
 */
async function handleHttpRequest(
  event: LambdaEvent, 
  agent: GatekeeperAgent, 
  logger: any, 
  correlationId: string
): Promise<LambdaResponse> {
  const method = event.httpMethod!;
  const path = event.path || '/';

  logger.info({ method, path }, 'Processing HTTP request');

  try {
    // Health check endpoint
    if (method === 'GET' && path === '/health') {
      const health = await agent.healthCheck();
      return {
        statusCode: health.status === 'ok' ? 200 : 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(health)
      };
    }

    // Process job endpoint
    if (method === 'POST' && path === '/jobs') {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Request body required' })
        };
      }

      const jobData = JSON.parse(event.body);
      const result = await agent.processJob(jobData, correlationId);
      
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId
        },
        body: JSON.stringify(result)
      };
    }

    // Method/path not found
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Not found',
        availableEndpoints: [
          'GET /health',
          'POST /jobs'
        ]
      })
    };

  } catch (error) {
    logger.error({ error, method, path }, 'HTTP request failed');
    
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        correlationId
      })
    };
  }
}

// Graceful shutdown handler
export async function shutdownHandler(): Promise<void> {
  if (agentInstance) {
    await agentInstance.shutdown();
    agentInstance = null;
  }
}