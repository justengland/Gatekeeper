# @gatekeeper/cli

Command-line interface for managing ephemeral database sessions with the Gatekeeper system.

## Overview

The Gatekeeper CLI (`gk`) provides a developer-friendly interface for:

- **Creating ephemeral database sessions** with time-limited access
- **Managing active sessions** (list, get, revoke)
- **Authenticating** with Gatekeeper API
- **Configuring profiles** for different environments
- **Shell completion** for commands and options

The CLI is designed for developers, DevOps engineers, and automated scripts that need temporary database access.

## Installation

### From npm (when published)
```bash
# Install globally
npm install -g @gatekeeper/cli

# Or use with npx
npx @gatekeeper/cli --help
```

### From Source
```bash
# Build and link locally
pnpm build
npm link

# Now available as 'gk' command
gk --help
```

### Binary Releases (Planned)
```bash
# macOS via Homebrew
brew install gatekeeper-cli

# Windows via Scoop
scoop install gatekeeper-cli

# Linux via direct download
curl -L https://github.com/org/gatekeeper/releases/latest/download/gk-linux-amd64 -o /usr/local/bin/gk
chmod +x /usr/local/bin/gk
```

## Quick Start

```bash
# Authenticate with Gatekeeper
gk login

# Create an ephemeral session
gk session create --target pg-local --role app_read --ttl 15m --reason "debugging"

# Use the returned DSN
export DSN="postgresql://gk_abc123:password@localhost:5432/app"
psql "$DSN" -c "SELECT current_user, now();"

# List active sessions
gk session list

# Revoke session when done
gk session revoke ses_01HVJ3C5Z6W6WZ
```

## Commands

### Authentication

```bash
# Login to Gatekeeper
gk login [--profile dev]

# Login with API key
gk login --api-key YOUR_API_KEY

# Login with different server
gk login --server https://gatekeeper.company.com

# Show current authentication status
gk auth status

# Logout
gk logout [--profile dev]
```

### Session Management

```bash
# Create ephemeral session
gk session create [options]
  --target, -t     Target database ID (required)
  --role, -r       Role to grant (app_read, app_write, app_admin)
  --ttl            Time to live (e.g., 15m, 2h, 1d)
  --reason         Reason for access (for audit trail)
  --json           Output as JSON
  --wait           Wait for session to be ready

# Examples
gk session create --target pg-prod --role app_read --ttl 30m --reason "investigate bug #123"
gk session create -t mysql-staging -r app_write --ttl 1h --json

# List sessions
gk session list [options]
  --status         Filter by status (pending, ready, expired, revoked)
  --role           Filter by role
  --target         Filter by target
  --json           Output as JSON
  --limit          Number of sessions to show (default: 10)

# Get session details
gk session get <session-id> [--json]

# Revoke session
gk session revoke <session-id>

# Revoke all sessions (with confirmation)
gk session revoke --all
```

### Configuration

```bash
# Show current configuration
gk config show [--profile dev]

# Set default values
gk config set default-ttl 30m
gk config set default-target pg-local

# List configured profiles
gk config profiles

# Set up new profile
gk config profile create staging --server https://staging.gatekeeper.com
```

### Utilities

```bash
# Test connection to Gatekeeper API
gk ping [--profile dev]

# Show CLI version and server info
gk version

# Generate shell completion
gk completion bash > /etc/bash_completion.d/gk
gk completion zsh > /usr/local/share/zsh/site-functions/_gk
```

## Configuration

The CLI stores configuration in `~/.gatekeeper/config.toml`:

```toml
# Default profile
[default]
server = "https://api.gatekeeper.company.com"
api_key = "gk_api_key_here"
default_ttl = "30m"
default_target = "pg-local"
output_format = "table"  # table | json | yaml

# Development profile
[profiles.dev]
server = "http://localhost:4000"
api_key = "dev_key_123"
default_ttl = "5m"

# Production profile  
[profiles.prod]
server = "https://prod.gatekeeper.company.com"
api_key = "prod_key_456"
default_ttl = "15m"
require_reason = true
```

### Environment Variables

```bash
# Override config file settings
export GATEKEEPER_SERVER=https://api.gatekeeper.com
export GATEKEEPER_API_KEY=your_api_key
export GATEKEEPER_PROFILE=dev
export GATEKEEPER_DEFAULT_TTL=30m
```

## Output Formats

### Table Format (Default)
```
SESSION ID              STATUS  ROLE      TARGET    TTL    EXPIRES AT           REASON
ses_01HVJ3C5Z6W6WZ     ready   app_read  pg-local  15m    2024-01-15 10:45:00  debugging
ses_01HVJ3C5Z6W6WA     pending app_write mysql-dev 30m    -                    migration
```

### JSON Format
```bash
gk session list --json
```
```json
{
  "sessions": [
    {
      "id": "ses_01HVJ3C5Z6W6WZ",
      "status": "ready",
      "role": "app_read", 
      "targetId": "pg-local",
      "ttlMinutes": 15,
      "createdAt": "2024-01-15T10:30:00Z",
      "expiresAt": "2024-01-15T10:45:00Z",
      "dsn": "postgresql://gk_abc123:****@localhost:5432/app",
      "reason": "debugging"
    }
  ]
}
```

### Environment Export
```bash
# Export DSN as environment variable
eval $(gk session create --target pg-local --role app_read --ttl 15m --export)
echo $DATABASE_URL
```

## Development

### Prerequisites
- Node.js >= 20.0.0
- pnpm >= 8.0.0

### Getting Started
```bash
# Install dependencies
pnpm install

# Build the CLI
pnpm build

# Link for local testing
npm link

# Run in development mode
pnpm dev --help
```

### Testing the CLI
```bash
# Unit tests
pnpm test

# Integration tests (requires running Gatekeeper API)
pnpm test:integration

# Test specific commands
pnpm dev session create --target pg-local --role app_read --ttl 5m --reason "test"
```

## Architecture

### Command Structure
```
src/
  commands/
    auth/          # Authentication commands
    session/       # Session management
    config/        # Configuration management
  lib/
    api-client.ts  # Gatekeeper API client
    config.ts      # Configuration management
    output.ts      # Output formatting
    auth.ts        # Authentication helpers
  cli.ts           # Main CLI entry point
```

### Dependencies
- `commander.js` - Command-line argument parsing
- `conf` - Configuration file management
- `chalk` - Terminal colors
- `ora` - Loading spinners
- `inquirer` - Interactive prompts
- `@gatekeeper/sdk` - API client library

## Features

### Interactive Mode
```bash
# Interactive session creation
gk session create --interactive

? Select target database: pg-local
? Select role: app_read  
? Time to live: 30m
? Reason for access: debugging user permissions
✓ Session created: ses_01HVJ3C5Z6W6WZ
✓ Connection ready in 2.3s
```

### Shell Integration
```bash
# Add to ~/.bashrc or ~/.zshrc
eval "$(gk completion bash)"

# Auto-complete commands and options
gk session cr<TAB>        # completes to 'create'
gk session create -t <TAB>  # shows available targets
```

### JSON Processing
```bash
# Use with jq for scripting
DSN=$(gk session create --target pg-local --role app_read --ttl 5m --json | jq -r '.dsn')
psql "$DSN" -c "SELECT version();"

# Wait for session to be ready
gk session create --target pg-local --role app_read --ttl 15m --wait --json
```

## Error Handling

The CLI provides clear error messages and exit codes:

```bash
# Authentication errors
$ gk session list
Error: Not authenticated. Run 'gk login' first.

# Validation errors  
$ gk session create --ttl 25h
Error: TTL cannot exceed 24 hours (1440 minutes)

# API errors
$ gk session create --target invalid-db
Error: Target 'invalid-db' not found. Available targets: pg-local, mysql-dev

# Network errors
$ gk session list
Error: Unable to connect to Gatekeeper API at https://api.gatekeeper.com
Check your network connection and server configuration.
```

### Exit Codes
- `0` - Success
- `1` - General error
- `2` - Authentication error
- `3` - Permission error
- `4` - Not found error
- `5` - Network error

## Scripting Examples

### Automated Database Migration
```bash
#!/bin/bash
set -e

echo "Creating ephemeral database session..."
SESSION=$(gk session create \
  --target pg-prod \
  --role app_write \
  --ttl 1h \
  --reason "automated migration #${CI_BUILD_ID}" \
  --wait \
  --json)

DSN=$(echo "$SESSION" | jq -r '.dsn')
SESSION_ID=$(echo "$SESSION" | jq -r '.id')

echo "Running migration..."
migrate -database "$DSN" -path ./migrations up

echo "Cleaning up..."
gk session revoke "$SESSION_ID"
```

### Development Workflow
```bash
#!/bin/bash
# dev-db.sh - Quick development database access

PROFILE=${1:-dev}
TTL=${2:-30m}

echo "Creating development database session..."
SESSION=$(gk session create \
  --profile "$PROFILE" \
  --target pg-local \
  --role app_read \
  --ttl "$TTL" \
  --reason "development work" \
  --json)

DSN=$(echo "$SESSION" | jq -r '.dsn')
echo "Database ready: $DSN"

# Export for other tools
export DATABASE_URL="$DSN"
echo "Exported DATABASE_URL environment variable"

# Optional: Open database GUI
if command -v pgAdmin4 >/dev/null; then
  echo "Opening pgAdmin..."
  pgAdmin4 "$DSN" &
fi
```

## Security Considerations

- **API keys** are stored securely in config files with restricted permissions
- **DSNs are redacted** in output by default (use `--show-credentials` to override)
- **Audit trail** includes CLI version and user information
- **Session cleanup** when CLI process is interrupted (SIGINT/SIGTERM)

## Contributing

1. **Follow Commander.js patterns** for command structure
2. **Use inquirer** for interactive prompts
3. **Add comprehensive tests** for new commands
4. **Update help text** and examples
5. **Maintain backward compatibility** for scripting

### Adding New Commands
1. **Create command file** in `src/commands/`
2. **Add to main CLI** in `src/cli.ts`
3. **Write tests** in `src/commands/*.test.ts`
4. **Update help documentation**
5. **Add examples** to this README

## Troubleshooting

### Configuration Issues
```bash
# Check current config
gk config show

# Reset to defaults
rm ~/.gatekeeper/config.toml
gk login

# Debug mode
DEBUG=gatekeeper:* gk session list
```

### API Connection Issues
```bash
# Test connectivity
gk ping --verbose

# Check profile configuration
gk config show --profile prod

# Verify API key
gk auth status
```

## Dependencies

- `commander` - CLI framework
- `conf` - Configuration management
- `chalk` - Terminal styling
- `ora` - Loading indicators
- `inquirer` - Interactive prompts
- `@gatekeeper/sdk` - API client
- `@gatekeeper/shared` - Shared types