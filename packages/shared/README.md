# @gatekeeper/shared

Shared types, utilities, and Zod schemas used across all Gatekeeper packages.

## Overview

This package provides:

- **Zod schemas** for request/response validation
- **TypeScript types** for job contracts and API models
- **Error classes** for structured error handling
- **Utility functions** used across packages

## Installation

This package is automatically installed as a workspace dependency:

```bash
# From any package that needs it
pnpm add @gatekeeper/shared
```

## Usage

```typescript
import { 
  GATEKEEPER_VERSION,
  GatekeeperError,
  DatabaseTarget,
  Requester 
} from '@gatekeeper/shared';

// Use shared types
const target: DatabaseTarget = {
  host: 'localhost',
  port: 5432,
  database: 'app',
  sslMode: 'prefer'
};

// Use error classes
throw new GatekeeperError('Database connection failed', 'DB_ERROR', true);
```

## Exports

### Types

- `DatabaseTarget` - Database connection configuration
- `Requester` - User information for session requests
- Additional types will be added as the system develops

### Constants

- `GATEKEEPER_VERSION` - Current version of the Gatekeeper system

### Error Classes

- `GatekeeperError` - Base error class with code and retry information

## Development

### Building

```bash
# Build this package
pnpm build

# Build with dependencies
pnpm --filter @gatekeeper/shared build
```

### Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Run from root
pnpm --filter @gatekeeper/shared test
```

### Type Checking

```bash
# Type check without building
pnpm typecheck
```

## Zod Schemas (Planned)

This package will contain comprehensive Zod schemas for:

```typescript
// Job contracts (Control Plane ↔ Agent)
export const CreateSessionJobSchema = z.object({
  id: z.string(),
  correlationId: z.string().uuid(),
  target: DatabaseTargetSchema,
  role: z.enum(['app_read', 'app_write', 'app_admin']),
  ttlMinutes: z.number().int().min(1).max(1440),
  requester: RequesterSchema,
  reason: z.string().max(256).optional()
});

// API request/response schemas
export const CreateSessionRequestSchema = z.object({
  targetId: z.string(),
  role: RoleSchema,
  ttlMinutes: z.number().int().min(1).max(1440),
  reason: z.string().max(256).optional()
});

// Validation helpers
export const validateCreateSessionJob = (data: unknown) => 
  CreateSessionJobSchema.parse(data);
```

## Error Handling

The shared error system provides structured error handling:

```typescript
import { GatekeeperError } from '@gatekeeper/shared';

// Creating errors with context
throw new GatekeeperError(
  'Failed to create ephemeral user',
  'USER_CREATION_FAILED',
  true // retryable
);

// Handling errors
try {
  await createUser();
} catch (error) {
  if (error instanceof GatekeeperError) {
    console.log(`Error ${error.code}: ${error.message}`);
    if (error.retryable) {
      // Implement retry logic
    }
  }
}
```

## Contributing

When adding new shared functionality:

1. **Add types** to appropriate files in `src/`
2. **Export** from `src/index.ts`
3. **Add tests** in `src/*.test.ts`
4. **Update this README** if needed

### Guidelines

- Use Zod for runtime validation
- Provide TypeScript types derived from Zod schemas
- Include JSDoc comments for public APIs
- Follow existing naming conventions
- Add comprehensive tests for new functionality

## Dependencies

- `zod` - Schema validation and type generation

## Used By

- `@gatekeeper/control-plane` - API request/response validation
- `@gatekeeper/agent` - Job validation and processing
- `@gatekeeper/cli` - Input validation and error handling
- `@gatekeeper/sdk` - Type definitions for generated client