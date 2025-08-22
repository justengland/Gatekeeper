#!/bin/bash
# Test database connectivity and permissions for Gatekeeper
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Database connection parameters
DB_HOST=${PGHOST:-localhost}
DB_PORT=${PGPORT:-5432}
DB_NAME=${PGDATABASE:-app}
DB_USER=${PGUSER:-gatekeeper_admin}
DB_PASSWORD=${PGPASSWORD:-gatekeeper_admin_password_change_in_production}

echo "======================================"
echo "🔍 Gatekeeper Database Tests"
echo "======================================"

# Test 1: Basic connectivity
print_status "Testing basic database connectivity..."
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" >/dev/null 2>&1; then
  print_success "Database connection successful"
else
  print_error "Cannot connect to database"
  exit 1
fi

# Test 2: Setup validation
print_status "Running setup validation..."
SETUP_RESULT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT * FROM gk_validate_setup();" 2>/dev/null)
if [ $? -eq 0 ]; then
  print_success "Setup validation completed"
  echo "$SETUP_RESULT" | while IFS='|' read -r check_name status details; do
    check_name=$(echo "$check_name" | xargs)
    status=$(echo "$status" | xargs)
    details=$(echo "$details" | xargs)
    
    if [ "$status" = "OK" ]; then
      print_success "$check_name: $details"
    else
      print_warning "$check_name: $details"
    fi
  done
else
  print_warning "Setup validation function not available"
fi

# Test 3: Test ephemeral user creation
print_status "Testing ephemeral user creation..."
TEST_USERNAME="gk_test_$(date +%s)"
TEST_PASSWORD="temp_test_password_123"
FUTURE_TIME=$(date -u -d '+1 hour' '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null || date -u -v+1H '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null)

CREATE_RESULT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT gk_create_ephemeral_user('$TEST_USERNAME', '$TEST_PASSWORD', '$FUTURE_TIME', 'app_read', 1);" 2>&1)
if echo "$CREATE_RESULT" | grep -q "Created ephemeral user"; then
  print_success "Ephemeral user creation successful"
  
  # Test 4: Test connection with ephemeral user
  print_status "Testing connection with ephemeral user..."
  if PGPASSWORD="$TEST_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$TEST_USERNAME" -d "$DB_NAME" -c "SELECT current_user, now();" >/dev/null 2>&1; then
    print_success "Ephemeral user can connect and query"
    
    # Test 5: Test read permissions
    print_status "Testing read permissions..."
    READ_RESULT=$(PGPASSWORD="$TEST_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$TEST_USERNAME" -d "$DB_NAME" -t -c "SELECT count(*) FROM sample_data;" 2>/dev/null)
    if [ $? -eq 0 ]; then
      print_success "Ephemeral user can read sample_data ($READ_RESULT records)"
    else
      print_warning "Ephemeral user cannot read sample_data"
    fi
    
    # Test 6: Test write permissions (should fail)
    print_status "Testing write permissions (should be denied)..."
    WRITE_RESULT=$(PGPASSWORD="$TEST_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$TEST_USERNAME" -d "$DB_NAME" -c "INSERT INTO sample_data (name) VALUES ('test');" 2>&1)
    if echo "$WRITE_RESULT" | grep -q "permission denied"; then
      print_success "Write permissions correctly denied"
    else
      print_warning "Write permissions were not properly restricted"
    fi
  else
    print_error "Ephemeral user cannot connect"
  fi
  
  # Test 7: Clean up ephemeral user
  print_status "Cleaning up ephemeral user..."
  DROP_RESULT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT gk_drop_user('$TEST_USERNAME');" 2>&1)
  if echo "$DROP_RESULT" | grep -q "Dropped ephemeral user"; then
    print_success "Ephemeral user cleanup successful"
  else
    print_warning "Ephemeral user cleanup may have failed"
  fi
else
  print_error "Ephemeral user creation failed"
  echo "$CREATE_RESULT"
fi

# Test 8: Test helper functions
print_status "Testing helper functions availability..."
FUNCTIONS=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT proname FROM pg_proc WHERE proname LIKE 'gk_%' ORDER BY proname;" 2>/dev/null)
if [ $? -eq 0 ]; then
  print_success "Helper functions available:"
  echo "$FUNCTIONS" | while read -r func; do
    func=$(echo "$func" | xargs)
    [ -n "$func" ] && echo "  - $func"
  done
else
  print_warning "Could not list helper functions"
fi

# Test 9: Test basic data access
print_status "Testing basic data access..."
if command -v docker >/dev/null && docker ps | grep -q gatekeeper-postgres; then
  DATA_TEST=$(docker exec gatekeeper-postgres psql -U postgres -d app -t -c "SELECT * FROM gk_test_basic_access();" 2>/dev/null)
  if [ $? -eq 0 ]; then
    print_success "Basic data access tests:"
    echo "$DATA_TEST" | while IFS='|' read -r test_name result details; do
      test_name=$(echo "$test_name" | xargs)
      result=$(echo "$result" | xargs) 
      details=$(echo "$details" | xargs)
      
      if [ "$result" = "OK" ]; then
        print_success "$test_name: $details"
      else
        print_warning "$test_name: $details"
      fi
    done
  else
    print_warning "Basic data access test function not available"
  fi
fi

# Test 10: Test audit log
print_status "Testing audit log..."
AUDIT_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM gatekeeper_audit;" 2>/dev/null)
if [ $? -eq 0 ]; then
  print_success "Audit log accessible ($AUDIT_COUNT entries)"
else
  print_warning "Audit log not accessible"
fi

echo ""
echo "======================================"
echo "📋 Connection Information"
echo "======================================"
echo "Database: $DB_HOST:$DB_PORT/$DB_NAME"
echo "Admin User: $DB_USER"
echo ""
echo "Direct connection command:"
echo "PGPASSWORD='$DB_PASSWORD' psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
echo ""
echo "Or using Docker:"
echo "docker exec -it gatekeeper-postgres psql -U postgres -d app"
echo ""
echo "======================================"
print_success "Database tests completed!"