# @gatekeeper/agent

Database operation service that executes ephemeral credential management for PostgreSQL (and future MySQL) databases.

## Overview

The Agent is the database execution engine of the Gatekeeper system. It:

- **Processes jobs** from the Control Plane
- **Creates ephemeral users** with time-limited access
- **Grants role-based permissions** using Role Packs
- **Cleans up expired sessions** automatically
- **Maintains audit trail** of all database operations
- **Supports multiple databases** (PostgreSQL, MySQL planned)

In production, the Agent runs as AWS Lambda functions. For local development, it runs as an HTTP service.

## Job Types

### CreateSessionJob
Creates ephemeral database credentials with TTL and role permissions.

### RevokeSessionJob  
Immediately revokes database credentials before TTL expiry.

### CleanupJob
Removes expired database users and cleans up orphaned sessions.

## Development

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Docker (for PostgreSQL testing)
- PostgreSQL client tools (psql)

### Getting Started

```bash
# Install dependencies
pnpm install

# Build the agent
pnpm build

# Run tests (requires Docker for Testcontainers)
pnpm test

# Start in development mode
pnpm dev
```

### Running the Agent

```bash
# Development with hot reload
pnpm dev

# Production mode
pnpm start

# With custom port
AGENT_PORT=8081 pnpm dev
```

The agent will start on `http://localhost:4001` (or the port specified in `AGENT_PORT`).

### Testing Job Processing

```bash
# Health check
curl http://localhost:4001/health

# Process create session job
curl -X POST http://localhost:4001/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "id": "job_123",
    "correlationId": "corr_456",
    "type": "create_session",
    "target": {
      "host": "localhost",
      "port": 5432,
      "database": "testdb",
      "sslMode": "disable"
    },
    "role": "app_read",
    "ttlMinutes": 15,
    "requester": {
      "userId": "test_user",
      "email": "test@example.com"
    },
    "reason": "testing"
  }'
```

## Configuration

Environment variables:

```bash
# Database connection (admin/privileged user)
PGHOST=localhost
PGPORT=5432
PGDATABASE=app
PGUSER=postgres
PGPASSWORD=postgres

# Agent configuration
AGENT_PORT=4001
AGENT_MODE=http                    # http | lambda | sqs
ROLEPACK_VERSION=pg-1.0.0         # SQL template version
SESSION_MAX_TTL_MINUTES=240       # Maximum allowed TTL

# Logging
LOG_LEVEL=info                     # debug | info | warn | error

# Lambda-specific (for LocalStack testing)
LAMBDA_ENDPOINT=http://localhost:4566
LAMBDA_FUNCTION_NAME=gatekeeper-agent
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# Cleanup configuration
CLEANUP_INTERVAL_MINUTES=5         # How often to run cleanup
CLEANUP_GRACE_PERIOD_MINUTES=2    # Extra time before cleanup
```

## Database Setup

### PostgreSQL Bootstrap

The Agent requires specific database roles and SECURITY DEFINER functions:

```sql
-- Create role packs
CREATE ROLE app_read;
GRANT CONNECT ON DATABASE app TO app_read;
GRANT USAGE ON SCHEMA public TO app_read;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_read;

CREATE ROLE app_write;
GRANT app_read TO app_write;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_write;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE, DELETE ON TABLES TO app_write;

-- Create helper functions (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION gk_create_ephemeral_user(
  username text,
  password text, 
  valid_until timestamptz,
  role_name text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L VALID UNTIL %L', 
    username, password, valid_until);
  EXECUTE format('GRANT %I TO %I', role_name, username);
END;
$$;

CREATE OR REPLACE FUNCTION gk_drop_user(username text) 
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = username) THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', username);
    EXECUTE format('DROP ROLE %I', username);
  END IF;
END;
$$;
```

### Running Bootstrap

```bash
# Local development setup
docker compose up -d postgres

# Apply bootstrap SQL
docker exec -i rdsum-postgres psql -U postgres -d app \
  -v ON_ERROR_STOP=1 -f - < packages/agent/sql/bootstrap_roles.sql
```

## Job Processing

### Create Session Flow

1. **Receive job** from Control Plane
2. **Validate input** using Zod schemas
3. **Generate credentials** (username: `gk_{shortuuid}`, random password)
4. **Execute transaction**:
   - Call `gk_create_ephemeral_user()` SECURITY DEFINER function
   - Set user's `VALID UNTIL` timestamp  
   - Grant appropriate role pack
5. **Return DSN** with credentials (redacted in logs)
6. **Emit audit event** with session metadata

### Cleanup Flow

1. **Query expired sessions** (older than TTL + grace period)
2. **For each expired session**:
   - Call `gk_drop_user()` SECURITY DEFINER function
   - Mark session as cleaned in audit log
3. **Handle errors** gracefully (missing users are no-ops)

### Error Handling

```typescript
interface JobResult {
  status: 'ready' | 'failed';
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

Common error codes:
- `DB_CONNECTION_FAILED` - Cannot connect to target database
- `INVALID_ROLE` - Role pack not found
- `USER_CREATION_FAILED` - Cannot create database user
- `PERMISSION_DENIED` - Insufficient privileges
- `TTL_EXCEEDED` - Requested TTL too long

## Role Packs

Role packs define permissions for ephemeral users:

### app_read (Milestone 0)
- `SELECT` on all tables in public schema
- `CONNECT` to database
- `USAGE` on public schema

### app_write (Future)
- All `app_read` permissions
- `INSERT`, `UPDATE`, `DELETE` on tables
- Sequence usage for auto-increment

### app_admin (Future) 
- All `app_write` permissions
- Schema modification permissions
- Index creation/management

Role packs are versioned (e.g., `pg-1.0.0`) and stored in `packages/agent/sql/rolepacks/`.

## Testing

### Unit Tests
```bash
# Test core functions
pnpm test src/username-generator.test.ts
pnpm test src/dsn-builder.test.ts
```

### Integration Tests with Testcontainers
```bash
# Full database integration (requires Docker)
pnpm test src/postgres-provider.test.ts

# Tests actual user creation/deletion
pnpm test src/integration/
```

### Lambda Testing with LocalStack
```bash
# Start LocalStack
docker compose up -d localstack

# Deploy to LocalStack
pnpm build:lambda
pnpm deploy:localstack

# Run Lambda-specific tests
pnpm test:lambda
```

## Deployment

### AWS Lambda (Production)

```bash
# Build Lambda package
pnpm build:lambda

# Deploy with AWS CLI
aws lambda create-function \
  --function-name gatekeeper-agent \
  --runtime nodejs20.x \
  --role arn:aws:iam::account:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://dist/lambda.zip
```

### Docker Container

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 4001
CMD ["node", "dist/server.js"]
```

### Environment Variables for Production

```bash
# Database (with connection pooling)
PGHOST=prod-postgres.example.com
PGPORT=5432
PGDATABASE=app
PGUSER=gatekeeper_agent
PGPASSWORD=secure-password

# Agent configuration
AGENT_MODE=lambda
ROLEPACK_VERSION=pg-1.0.0
SESSION_MAX_TTL_MINUTES=240
LOG_LEVEL=info

# AWS (for Lambda mode)
AWS_REGION=us-east-1
```

## Security

### Least Privilege
- Agent uses dedicated database user with minimal permissions
- Only SECURITY DEFINER functions can create/drop roles
- Ephemeral users get only role pack permissions

### Audit Trail
Every operation generates structured audit events:

```json
{
  "event": "session.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "correlationId": "c07a0c9b-7f6d-4b8f-8b0c-1d8b9eb9f4f8",
  "sessionId": "ses_01HVJ3C5Z6W6WZ",
  "username": "gk_abc123def456",
  "role": "app_read",
  "ttlMinutes": 15,
  "requester": "u_123",
  "target": "pg-local",
  "prevHash": "sha256:..."
}
```

### Secret Redaction
- Passwords never appear in logs
- DSNs are redacted: `postgresql://user:****@host:port/db`
- Audit events use hashed identifiers

## Monitoring

### Health Checks
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 123.45,
  "checks": {
    "database": "ok",
    "rolepack": "ok"
  }
}
```

### Metrics
- Jobs processed per second
- Database connection pool status
- Cleanup lag (time between expiry and cleanup)
- Error rates by error code

## Implementation Status

### ✅ Completed
- Basic HTTP server setup
- Health check endpoint
- Job processing framework
- TypeScript configuration
- Test setup with Testcontainers

### 🚧 In Progress (Milestone 0)
- PostgreSQL provider implementation
- Username generation and validation
- DSN building and redaction
- SECURITY DEFINER function integration
- Audit event generation

### 📋 Planned
- MySQL provider
- IAM database authentication
- Enhanced error handling and retry logic
- Performance optimizations
- Advanced monitoring

## Troubleshooting

### Database Connection Issues
```bash
# Test connection with psql
PGPASSWORD=$PGPASSWORD psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE

# Check agent logs
docker logs gatekeeper-agent

# Verify bootstrap was applied
psql -c "SELECT rolname FROM pg_roles WHERE rolname LIKE 'app_%';"
```

### Permission Problems
```bash
# Check SECURITY DEFINER functions exist
psql -c "\df gk_*"

# Verify agent user has EXECUTE permissions
psql -c "SELECT has_function_privilege('gatekeeper_agent', 'gk_create_ephemeral_user(text,text,timestamptz,text)', 'execute');"
```

### Lambda Deployment Issues
```bash
# Check LocalStack deployment
aws --endpoint-url=http://localhost:4566 lambda list-functions

# Test Lambda invocation
aws --endpoint-url=http://localhost:4566 lambda invoke \
  --function-name gatekeeper-agent \
  --payload file://test-job.json \
  response.json
```

## Contributing

1. **Follow database provider patterns** when adding new database support
2. **Use SECURITY DEFINER functions** for all privileged operations
3. **Add comprehensive tests** including Testcontainers integration
4. **Maintain audit trail** for all database operations
5. **Keep secrets redacted** in all log output

### Adding New Database Providers

1. **Implement `DatabaseProvider` interface**
2. **Create bootstrap SQL** for role packs
3. **Add Testcontainers tests** for the new provider
4. **Update configuration** documentation
5. **Add provider to factory** function

## Dependencies

- `express` - HTTP server framework
- `pg` - PostgreSQL client
- `short-uuid` - Username generation
- `pino` - Structured logging
- `zod` - Schema validation
- `@gatekeeper/shared` - Shared types