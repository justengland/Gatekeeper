# @gatekeeper/control-plane

REST API service that receives session requests and dispatches jobs to the Agent for ephemeral database session management.

## Overview

The Control Plane is the public-facing API of the Gatekeeper system. It:

- **Receives session requests** from CLI, web UI, and API clients
- **Validates inputs** using Zod schemas
- **Enqueues jobs** for the Agent to process
- **Manages session lifecycle** (create, list, get, revoke)
- **Provides audit trail** of all operations
- **Handles authentication** (API keys, JWT tokens)

## API Endpoints

### Health Check
- `GET /health` - Service health status

### Session Management
- `POST /v1/sessions` - Create ephemeral session
- `GET /v1/sessions` - List sessions with filtering
- `GET /v1/sessions/{id}` - Get session details
- `POST /v1/sessions/{id}/revoke` - Revoke session early

### Metrics
- `GET /metrics` - Prometheus metrics

## Development

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Docker (for local Postgres)

### Getting Started

```bash
# Install dependencies
pnpm install

# Build the service
pnpm build

# Run tests
pnpm test

# Start in development mode
pnpm dev
```

### Running the Server

```bash
# Development with hot reload
pnpm dev

# Production mode
pnpm start

# With custom port
CONTROL_PLANE_PORT=8080 pnpm dev
```

The server will start on `http://localhost:4000` (or the port specified in `CONTROL_PLANE_PORT`).

### Testing the API

```bash
# Health check
curl http://localhost:4000/health

# Create session (when implemented)
curl -X POST http://localhost:4000/v1/sessions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "targetId": "pg-local",
    "role": "app_read", 
    "ttlMinutes": 15,
    "reason": "debugging"
  }'
```

## Configuration

Environment variables:

```bash
# Server configuration
CONTROL_PLANE_PORT=4000          # API server port
NODE_ENV=development             # Environment (development/production)
LOG_LEVEL=info                   # Logging level (debug/info/warn/error)

# Agent communication
AGENT_INTERNAL_URL=http://localhost:4001  # Agent service URL
AGENT_MODE=http                  # Agent mode (http/lambda/sqs)

# Authentication
API_KEY_SECRET=your-secret-key   # Secret for API key validation
JWT_SECRET=your-jwt-secret       # Secret for JWT validation

# Database (for session storage)
DATABASE_URL=postgresql://user:pass@localhost:5432/gatekeeper

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000       # Rate limit window (1 minute)
RATE_LIMIT_MAX_REQUESTS=100      # Max requests per window per IP
```

## API Usage

### Authentication

#### API Key Authentication
```bash
curl -H "x-api-key: your-api-key" http://localhost:4000/v1/sessions
```

#### JWT Authentication
```bash
curl -H "Authorization: Bearer jwt-token" http://localhost:4000/v1/sessions
```

### Creating Sessions

```bash
# Basic session creation
curl -X POST http://localhost:4000/v1/sessions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "targetId": "pg-local",
    "role": "app_read",
    "ttlMinutes": 15
  }'

# With idempotency key
curl -X POST http://localhost:4000/v1/sessions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{
    "targetId": "pg-local", 
    "role": "app_read",
    "ttlMinutes": 60,
    "reason": "data migration"
  }'
```

### Response Format

```json
{
  "id": "ses_01HVJ3C5Z6W6WZ",
  "status": "pending",
  "role": "app_read",
  "targetId": "pg-local",
  "requester": {
    "userId": "u_123",
    "email": "user@example.com"
  },
  "ttlMinutes": 15,
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": null,
  "dsn": null
}
```

When the session is ready:
```json
{
  "id": "ses_01HVJ3C5Z6W6WZ", 
  "status": "ready",
  "dsn": "postgresql://gk_abc123:****@localhost:5432/app",
  "expiresAt": "2024-01-15T10:45:00Z"
}
```

## Architecture

### Request Flow

1. **API Request** comes in via HTTP
2. **Authentication** middleware validates credentials
3. **Input validation** using Zod schemas
4. **Rate limiting** applied per client
5. **Job creation** and enqueuing for Agent
6. **Response** sent to client (typically "pending")
7. **Polling/WebSocket** for status updates (future)

### Job Dispatching

The Control Plane communicates with the Agent via:

- **HTTP** (local development): Direct HTTP calls
- **AWS Lambda** (production): Lambda invocation
- **SQS** (production): Message queue for async processing

### Data Storage

- **Session metadata** stored in primary database
- **Job queue** (Redis/SQS for production)
- **Audit events** in append-only audit log

## Implementation Status

### ✅ Completed
- Basic Express server setup
- Health check endpoint
- TypeScript configuration
- Test framework setup

### 🚧 In Progress (Milestone 0)
- Session creation endpoint
- Agent job dispatching
- Input validation with Zod
- Authentication middleware
- Session storage

### 📋 Planned
- Session listing/filtering
- WebSocket for real-time updates
- Rate limiting
- Metrics collection
- Audit event generation

## Testing

```bash
# Run unit tests
pnpm test

# Watch mode
pnpm test:watch

# Integration tests with Supertest
pnpm test src/server.test.ts

# Test with coverage
pnpm test --coverage
```

### Test Structure

```
src/
  __tests__/
    unit/           # Unit tests for individual functions
    integration/    # Integration tests with real HTTP requests
    fixtures/       # Test data and mock responses
  server.test.ts    # Main server integration tests
```

## Error Handling

The API returns structured errors:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "ttlMinutes must be between 1 and 1440",
  "correlationId": "c07a0c9b-7f6d-4b8f-8b0c-1d8b9eb9f4f8"
}
```

Common error codes:
- `BAD_REQUEST` - Invalid input
- `UNAUTHORIZED` - Missing/invalid auth
- `FORBIDDEN` - Insufficient permissions  
- `NOT_FOUND` - Resource not found
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `AGENT_UNAVAILABLE` - Agent service down
- `INTERNAL_ERROR` - Unexpected server error

## Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

### Environment Variables for Production

```bash
# Required
NODE_ENV=production
CONTROL_PLANE_PORT=4000
DATABASE_URL=postgresql://...
AGENT_INTERNAL_URL=...

# Authentication
API_KEY_SECRET=...
JWT_SECRET=...

# Optional
LOG_LEVEL=info
CORS_ORIGINS=https://app.example.com
RATE_LIMIT_MAX_REQUESTS=1000
```

### Health Checks

The `/health` endpoint provides detailed health information:

```json
{
  "status": "ok",
  "version": "0.1.0", 
  "uptimeSeconds": 123.45,
  "checks": {
    "database": "ok",
    "agent": "ok",
    "queue": "ok"
  }
}
```

Status values:
- `ok` - All systems operational
- `degraded` - Some non-critical issues
- `down` - Critical systems failing

## Monitoring

### Logs

Structured JSON logging with pino:

```json
{
  "level": "info",
  "time": "2024-01-15T10:30:00.000Z",
  "correlationId": "c07a0c9b-7f6d-4b8f-8b0c-1d8b9eb9f4f8",
  "method": "POST",
  "url": "/v1/sessions",
  "statusCode": 201,
  "responseTime": 45
}
```

### Metrics (Prometheus)

Available at `/metrics`:

- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request latency
- `sessions_created_total` - Sessions created
- `agent_job_queue_size` - Jobs pending for agent
- `errors_total` - Error count by type

## Contributing

1. **Follow Express.js patterns** for route handling
2. **Use Zod schemas** for all input validation
3. **Add correlation IDs** to all log entries
4. **Write integration tests** for new endpoints
5. **Update OpenAPI spec** when changing APIs

### Adding New Endpoints

1. **Define route** in appropriate router file
2. **Add Zod schema** for request validation
3. **Implement handler** with proper error handling
4. **Add tests** for happy path and error cases
5. **Update OpenAPI specification**

## Dependencies

- `express` - Web framework
- `cors` - CORS middleware
- `helmet` - Security headers
- `pino` / `pino-http` - Structured logging
- `zod` - Schema validation
- `@gatekeeper/shared` - Shared types