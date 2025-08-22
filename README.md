# Gatekeeper

**Ephemeral database session management with time-limited access**

Gatekeeper mints ephemeral database sessions with time-limited access, providing secure temporary database credentials for development, debugging, and automated tasks.

## 🚀 Current Status

**Milestone 0**: PostgreSQL-only vertical slice with CLI-first approach
- ✅ **Database Provider Abstraction**: Multi-database architecture implemented
- ✅ **PostgreSQL Provider**: Production-ready with SECURITY DEFINER functions
- ✅ **Agent & Control Plane**: Core services implemented
- ✅ **Testing**: 137 tests passing across all packages
- ✅ **Build System**: Full TypeScript monorepo with Turbo
- 🔄 **Integration**: Docker Compose setup ready, services integration in progress

## Architecture

Gatekeeper consists of two main services:

- **Control Plane**: REST API that receives session requests and dispatches jobs to the Agent
- **Agent**: Executes database operations (create/drop ephemeral credentials, grant roles, cleanup)

The system supports PostgreSQL in production with Oracle, SQL Server, and MySQL support architected for future implementation.

## Repository Structure

This is a pnpm monorepo using Turbo for build orchestration:

```
packages/
  shared/           # Zod types, errors, utilities
  sdk/              # Generated TypeScript client from OpenAPI specs
  control-plane/    # REST API service
  agent/            # Job worker (local daemon simulating Lambda)
  cli/              # gk CLI tool
infra-dev/          # Docker Compose, seeds, local scripts
docs/               # OpenAPI specifications
```

## Prerequisites

- **Node.js** >= 20.0.0 (20 LTS recommended)
- **pnpm** >= 8.0.0
- **Docker** and **Docker Compose** (for local Postgres)
- **psql** client (optional, for direct database access)

## Quick Start

1. **Clone and setup**:
   ```bash
   git clone <repository-url>
   cd Gatekeeper
   pnpm install
   ```

2. **Build all packages**:
   ```bash
   pnpm build
   ```

3. **Run tests**:
   ```bash
   pnpm test
   ```

4. **Start local infrastructure** (when implemented):
   ```bash
   # Start Postgres
   docker compose up -d postgres
   
   # Bootstrap database roles
   docker exec -i rdsum-postgres psql -U postgres -d app \
     -v ON_ERROR_STOP=1 -f - < packages/agent/sql/bootstrap_roles.sql
   ```

5. **Run services in development** (when implemented):
   ```bash
   # Start all services in parallel
   pnpm dev
   
   # Or run individual services
   pnpm --filter control-plane dev
   pnpm --filter agent dev
   pnpm --filter cli dev
   ```

## Available Commands

### Root Level Commands

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Lint all packages
pnpm lint

# Type check all packages
pnpm typecheck

# Start all services in development mode
pnpm dev

# Generate OpenAPI clients
pnpm gen:openapi

# Clean all build artifacts
pnpm clean
```

### Package-Specific Commands

```bash
# Work with specific packages
pnpm --filter @gatekeeper/control-plane build
pnpm --filter @gatekeeper/agent test
pnpm --filter @gatekeeper/cli dev

# Or navigate to package directory
cd packages/control-plane
pnpm build
pnpm test
pnpm dev
```

## Configuration

Environment variables can be set in `.env` files:

```bash
# Postgres connection (for Agent admin role)
PGHOST=localhost
PGPORT=5432
PGDATABASE=app
PGUSER=postgres
PGPASSWORD=postgres

# Service ports
CONTROL_PLANE_PORT=4000
AGENT_PORT=4001

# Agent configuration
AGENT_POLL_INTERVAL_MS=500
ROLEPACK_VERSION=pg-1.0.0
SESSION_MAX_TTL_MINUTES=240
LOG_LEVEL=info

# LocalStack Lambda testing (optional)
AGENT_MODE=lambda
LAMBDA_ENDPOINT=http://localhost:4566
LAMBDA_FUNCTION_NAME=gatekeeper-agent
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

## Development Workflow

### Making Changes

1. **Make changes** to any package
2. **Build dependencies**: `pnpm build` (Turbo handles dependency order)
3. **Run tests**: `pnpm test`
4. **Type check**: `pnpm typecheck`
5. **Lint**: `pnpm lint`

### Adding Dependencies

```bash
# Add to specific package
pnpm --filter @gatekeeper/control-plane add express
pnpm --filter @gatekeeper/control-plane add -D @types/express

# Add to root (build tools, etc.)
pnpm add -D -w prettier

# Add workspace dependency
pnpm --filter @gatekeeper/cli add @gatekeeper/sdk
```

### Creating New Packages

1. Create directory in `packages/`
2. Add `package.json` with `@gatekeeper/` scope
3. Add `tsconfig.json` extending root config
4. Add to workspace references if needed

## Testing

### Local Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm --filter @gatekeeper/shared test:watch

# Run specific package tests
pnpm --filter @gatekeeper/control-plane test
```

### Integration Testing

When infrastructure is implemented:

```bash
# Start test stack
docker compose up -d postgres localstack

# Run integration tests with Testcontainers
pnpm --filter @gatekeeper/agent test

# Test Lambda deployment (LocalStack)
pnpm --filter @gatekeeper/agent test:lambda
```

## Production Deployment

The system is designed for deployment as:

- **Control Plane**: Container (Docker/Kubernetes) or serverless (Lambda)
- **Agent**: AWS Lambda functions with SQS triggers
- **CLI**: Distributed as binary via package managers

See individual package READMEs for specific deployment instructions.

## CLI Usage (Planned)

```bash
# Install CLI globally
npm install -g @gatekeeper/cli

# Authenticate
gk login

# Create ephemeral session
gk session create --target pg-local --role app_read --ttl 15m --reason "debugging"

# List active sessions
gk session list

# Revoke session
gk session revoke <session-id>
```

## Architecture Decisions

Key architectural decisions are documented in:
- `CLAUDE.md` - Development guidelines and architecture overview
- `docs/DECISIONS.md` - Detailed architecture decision records (when created)
- `docs/AUDIT.md` - Audit event specifications (when created)

## Security

- **Least-privilege**: Role-based access with SECURITY DEFINER functions
- **Idempotency**: All operations use idempotency keys
- **Audit trail**: Comprehensive audit logging with hash chains
- **Secret redaction**: Passwords and DSNs are redacted in logs
- **Input validation**: Zod schemas validate all external inputs

## Contributing

1. **Follow the existing code patterns** in each package
2. **Add tests** for new functionality
3. **Update documentation** when adding features
4. **Use conventional commits** for commit messages
5. **Ensure all checks pass**: `pnpm build && pnpm test && pnpm lint`

## Troubleshooting

### Common Issues

**Build failures**:
```bash
# Clean and rebuild
pnpm clean
pnpm install
pnpm build
```

**Dependency issues**:
```bash
# Check workspace dependencies
pnpm list
pnpm why <package-name>
```

**Port conflicts**:
- Control Plane: 4000 (set `CONTROL_PLANE_PORT`)
- Agent: 4001 (set `AGENT_PORT`) 
- Postgres: 5432

### Getting Help

- Check individual package READMEs for specific issues
- Review `CLAUDE.md` for development guidelines
- Check OpenAPI specs in `docs/` for API details

## License

[License information to be added]