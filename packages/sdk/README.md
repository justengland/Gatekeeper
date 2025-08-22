# @gatekeeper/sdk

TypeScript SDK client generated from OpenAPI specifications for the Gatekeeper Control Plane API.

## Overview

This package provides a fully-typed TypeScript client for interacting with the Gatekeeper Control Plane API. The client is generated from OpenAPI specifications to ensure type safety and API compatibility.

## Installation

```bash
npm install @gatekeeper/sdk
# or
pnpm add @gatekeeper/sdk
```

## Quick Start

```typescript
import { GatekeeperClient } from '@gatekeeper/sdk';

// Initialize client
const client = new GatekeeperClient(
  'https://api.gatekeeper.example.com',
  'your-api-key'
);

// Create a session
const session = await client.createSession({
  targetId: 'pg-local',
  role: 'app_read',
  ttlMinutes: 15,
  reason: 'debugging'
});

console.log(`Session created: ${session.id}`);
console.log(`DSN: ${session.dsn}`);
```

## API Client Methods

### Session Management

```typescript
// Create ephemeral session
const session = await client.createSession({
  targetId: string;
  role: 'app_read' | 'app_write' | 'app_admin';
  ttlMinutes: number;
  reason?: string;
  requester?: {
    userId: string;
    email?: string;
  };
});

// Get session by ID
const session = await client.getSession('ses_01HVJ3C5Z6W6WZ');

// List sessions with filters
const sessions = await client.listSessions({
  status?: 'pending' | 'ready' | 'revoked' | 'expired' | 'failed';
  role?: 'app_read' | 'app_write' | 'app_admin';
  targetId?: string;
  page?: number;
  limit?: number;
});

// Revoke session early
await client.revokeSession('ses_01HVJ3C5Z6W6WZ');
```

### Health Check

```typescript
// Check API health
const health = await client.getHealth();
console.log(health.status); // 'ok' | 'degraded' | 'down'
```

## Authentication

The SDK supports multiple authentication methods:

### API Key Authentication

```typescript
const client = new GatekeeperClient(
  'https://api.gatekeeper.example.com',
  'gk_api_key_here'
);
```

### JWT Bearer Token

```typescript
const client = new GatekeeperClient('https://api.gatekeeper.example.com');
client.setAuthToken('jwt_token_here');
```

### Custom Headers

```typescript
const client = new GatekeeperClient('https://api.gatekeeper.example.com');
client.setCustomHeader('Authorization', 'Bearer custom_token');
```

## Configuration

### Client Options

```typescript
const client = new GatekeeperClient(baseUrl, apiKey, {
  timeout: 30000,        // Request timeout in milliseconds
  retries: 3,            // Number of retry attempts
  retryDelay: 1000,      // Delay between retries
  userAgent: 'MyApp/1.0' // Custom user agent
});
```

### Error Handling

```typescript
import { GatekeeperApiError } from '@gatekeeper/sdk';

try {
  const session = await client.createSession({
    targetId: 'pg-local',
    role: 'app_read',
    ttlMinutes: 15
  });
} catch (error) {
  if (error instanceof GatekeeperApiError) {
    console.log(`API Error ${error.status}: ${error.message}`);
    console.log('Error code:', error.code);
    console.log('Correlation ID:', error.correlationId);
  }
}
```

## Types

The SDK exports comprehensive TypeScript types:

```typescript
import type {
  Session,
  SessionStatus,
  CreateSessionRequest,
  SessionList,
  HealthResponse,
  Role
} from '@gatekeeper/sdk';

// Session information
interface Session {
  id: string;
  status: SessionStatus;
  role: Role;
  targetId: string;
  requester?: {
    userId: string;
    email?: string;
  };
  ttlMinutes: number;
  createdAt: string;
  expiresAt?: string;
  dsn?: string;
  error?: {
    code: string;
    message: string;
  };
}
```

## Development

### Building

```bash
# Build the SDK
pnpm build

# Type check
pnpm typecheck
```

### Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch
```

### Generating Client

The client is generated from OpenAPI specs:

```bash
# Regenerate from OpenAPI spec
pnpm gen:openapi
```

This reads from `../../control-plane/control-plane.openapi.yaml` and generates:
- Type definitions
- API client methods
- Request/response models

### Development Against Local API

```typescript
// Point to local development server
const client = new GatekeeperClient('http://localhost:4000');

// Create session for testing
const session = await client.createSession({
  targetId: 'pg-local',
  role: 'app_read',
  ttlMinutes: 5,
  reason: 'local testing'
});
```

## Integration Examples

### CLI Integration

```typescript
// Used by @gatekeeper/cli
import { GatekeeperClient } from '@gatekeeper/sdk';

const client = new GatekeeperClient(
  config.apiUrl,
  config.apiKey
);

const session = await client.createSession(sessionRequest);
```

### Infrastructure as Code

```typescript
// Terraform/Pulumi usage
import { GatekeeperClient } from '@gatekeeper/sdk';

const client = new GatekeeperClient(process.env.GATEKEEPER_API_URL!);

// Create session for deployment script
const session = await client.createSession({
  targetId: 'prod-replica',
  role: 'app_read',
  ttlMinutes: 30,
  reason: 'migration script'
});

// Use session.dsn for database operations
```

### Testing Utilities

```typescript
// Test helpers
import { GatekeeperClient } from '@gatekeeper/sdk';

export class TestSessionManager {
  constructor(private client: GatekeeperClient) {}

  async createTestSession(): Promise<string> {
    const session = await this.client.createSession({
      targetId: 'test-db',
      role: 'app_read',
      ttlMinutes: 5,
      reason: 'automated test'
    });
    return session.dsn!;
  }
}
```

## Error Codes

Common error codes returned by the API:

- `BAD_REQUEST` - Invalid request parameters
- `UNAUTHORIZED` - Missing or invalid credentials
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `AGENT_UNAVAILABLE` - Agent service unavailable
- `DB_CONNECTION_FAILED` - Database connection error
- `INVALID_TTL` - TTL outside allowed range

## Contributing

1. **OpenAPI changes** should be made in `control-plane/control-plane.openapi.yaml`
2. **Regenerate client**: `pnpm gen:openapi`
3. **Add tests** for new functionality
4. **Update examples** in this README

## Dependencies

- Generated OpenAPI client dependencies
- `@gatekeeper/shared` - Shared types and utilities