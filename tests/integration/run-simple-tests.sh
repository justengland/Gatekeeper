#!/bin/bash
# Simple Integration Test Runner for Gatekeeper
# Tests admin (bob), writer (will), and reader (letty) users
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_header() { echo -e "${PURPLE}[HEADER]${NC} $1"; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yaml"

# Database configuration
export PGHOST=${PGHOST:-localhost}
export PGPORT=${PGPORT:-5432}
export PGDATABASE=${PGDATABASE:-app}
export PGUSER=${PGUSER:-gatekeeper_admin}
export PGPASSWORD=${PGPASSWORD:-gatekeeper_admin_password_change_in_production}

# Parse command line arguments
SKIP_SETUP=false
KEEP_STACK=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-setup) SKIP_SETUP=true; shift ;;
    --keep-stack) KEEP_STACK=true; shift ;;
    --verbose|-v) VERBOSE=true; shift ;;
    --help|-h)
      echo "Simple Integration Test Runner for Gatekeeper"
      echo "Usage: $0 [--skip-setup] [--keep-stack] [--verbose]"
      exit 0
      ;;
    *) print_error "Unknown option: $1"; exit 1 ;;
  esac
done

# Setup Docker services
setup_services() {
  if [ "$SKIP_SETUP" = true ]; then
    print_status "Skipping Docker setup"
    return 0
  fi
  
  print_status "Starting Docker services..."
  cd "$PROJECT_ROOT"
  
  if [ ! -f "$COMPOSE_FILE" ]; then
    print_error "docker-compose.yaml not found at $COMPOSE_FILE"
    exit 1
  fi
  
  # Start PostgreSQL
  docker compose -f docker-compose.yaml up -d postgres
  
  print_status "Waiting for PostgreSQL to be ready..."
  for i in {1..30}; do
    if docker exec gatekeeper-postgres pg_isready -U postgres -d app >/dev/null 2>&1; then
      print_success "PostgreSQL is ready"
      break
    fi
    if [ $i -eq 30 ]; then
      print_error "PostgreSQL failed to start"
      exit 1
    fi
    sleep 2
  done
}

# Install test dependencies
install_deps() {
  print_status "Installing test dependencies..."
  cd "$SCRIPT_DIR"
  npm install >/dev/null 2>&1
  print_success "Dependencies installed"
}

# Verify database connectivity
verify_database() {
  print_status "Verifying database setup..."
  
  if docker exec gatekeeper-postgres psql -U postgres -d app -c "SELECT * FROM gk_validate_setup();" >/dev/null 2>&1; then
    print_success "Database setup verified"
  else
    print_error "Database setup validation failed"
    return 1
  fi
}

# Run the tests
run_tests() {
  print_header "🧪 Running Simple Integration Tests"
  
  cd "$SCRIPT_DIR"
  
  # Set environment variables
  export NODE_ENV=test
  export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  
  print_status "Test Configuration:"
  echo "  Database: $PGHOST:$PGPORT/$PGDATABASE"
  echo "  User: $PGUSER"
  echo ""
  
  # Run the simplified tests
  if [ "$VERBOSE" = true ]; then
    npm test simple-integration.test.js -- --reporter=verbose
  else
    npm test simple-integration.test.js
  fi
  
  return $?
}

# Cleanup
cleanup_services() {
  if [ "$KEEP_STACK" = true ]; then
    print_status "Keeping Docker services running"
    return 0
  fi
  
  print_status "Stopping Docker services..."
  cd "$PROJECT_ROOT"
  docker compose -f docker-compose.yaml down >/dev/null 2>&1 || true
  print_success "Services stopped"
}

# Display summary
display_summary() {
  local exit_code=$1
  
  echo ""
  print_header "🎯 Simple Integration Test Summary"
  echo "=================================="
  
  if [ $exit_code -eq 0 ]; then
    print_success "✅ All tests passed!"
    echo ""
    echo "Validated Users:"
    echo "  • Bob (Admin): ✅ Read/Write/Admin access"
    echo "  • Will (Writer): ✅ Read/Write access"
    echo "  • Letty (Reader): ✅ Read-only access"
  else
    print_error "❌ Some tests failed"
  fi
  
  echo ""
  echo "Database: $PGHOST:$PGPORT/$PGDATABASE"
  echo "Admin User: $PGUSER"
  
  if [ "$KEEP_STACK" = true ]; then
    echo "Services: 🟢 Running"
  else
    echo "Services: 🔴 Stopped"
  fi
}

# Main execution
main() {
  print_header "🚀 Gatekeeper Simple Integration Tests"
  echo "Testing admin (bob), writer (will), and reader (letty)"
  echo "================================================"
  echo ""
  
  local exit_code=0
  
  # Setup
  setup_services
  install_deps
  verify_database
  
  # Run tests
  if ! run_tests; then
    exit_code=1
  fi
  
  # Cleanup
  cleanup_services
  
  # Summary
  display_summary $exit_code
  
  exit $exit_code
}

# Error handling
trap 'echo ""; print_error "Script interrupted"; cleanup_services; exit 1' INT TERM

# Run
main "$@"