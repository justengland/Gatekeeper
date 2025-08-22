#!/usr/bin/env node
/**
 * Gatekeeper Agent HTTP Server
 * Local development server for testing and development
 */

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { GatekeeperAgent } from './core/agent.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: 'gatekeeper-agent-server',
  ...(process.env.NODE_ENV === 'development' ? {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  } : {})
});

// Initialize Agent
const agentConfig = {
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
      maxConnections: parseInt(process.env.PGMAXCONNECTIONS || '10'),
      idleTimeoutMillis: parseInt(process.env.PGIDLETIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.PGCONNECTIONTIMEOUT || '10000')
    }
  },
  sessionMaxTtlMinutes: parseInt(process.env.SESSION_MAX_TTL_MINUTES || '1440'),
  logger
};

const agent = new GatekeeperAgent(agentConfig);

// Initialize Express app
const app: express.Express = express();
const port = parseInt(process.env.AGENT_PORT || process.env.PORT || '4001');

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: process.env.CORS_CREDENTIALS === 'true'
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] as string || uuidv4();
  (req as any).correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  
  const requestLogger = logger.child({ 
    correlationId,
    method: req.method,
    path: req.path
  });
  
  (req as any).logger = requestLogger;
  requestLogger.info({ 
    userAgent: req.headers['user-agent'],
    ip: req.ip
  }, 'Incoming request');
  
  next();
});

// Routes

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    const health = await agent.healthCheck();
    const statusCode = health.status === 'ok' ? 200 : 503;
    
    res.status(statusCode).json({
      ...health,
      timestamp: new Date().toISOString(),
      correlationId: (req as any).correlationId
    });
  } catch (error) {
    (req as any).logger.error({ error }, 'Health check failed');
    res.status(500).json({
      status: 'down',
      error: 'Health check failed',
      correlationId: (req as any).correlationId
    });
  }
});

/**
 * Process agent job
 */
app.post('/jobs', async (req, res) => {
  try {
    const jobData = req.body;
    const result = await agent.processJob(jobData, (req as any).correlationId);
    
    (req as any).logger.info({ jobType: jobData?.type }, 'Job processed successfully');
    res.json(result);
    
  } catch (error) {
    (req as any).logger.error({ error }, 'Job processing failed');
    res.status(500).json({
      status: 'failed',
      error: {
        code: 'PROCESSING_ERROR',
        message: 'Failed to process job',
        retryable: true
      },
      correlationId: (req as any).correlationId
    });
  }
});

/**
 * Get agent information
 */
app.get('/', (req, res) => {
  res.json({
    service: 'Gatekeeper Agent',
    version: '0.1.0',
    mode: 'http-server',
    endpoints: {
      health: 'GET /health',
      processJob: 'POST /jobs'
    },
    config: {
      database: {
        host: agentConfig.database.connection.host,
        port: agentConfig.database.connection.port,
        database: agentConfig.database.connection.database,
        user: agentConfig.database.credentials.username
        // Don't expose password
      },
      rolePackVersion: agentConfig.database.rolePackVersion,
      sessionMaxTtlMinutes: agentConfig.sessionMaxTtlMinutes
    },
    correlationId: (req as any).correlationId
  });
});

// Start server if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer(app);

  server.listen(port, () => {
    logger.info({
      port,
      mode: 'http-server',
      database: {
        host: agentConfig.database.connection.host,
        port: agentConfig.database.connection.port,
        database: agentConfig.database.connection.database
      }
    }, 'Gatekeeper Agent HTTP server started');
  });

  // Graceful shutdown
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down gracefully...');
    
    server.close(async (err) => {
      if (err) {
        logger.error({ error: err }, 'Error closing HTTP server');
        process.exit(1);
      }
      
      try {
        await agent.shutdown();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during agent shutdown');
        process.exit(1);
      }
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Force exit after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app, agent };