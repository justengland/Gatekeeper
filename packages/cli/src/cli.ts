#!/usr/bin/env node
/**
 * Gatekeeper CLI - Command line interface for testing and managing ephemeral database sessions
 * 
 * Usage:
 *   gk session create --target pg-local --role app_read --ttl 30m --reason "testing"
 *   gk session list
 *   gk agent health
 *   gk agent test
 *   gk interactive
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { table } from 'table';
import dotenv from 'dotenv';
import axios from 'axios';
import { Client } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  type CreateSessionJob,
  type RevokeSessionJob,
  type CleanupJob
} from '@gatekeeper/shared';

// Load environment variables
dotenv.config();

const program = new Command();

// CLI Configuration
interface CLIConfig {
  agent: {
    mode: 'http' | 'lambda';
    httpUrl: string;
    lambdaEndpoint: string;
    lambdaFunctionName: string;
  };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  targets: Record<string, {
    host: string;
    port: number;
    database: string;
    sslMode: 'disable' | 'prefer' | 'require';
  }>;
}

const config: CLIConfig = {
  agent: {
    mode: (process.env.AGENT_MODE as 'http' | 'lambda') || 'http',
    httpUrl: process.env.AGENT_HTTP_URL || 'http://localhost:4001',
    lambdaEndpoint: process.env.LAMBDA_ENDPOINT || 'http://localhost:4566',
    lambdaFunctionName: process.env.LAMBDA_FUNCTION_NAME || 'gatekeeper-agent'
  },
  database: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'app',
    user: process.env.PGUSER || 'gatekeeper_admin',
    password: process.env.PGPASSWORD || 'gatekeeper_admin_password_change_in_production'
  },
  targets: {
    'pg-local': {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'app',
      sslMode: 'prefer'
    }
  }
};

// Utility functions
function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
  };
  console.log(colors[type](message));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function parseTTL(ttlString: string): number {
  const match = ttlString.match(/^(\d+)([mh]?)$/);
  if (!match) {
    throw new Error('Invalid TTL format. Use formats like: 30, 30m, 2h, 90m');
  }
  
  const value = parseInt(match[1]!);
  const unit = match[2] || 'm';
  
  return unit === 'h' ? value * 60 : value;
}

// Agent communication functions
async function sendJobToAgent(job: CreateSessionJob | RevokeSessionJob | CleanupJob): Promise<any> {
  const correlationId = uuidv4();
  
  if (config.agent.mode === 'http') {
    try {
      const response = await axios.post(`${config.agent.httpUrl}/jobs`, job, {
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId
        },
        timeout: 30000
      });
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(`Agent HTTP error: ${error.response.status} - ${error.response.data?.error || error.message}`);
      }
      throw new Error(`Agent connection failed: ${error.message}`);
    }
  } else {
    throw new Error('Lambda mode requires aws-sdk - not implemented in this demo');
  }
}

async function checkAgentHealth(): Promise<any> {
  if (config.agent.mode === 'http') {
    try {
      const response = await axios.get(`${config.agent.httpUrl}/health`, {
        timeout: 10000
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Agent health check failed: ${error.message}`);
    }
  } else {
    throw new Error('Lambda mode health check not implemented');
  }
}

// Database connection for direct queries
async function connectToDatabase(): Promise<Client> {
  const client = new Client(config.database);
  await client.connect();
  return client;
}

// Session commands
const sessionCommand = program
  .command('session')
  .description('Manage ephemeral database sessions');

sessionCommand
  .command('create')
  .description('Create a new ephemeral database session')
  .requiredOption('-t, --target <target>', 'Target database (e.g., pg-local)')
  .requiredOption('-r, --role <role>', 'Database role (e.g., app_read)')
  .requiredOption('--ttl <duration>', 'Session TTL (e.g., 30m, 2h)')
  .option('--reason <reason>', 'Reason for creating the session')
  .option('--user-id <userId>', 'Requesting user ID', 'cli-user')
  .option('--email <email>', 'Requesting user email')
  .action(async (options) => {
    const spinner = ora('Creating ephemeral session...').start();
    
    try {
      // Parse and validate inputs
      const ttlMinutes = parseTTL(options.ttl);
      const target = config.targets[options.target];
      
      if (!target) {
        throw new Error(`Unknown target: ${options.target}. Available targets: ${Object.keys(config.targets).join(', ')}`);
      }
      
      // Create job
      const job: CreateSessionJob = {
        id: uuidv4(),
        correlationId: uuidv4(),
        type: 'create_session',
        target: {
          host: target.host,
          port: target.port,
          database: target.database,
          sslMode: target.sslMode
        },
        role: options.role as any,
        ttlMinutes,
        requester: {
          userId: options.userId,
          email: options.email
        },
        reason: options.reason
      };
      
      // Send to agent
      const result = await sendJobToAgent(job);
      
      spinner.stop();
      
      if (result.status === 'ready') {
        log('✅ Session created successfully!', 'success');
        console.log();
        
        const sessionTable = [
          ['Property', 'Value'],
          ['Session ID', result.sessionId],
          ['Username', result.username],
          ['Role', options.role],
          ['TTL', formatDuration(ttlMinutes)],
          ['Expires At', new Date(result.expiresAt).toLocaleString()],
          ['Target', options.target],
          ['DSN', result.dsn ? chalk.gray('[Available - Connect using psql]') : 'N/A']
        ];
        
        console.log(table(sessionTable));
        
        if (result.dsn) {
          console.log();
          log(`💡 Connect with: ${chalk.bold('psql "' + result.dsn + '"')}`, 'info');
        }
        
      } else {
        log(`❌ Session creation failed: ${result.error?.message}`, 'error');
      }
      
    } catch (error: any) {
      spinner.stop();
      log(`❌ Error: ${error.message}`, 'error');
      process.exit(1);
    }
  });

sessionCommand
  .command('list')
  .description('List all ephemeral sessions')
  .option('--include-expired', 'Include expired sessions')
  .action(async (options) => {
    const spinner = ora('Fetching sessions...').start();
    
    try {
      const client = await connectToDatabase();
      
      try {
        const query = options.includeExpired ? 
          'SELECT * FROM gk_list_ephemeral_users() ORDER BY valid_until DESC' :
          'SELECT * FROM gk_list_ephemeral_users() WHERE NOT is_expired ORDER BY valid_until DESC';
          
        const result = await client.query(query);
        
        spinner.stop();
        
        if (result.rows.length === 0) {
          log('No sessions found', 'info');
          return;
        }
        
        const sessionsTable = [
          ['Username', 'Valid Until', 'Status', 'Connection Limit', 'Active Connections']
        ];
        
        result.rows.forEach(row => {
          const status = row.is_expired ? 
            chalk.red('Expired') : 
            chalk.green('Active');
          
          const validUntil = row.valid_until ? 
            new Date(row.valid_until).toLocaleString() : 
            'No expiry';
            
          sessionsTable.push([
            row.username,
            validUntil,
            status,
            row.connection_limit?.toString() || 'N/A',
            row.active_connections?.toString() || '0'
          ]);
        });
        
        console.log(table(sessionsTable));
        log(`\nFound ${result.rows.length} session(s)`, 'info');
        
      } finally {
        await client.end();
      }
      
    } catch (error: any) {
      spinner.stop();
      log(`❌ Error: ${error.message}`, 'error');
      process.exit(1);
    }
  });

// Agent commands
const agentCommand = program
  .command('agent')
  .description('Interact with the Gatekeeper Agent');

agentCommand
  .command('health')
  .description('Check agent health status')
  .action(async () => {
    const spinner = ora('Checking agent health...').start();
    
    try {
      const health = await checkAgentHealth();
      spinner.stop();
      
      const statusColor = health.status === 'ok' ? chalk.green : 
                         health.status === 'degraded' ? chalk.yellow : 
                         chalk.red;
      
      log(`Agent Status: ${statusColor(health.status.toUpperCase())}`, 'info');
      
      if (health.details) {
        console.log('\nDetails:');
        console.log(JSON.stringify(health.details, null, 2));
      }
      
    } catch (error: any) {
      spinner.stop();
      log(`❌ Agent health check failed: ${error.message}`, 'error');
      process.exit(1);
    }
  });

agentCommand
  .command('test')
  .description('Run comprehensive agent tests')
  .action(async () => {
    log('🧪 Running Agent Tests', 'info');
    console.log();
    
    const tests = [
      {
        name: 'Health Check',
        test: async () => {
          const health = await checkAgentHealth();
          if (health.status !== 'ok') {
            throw new Error(`Agent status: ${health.status}`);
          }
          return 'OK';
        }
      },
      {
        name: 'Create Session',
        test: async () => {
          const target = config.targets['pg-local'];
          if (!target) {
            throw new Error('pg-local target not configured');
          }
          
          const job: CreateSessionJob = {
            id: uuidv4(),
            correlationId: uuidv4(),
            type: 'create_session',
            target,
            role: 'app_read',
            ttlMinutes: 5,
            requester: { userId: 'test-cli' },
            reason: 'CLI test'
          };
          
          const result = await sendJobToAgent(job);
          if (result.status !== 'ready') {
            throw new Error(`Session creation failed: ${result.error?.message}`);
          }
          return result.sessionId;
        }
      },
      {
        name: 'Cleanup Test',
        test: async () => {
          const job: CleanupJob = {
            id: uuidv4(),
            correlationId: uuidv4(),
            type: 'cleanup',
            olderThanMinutes: 1000 // Very old
          };
          
          const result = await sendJobToAgent(job);
          if (result.status !== 'completed') {
            throw new Error(`Cleanup failed: ${result.error?.message}`);
          }
          return `Cleaned ${result.cleanedCount} sessions`;
        }
      }
    ];
    
    for (const test of tests) {
      const spinner = ora(`Running ${test.name}...`).start();
      
      try {
        const result = await test.test();
        spinner.succeed(`${test.name}: ${result}`);
      } catch (error: any) {
        spinner.fail(`${test.name}: ${error.message}`);
      }
    }
    
    console.log();
    log('🎉 Agent tests completed', 'success');
  });

// Configuration commands
const configCommand = program
  .command('config')
  .description('Manage CLI configuration');

configCommand
  .command('show')
  .description('Show current configuration')
  .action(() => {
    console.log(chalk.bold('Gatekeeper CLI Configuration:'));
    console.log();
    
    const displayConfig = {
      ...config,
      database: {
        ...config.database,
        password: '[REDACTED]'
      }
    };
    
    console.log(JSON.stringify(displayConfig, null, 2));
  });

// Interactive mode
program
  .command('interactive')
  .description('Start interactive mode')
  .alias('i')
  .action(async () => {
    log('🚀 Welcome to Gatekeeper CLI Interactive Mode', 'info');
    
    while (true) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: '📋 List Sessions', value: 'list' },
            { name: '➕ Create Session', value: 'create' },
            { name: '🏥 Check Agent Health', value: 'health' },
            { name: '🧪 Run Agent Tests', value: 'test' },
            { name: '⚙️  Show Configuration', value: 'config' },
            { name: '🚪 Exit', value: 'exit' }
          ]
        }
      ]);
      
      if (action === 'exit') {
        log('👋 Goodbye!', 'info');
        break;
      }
      
      try {
        switch (action) {
          case 'list':
            // Call list command programmatically
            const client = await connectToDatabase();
            const result = await client.query('SELECT * FROM gk_list_ephemeral_users() WHERE NOT is_expired ORDER BY valid_until DESC');
            await client.end();
            
            if (result.rows.length === 0) {
              log('No active sessions found', 'info');
            } else {
              const sessionsTable = [
                ['Username', 'Valid Until', 'Status']
              ];
              
              result.rows.forEach(row => {
                sessionsTable.push([
                  row.username,
                  row.valid_until ? new Date(row.valid_until).toLocaleString() : 'No expiry',
                  row.is_expired ? chalk.red('Expired') : chalk.green('Active')
                ]);
              });
              
              console.log(table(sessionsTable));
              log(`Found ${result.rows.length} session(s)`, 'info');
            }
            break;
            
          case 'create':
            const createAnswers = await inquirer.prompt([
              { name: 'target', message: 'Target:', default: 'pg-local' },
              { name: 'role', message: 'Role:', default: 'app_read' },
              { name: 'ttl', message: 'TTL:', default: '30m' },
              { name: 'reason', message: 'Reason (optional):' }
            ]);
            
            // Create session programmatically
            const ttlMinutes = parseTTL(createAnswers.ttl);
            const target = config.targets[createAnswers.target];
            
            if (!target) {
              throw new Error(`Unknown target: ${createAnswers.target}`);
            }
            
            const job: CreateSessionJob = {
              id: uuidv4(),
              correlationId: uuidv4(),
              type: 'create_session',
              target,
              role: createAnswers.role as any,
              ttlMinutes,
              requester: { userId: 'interactive-cli' },
              reason: createAnswers.reason
            };
            
            const sessionResult = await sendJobToAgent(job);
            
            if (sessionResult.status === 'ready') {
              log('✅ Session created successfully!', 'success');
              console.log(`Session ID: ${sessionResult.sessionId}`);
              console.log(`Username: ${sessionResult.username}`);
              console.log(`Expires: ${new Date(sessionResult.expiresAt).toLocaleString()}`);
            } else {
              log(`❌ Session creation failed: ${sessionResult.error?.message}`, 'error');
            }
            break;
            
          case 'health':
            const health = await checkAgentHealth();
            const statusColor = health.status === 'ok' ? chalk.green : 
                               health.status === 'degraded' ? chalk.yellow : 
                               chalk.red;
            log(`Agent Status: ${statusColor(health.status.toUpperCase())}`, 'info');
            break;
            
          case 'test':
            // Run a quick test
            const healthTest = await checkAgentHealth();
            if (healthTest.status === 'ok') {
              log('✅ Agent health check passed', 'success');
            } else {
              log(`⚠️ Agent status: ${healthTest.status}`, 'warning');
            }
            break;
            
          case 'config':
            console.log(chalk.bold('Current Configuration:'));
            console.log(`Agent Mode: ${config.agent.mode}`);
            console.log(`Agent URL: ${config.agent.httpUrl}`);
            console.log(`Database: ${config.database.host}:${config.database.port}/${config.database.database}`);
            break;
        }
      } catch (error: any) {
        log(`Error: ${error.message}`, 'error');
      }
      
      console.log();
    }
  });

// Main program setup
program
  .name('gk')
  .description('Gatekeeper CLI - Manage ephemeral database sessions')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--agent-mode <mode>', 'Agent mode: http or lambda', 'http')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if (options.agentMode) {
      config.agent.mode = options.agentMode as 'http' | 'lambda';
    }
  });

// Error handling
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`, 'error');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`, 'error');
  process.exit(1);
});

// Parse and execute
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { program };