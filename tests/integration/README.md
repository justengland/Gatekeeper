# Gatekeeper Integration Tests

Comprehensive integration test suite that validates the complete Gatekeeper system against a live Docker Compose stack. Tests three user personas with different permission levels and validates the complete user lifecycle.

## 👥 Test Users

### 🔧 Bob - Admin User (`app_admin` role)
- **Capabilities**: Read, Write, Admin functions
- **Can**: Create/manage other users, access all data, modify system
- **Tests**: User management, admin functions, full database access

### ✏️ Will - Writer User (`app_write` role)  
- **Capabilities**: Read, Write (but no admin functions)
- **Can**: Read all data, modify data, create orders/products
- **Cannot**: Manage users, access admin functions
- **Tests**: CRUD operations, complex writes, permission boundaries

### 👁️ Letty - Reader User (`app_read` role)
- **Capabilities**: Read-only access
- **Can**: Read all data, use views, perform complex queries
- **Cannot**: Modify any data, access admin functions  
- **Tests**: Read operations, write permission denial, view access

## 🏗️ Test Architecture

```
Integration Test Suite
├── User Creation (via SECURITY DEFINER functions)
├── Connection Testing (database connectivity)
├── Permission Validation (role-based access control)
├── Capability Testing (CRUD operations)
├── Security Testing (injection prevention, validation)
└── Cleanup (user removal, audit verification)
```

## 🚀 Quick Start

```bash
# Run complete integration test suite
./tests/integration/run-integration-tests.sh

# Run tests against existing Docker stack
./tests/integration/run-integration-tests.sh --skip-setup

# Keep services running after tests
./tests/integration/run-integration-tests.sh --keep-stack

# Verbose output
./tests/integration/run-integration-tests.sh --verbose
```

## 📋 Test Categories

### 1. Database Infrastructure Tests
- Validates all required roles exist (`gatekeeper_admin`, `app_read`, `app_write`, `app_admin`)
- Confirms SECURITY DEFINER functions are available
- Verifies database setup validation functions

### 2. Admin User Tests (Bob)
- Creates ephemeral admin user with `app_admin` role
- Tests connection with generated credentials
- Validates read, write, and admin capabilities
- Tests user management functions (`gk_list_ephemeral_users`)
- Confirms administrative privileges

### 3. Writer User Tests (Will)
- Creates ephemeral writer user with `app_write` role
- Tests connection and basic operations
- Validates read and write capabilities (but not admin)
- Tests complex write operations:
  - Creating categories
  - Adding products  
  - Placing orders
- Confirms admin functions are denied

### 4. Reader User Tests (Letty)
- Creates ephemeral reader user with `app_read` role
- Tests connection and read operations
- Validates read-only access to all data
- Tests complex read operations:
  - Multi-table joins
  - View access (`order_summary`, `product_stats`)
  - Aggregate queries
- Confirms all write operations are denied

### 5. User Lifecycle Tests
- Lists all created ephemeral users
- Validates user metadata (TTL, connection limits)
- Checks audit log entries
- Tests connection limit enforcement

### 6. Cleanup and Security Tests
- Tests SQL injection prevention in user management functions
- Validates username pattern enforcement
- Verifies proper user cleanup and connection termination
- Confirms audit trail integrity

## 🔧 Configuration

### Environment Variables
```bash
PGHOST=localhost          # PostgreSQL host
PGPORT=5432              # PostgreSQL port  
PGDATABASE=app           # Database name
PGUSER=gatekeeper_admin  # Admin user for creating ephemeral users
PGPASSWORD=...           # Admin password
```

### Test Configuration
```javascript
const TEST_CONFIG = {
  users: {
    bob: { role: 'app_admin', capabilities: ['read', 'write', 'admin'] },
    will: { role: 'app_write', capabilities: ['read', 'write'] },
    letty: { role: 'app_read', capabilities: ['read'] }
  },
  sessionTtl: 60, // minutes
  testData: { /* sample data for operations */ }
};
```

## 🧪 Running Tests

### Prerequisites
- Node.js 18+ with npm
- Docker with Docker Compose
- PostgreSQL client tools (psql) - optional but recommended

### Installation
```bash
cd tests/integration
npm install
```

### Manual Test Execution
```bash
# Install dependencies
npm install

# Run tests directly with Vitest
npm run test

# Run with coverage
npm run test:coverage

# Run with UI
npm run test:ui

# Watch mode for development
npm run test:watch
```

### Using the Test Runner Script
```bash
# Full automated run (recommended)
./run-integration-tests.sh

# Advanced options
./run-integration-tests.sh --help
```

## 📊 Test Output

### Successful Run Example
```
🚀 Gatekeeper Integration Test Runner
Testing admin (bob), writer (will), and reader (letty) users

✅ All tests passed successfully!

Test Results:
  • Admin User (Bob): ✅ Full access verified
  • Writer User (Will): ✅ Read/Write access verified  
  • Reader User (Letty): ✅ Read-only access verified
  • User Lifecycle: ✅ Create/Test/Cleanup verified
  • Security: ✅ Permission enforcement verified
```

### Test Coverage
- **Database Infrastructure**: Role setup, function availability
- **User Creation**: Ephemeral user generation with proper credentials
- **Authentication**: Connection testing with generated passwords  
- **Authorization**: Role-based permission enforcement
- **Operations**: CRUD operations appropriate to each role
- **Security**: Input validation, injection prevention
- **Lifecycle**: Complete user creation → testing → cleanup flow

## 🛠️ Development

### Adding New Test Cases
1. Add test cases to `docker-stack-integration.test.js`
2. Follow the existing patterns for user testing
3. Ensure proper cleanup in `afterAll` hooks
4. Test both positive and negative cases

### Test Structure
```javascript
describe('Test Category', () => {
  let userCredentials;
  let userClient;
  
  it('should create user', async () => {
    // Create ephemeral user via SECURITY DEFINER function
  });
  
  it('should connect with credentials', async () => {
    // Test database connection
  });
  
  it('should have expected capabilities', async () => {
    // Test role-based permissions
  });
});
```

### Debugging Tests
```bash
# Run with verbose output
./run-integration-tests.sh --verbose

# Keep services running for manual inspection
./run-integration-tests.sh --keep-stack

# Skip setup if services already running
./run-integration-tests.sh --skip-setup

# Manual database inspection
PGPASSWORD='gatekeeper_admin_password_change_in_production' \
  psql -h localhost -p 5432 -U gatekeeper_admin -d app
```

## 🔍 Troubleshooting

### Common Issues

#### Database Connection Fails
```bash
# Check if PostgreSQL container is running
docker ps | grep postgres

# Check PostgreSQL logs
docker logs gatekeeper-postgres

# Verify database setup
docker exec gatekeeper-postgres psql -U postgres -d app -c "SELECT * FROM gk_validate_setup();"
```

#### Test User Creation Fails
```bash
# Check admin role permissions
PGPASSWORD='...' psql -h localhost -U gatekeeper_admin -d app \
  -c "SELECT current_user, has_createrole_privilege(current_user);"

# Verify role grants
PGPASSWORD='...' psql -h localhost -U gatekeeper_admin -d app \
  -c "SELECT * FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN ('app_read', 'app_write', 'app_admin'));"
```

#### Permission Tests Fail
```bash
# Check role definitions
PGPASSWORD='...' psql -h localhost -U postgres -d app \
  -c "SELECT r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole FROM pg_roles r WHERE r.rolname LIKE 'app_%';"

# Check table permissions
PGPASSWORD='...' psql -h localhost -U postgres -d app \
  -c "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee LIKE 'app_%';"
```

### Manual Verification
After tests complete, you can manually verify the system:

```bash
# List all ephemeral users (should be empty after cleanup)
docker exec gatekeeper-postgres psql -U gatekeeper_admin -d app \
  -c "SELECT * FROM gk_list_ephemeral_users();"

# Check audit log for test events  
docker exec gatekeeper-postgres psql -U gatekeeper_admin -d app \
  -c "SELECT event_type, username, created_at FROM gatekeeper_audit ORDER BY created_at DESC LIMIT 10;"

# Verify no test data remains
docker exec gatekeeper-postgres psql -U gatekeeper_admin -d app \
  -c "SELECT count(*) FROM products WHERE name LIKE '%Test Product%';"
```

## 🎯 Success Criteria

The integration test suite validates:

✅ **User Management**: All user personas can be created with correct roles  
✅ **Authentication**: Generated credentials work for database connections  
✅ **Authorization**: Each role has exactly the expected permissions  
✅ **Operations**: Users can perform operations appropriate to their role  
✅ **Security**: Permission boundaries are properly enforced  
✅ **Lifecycle**: Complete create → test → cleanup flow works reliably  
✅ **Audit**: All operations are properly logged  
✅ **Cleanup**: Ephemeral users are completely removed  

This comprehensive test suite ensures the Gatekeeper system correctly implements role-based access control and secure ephemeral user management as designed.