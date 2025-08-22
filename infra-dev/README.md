# Gatekeeper Development Infrastructure

This directory contains all the infrastructure setup for local Gatekeeper development, including Docker Compose services, database bootstrap scripts, and development utilities.

## 🚀 Quick Start

```bash
# Start the development stack
./infra-dev/scripts/start-services.sh

# Test database connectivity
./infra-dev/scripts/test-db.sh

# Deploy Agent to LocalStack Lambda (optional)
./infra-dev/scripts/deploy-lambda.sh

# Clean up everything
./infra-dev/scripts/cleanup.sh
```

## 📁 Directory Structure

```
infra-dev/
├── sql/                      # Database initialization scripts
│   ├── 01_bootstrap_roles.sql    # Core roles and SECURITY DEFINER functions
│   └── 02_test_fixtures.sql      # Sample data and test fixtures
├── scripts/                  # Development utilities
│   ├── start-services.sh         # Start Docker services
│   ├── test-db.sh               # Test database setup
│   ├── deploy-lambda.sh         # Deploy to LocalStack Lambda
│   └── cleanup.sh               # Clean up development environment
└── README.md                # This file
```

## 🐳 Docker Services

### PostgreSQL Database
- **Image**: `postgres:16`
- **Port**: `5432`
- **Database**: `app`
- **Admin User**: `gatekeeper_admin`
- **Container**: `gatekeeper-postgres`

### LocalStack (AWS Emulation)
- **Image**: `localstack/localstack:3.0`
- **Port**: `4566` (Gateway)
- **Services**: `lambda,logs,iam,sts`
- **Container**: `gatekeeper-localstack`

### Redis (Optional)
- **Image**: `redis:7-alpine`
- **Port**: `6379`
- **Profile**: `full` (start with `docker compose --profile full up`)

## 🔧 Configuration

### Environment Files
- `.env.example` - Template with all configuration options
- `.env.local` - Local development defaults (safe to commit)
- `.env` - Your personal environment (create from .env.example, do not commit)

### Key Configuration Variables
```bash
# Database
PGHOST=localhost
PGPORT=5432
PGDATABASE=app
PGUSER=gatekeeper_admin
PGPASSWORD=gatekeeper_admin_password_change_in_production

# Services
CONTROL_PLANE_PORT=4000
AGENT_PORT=4001
AGENT_MODE=http  # or 'lambda'

# LocalStack/Lambda
LOCALSTACK_ENDPOINT=http://localhost:4566
LAMBDA_FUNCTION_NAME=gatekeeper-agent
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

## 🗄️ Database Setup

### Admin Role (`gatekeeper_admin`)
- Has minimum privileges needed to manage ephemeral users
- Can create/drop roles and grant permissions
- Runs SECURITY DEFINER functions

### Application Roles (Role Packs)
- `app_read` - Read-only access to application data
- Future: `app_write`, `app_admin`, etc.

### SECURITY DEFINER Functions
- `gk_create_ephemeral_user()` - Create time-limited users
- `gk_drop_user()` - Safely remove users
- `gk_list_ephemeral_users()` - List all ephemeral users
- `gk_cleanup_expired_users()` - Batch cleanup of expired users
- `gk_validate_setup()` - Validate database configuration

### Audit System
- `gatekeeper_audit` table for all session events
- Hash chain integrity for audit trail
- Correlation ID tracking across all operations

## 🧪 Testing

### Database Tests
```bash
# Run all database tests
./infra-dev/scripts/test-db.sh

# Manual testing
PGPASSWORD='gatekeeper_admin_password_change_in_production' \
  psql -h localhost -p 5432 -U gatekeeper_admin -d app

# Validate setup
SELECT * FROM gk_validate_setup();

# Test ephemeral user creation
SELECT gk_create_ephemeral_user(
  'gk_test123', 
  'temp_password', 
  now() + interval '1 hour', 
  'app_read'
);

# List ephemeral users
SELECT * FROM gk_list_ephemeral_users();

# Cleanup expired users
SELECT * FROM gk_cleanup_expired_users(0);
```

### Sample Data
The database includes test tables with sample data:
- `sample_data` - Basic test records
- `products`, `categories`, `orders`, `order_items` - E-commerce sample data
- `order_summary`, `product_stats` - Views for complex queries

### Test Queries
```sql
-- Get predefined test queries
SELECT * FROM gk_get_test_queries();

-- Test basic access
SELECT * FROM gk_test_basic_access();
```

## 🚀 LocalStack Lambda Testing

### Deploy Agent as Lambda
```bash
# Start LocalStack
docker compose up -d localstack

# Deploy function
./infra-dev/scripts/deploy-lambda.sh

# Test invocation
aws --endpoint-url=http://localhost:4566 lambda invoke \
  --function-name gatekeeper-agent \
  --payload '{"test": true}' \
  --region us-east-1 response.json
```

### Lambda Environment
The Lambda function is configured with:
- Runtime: Node.js 18.x
- Timeout: 30 seconds
- Memory: 512 MB
- Environment variables for database connection

## 🔍 Monitoring and Logs

### Docker Logs
```bash
# View all service logs
docker compose logs -f

# Individual service logs
docker compose logs -f postgres
docker compose logs -f localstack

# Database logs only
docker logs gatekeeper-postgres
```

### Database Logs
```bash
# Connect to database
docker exec -it gatekeeper-postgres psql -U postgres -d app

# View audit events
SELECT * FROM gatekeeper_audit ORDER BY created_at DESC LIMIT 10;

# Check active sessions
SELECT * FROM gk_list_ephemeral_users();
```

### LocalStack Logs
```bash
# LocalStack service logs
docker logs gatekeeper-localstack

# Lambda function logs (via AWS CLI)
aws --endpoint-url=http://localhost:4566 logs describe-log-groups --region us-east-1
```

## 🧹 Cleanup

### Cleanup Options
```bash
# Basic cleanup (stop containers)
./infra-dev/scripts/cleanup.sh

# Remove data volumes too
./infra-dev/scripts/cleanup.sh --volumes

# Deep cleanup (including node_modules)
./infra-dev/scripts/cleanup.sh --deep

# Full cleanup (everything)
./infra-dev/scripts/cleanup.sh --all
```

### Manual Cleanup
```bash
# Stop services
docker compose down

# Remove volumes (WARNING: deletes all data)
docker compose down --volumes

# Remove containers and networks
docker compose down --remove-orphans

# Clean up orphaned containers
docker container prune
docker volume prune
```

## 🔒 Security Considerations

### Development Safety
- Default passwords are clearly marked as development-only
- SECURITY DEFINER functions validate all inputs
- Ephemeral users have strict naming patterns (`gk_*`)
- All database operations are logged to audit table

### Production Notes
- Change all default passwords before production use
- Implement proper SSL/TLS for database connections
- Use IAM authentication where possible
- Set up proper network security groups
- Enable PostgreSQL audit logging
- Use secrets management for sensitive values

## 🚨 Troubleshooting

### Common Issues

#### PostgreSQL Connection Issues
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check PostgreSQL logs
docker logs gatekeeper-postgres

# Test connection
docker exec gatekeeper-postgres pg_isready -U postgres -d app
```

#### LocalStack Issues
```bash
# Check LocalStack health
curl http://localhost:4566/_localstack/health

# Restart LocalStack
docker compose restart localstack

# Check LocalStack logs
docker logs gatekeeper-localstack
```

#### Permission Issues
```bash
# Make scripts executable
chmod +x infra-dev/scripts/*.sh

# Check database setup
SELECT * FROM gk_validate_setup();

# Recreate admin role if needed
docker exec -it gatekeeper-postgres psql -U postgres -d app
```

#### Port Conflicts
If ports 5432, 4566, or 6379 are already in use:

1. Stop conflicting services
2. Or modify `docker-compose.yml` to use different ports
3. Update corresponding environment variables

### Getting Help
- Check the main [README.md](../README.md) for project overview
- Review [CLAUDE.md](../CLAUDE.md) for implementation guidance  
- Check container logs: `docker compose logs -f [service]`
- Validate database setup: `./infra-dev/scripts/test-db.sh`

## 📋 Development Workflow

1. **Start Services**: `./infra-dev/scripts/start-services.sh`
2. **Verify Setup**: `./infra-dev/scripts/test-db.sh`
3. **Develop**: Work on Control Plane and Agent packages
4. **Test Lambda**: `./infra-dev/scripts/deploy-lambda.sh` (optional)
5. **Clean Up**: `./infra-dev/scripts/cleanup.sh` when done

This infrastructure provides a complete local development environment for Gatekeeper that closely mirrors the production deployment architecture.