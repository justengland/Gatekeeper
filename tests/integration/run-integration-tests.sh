#!/bin/bash
# Comprehensive Integration Test Runner for Gatekeeper
# Tests admin (bob), writer (will), and reader (letty) users against Docker stack
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_header() { echo -e "${PURPLE}[HEADER]${NC} $1"; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INTEGRATION_DIR="$SCRIPT_DIR"

# Test configuration
export PGHOST=${PGHOST:-localhost}
export PGPORT=${PGPORT:-5432}
export PGDATABASE=${PGDATABASE:-app}
export PGUSER=${PGUSER:-gatekeeper_admin}
export PGPASSWORD=${PGPASSWORD:-gatekeeper_admin_password_change_in_production}

# Command line options
SKIP_SETUP=${SKIP_SETUP:-false}
SKIP_CLEANUP=${SKIP_CLEANUP:-false}
KEEP_STACK=${KEEP_STACK:-false}
VERBOSE=${VERBOSE:-false}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-setup)
      SKIP_SETUP=true
      shift
      ;;
    --skip-cleanup)
      SKIP_CLEANUP=true
      shift
      ;;
    --keep-stack)
      KEEP_STACK=true
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      echo "Gatekeeper Integration Test Runner"
      echo ""
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "OPTIONS:"
      echo "  --skip-setup     Don't start Docker services (assume they're running)"
      echo "  --skip-cleanup   Don't clean up test data after tests"
      echo "  --keep-stack     Don't stop Docker services after tests"
      echo "  --verbose, -v    Enable verbose output"
      echo "  --help, -h       Show this help message"
      echo ""
      echo "Environment Variables:"
      echo "  PGHOST          PostgreSQL host (default: localhost)"
      echo "  PGPORT          PostgreSQL port (default: 5432)"
      echo "  PGDATABASE      PostgreSQL database (default: app)"
      echo "  PGUSER          PostgreSQL user (default: gatekeeper_admin)"
      echo "  PGPASSWORD      PostgreSQL password"
      echo ""
      echo "Examples:"
      echo "  $0                          # Full test run"
      echo "  $0 --skip-setup            # Run tests against existing stack"
      echo "  $0 --keep-stack            # Leave services running after tests"
      echo "  $0 --verbose               # Show detailed output"
      echo ""
      exit 0
      ;;
    *)
      print_error "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Function to check prerequisites
check_prerequisites() {
  print_status "Checking prerequisites..."
  
  # Check Node.js
  if ! command -v node >/dev/null 2>&1; then
    print_error "Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
  fi
  
  NODE_VERSION=$(node --version | sed 's/v//')
  NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1)
  if [ $NODE_MAJOR -lt 18 ]; then
    print_error "Node.js version $NODE_VERSION is too old. Please install Node.js 18 or higher."
    exit 1
  fi
  
  # Check npm
  if ! command -v npm >/dev/null 2>&1; then
    print_error "npm is not installed. Please install npm."
    exit 1
  fi
  
  # Check Docker
  if ! command -v docker >/dev/null 2>&1; then
    print_error "Docker is not installed. Please install Docker."
    exit 1
  fi
  
  # Check psql for database testing
  if ! command -v psql >/dev/null 2>&1; then
    print_warning "psql is not installed. Some manual verification steps will be skipped."
  fi
  
  print_success "Prerequisites check passed"
}

# Function to setup Docker services
setup_docker_services() {
  if [ "$SKIP_SETUP" = true ]; then
    print_status "Skipping Docker setup (--skip-setup specified)"
    return 0
  fi
  
  print_status "Setting up Docker services..."
  
  cd "$PROJECT_ROOT"
  
  # Start services using our script
  if [ -f "infra-dev/scripts/start-services.sh" ]; then
    print_status "Starting services using start-services.sh..."
    ./infra-dev/scripts/start-services.sh
  else
    print_status "Starting services using docker compose..."
    docker compose up -d postgres localstack
    
    # Wait for services
    print_status "Waiting for services to be ready..."
    sleep 10
    
    # Check PostgreSQL
    if ! docker exec gatekeeper-postgres pg_isready -U postgres -d app >/dev/null 2>&1; then
      print_error "PostgreSQL is not ready"
      exit 1
    fi
    
    print_success "Docker services are ready"
  fi
}

# Function to install test dependencies
install_dependencies() {
  print_status "Installing test dependencies..."
  
  cd "$INTEGRATION_DIR"
  
  if [ ! -f "package.json" ]; then
    print_error "package.json not found in $INTEGRATION_DIR"
    exit 1
  fi
  
  npm install
  
  print_success "Dependencies installed"
}

# Function to verify database connectivity
verify_database() {
  print_status "Verifying database connectivity..."
  
  # Test admin connection
  if command -v psql >/dev/null 2>&1; then
    if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1" >/dev/null 2>&1; then
      print_success "Database connection successful"
    else
      print_error "Cannot connect to database"
      print_error "Check that Docker services are running and database credentials are correct"
      exit 1
    fi
  else
    print_warning "psql not available, skipping direct database verification"
  fi
  
  # Verify database setup using Docker
  print_status "Validating database setup..."
  if docker exec gatekeeper-postgres psql -U postgres -d app -c "SELECT * FROM gk_validate_setup();" >/dev/null 2>&1; then
    print_success "Database setup validation passed"
  else
    print_warning "Database setup validation had issues"
  fi
}

# Function to run the integration tests
run_integration_tests() {
  print_header "🧪 Running Integration Tests"
  
  cd "$INTEGRATION_DIR"
  
  # Set test environment
  export NODE_ENV=test
  
  # Export database configuration
  export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  
  print_status "Test Configuration:"
  echo "  Database: $PGHOST:$PGPORT/$PGDATABASE"
  echo "  User: $PGUSER"
  echo "  Test Directory: $INTEGRATION_DIR"
  echo ""
  
  # Run the tests
  if [ "$VERBOSE" = true ]; then
    print_status "Running tests in verbose mode..."
    npm run test -- --reporter=verbose
  else
    print_status "Running integration tests..."
    npm run test
  fi
  
  local test_exit_code=$?
  
  if [ $test_exit_code -eq 0 ]; then
    print_success "All integration tests passed! ✨"
  else
    print_error "Some integration tests failed"
    return $test_exit_code
  fi
}

# Function to cleanup test data
cleanup_test_data() {
  if [ "$SKIP_CLEANUP" = true ]; then
    print_status "Skipping test data cleanup (--skip-cleanup specified)"
    return 0
  fi
  
  print_status "Cleaning up test data..."
  
  # Clean up any remaining ephemeral users created by tests
  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
      -c "SELECT * FROM gk_cleanup_expired_users(0);" >/dev/null 2>&1 || true
  fi
  
  print_success "Test data cleanup completed"
}

# Function to cleanup Docker services
cleanup_docker_services() {
  if [ "$KEEP_STACK" = true ]; then
    print_status "Keeping Docker stack running (--keep-stack specified)"
    print_status "To stop services later, run: docker compose down"
    return 0
  fi
  
  print_status "Stopping Docker services..."
  
  cd "$PROJECT_ROOT"
  docker compose down >/dev/null 2>&1 || true
  
  print_success "Docker services stopped"
}

# Function to display test summary
display_summary() {
  local exit_code=$1
  
  echo ""
  print_header "🎯 Integration Test Summary"
  echo "======================================"
  
  if [ $exit_code -eq 0 ]; then
    print_success "✅ All tests passed successfully!"
    echo ""
    echo "Test Results:"
    echo "  • Admin User (Bob): ✅ Full access verified"
    echo "  • Writer User (Will): ✅ Read/Write access verified" 
    echo "  • Reader User (Letty): ✅ Read-only access verified"
    echo "  • User Lifecycle: ✅ Create/Test/Cleanup verified"
    echo "  • Security: ✅ Permission enforcement verified"
  else
    print_error "❌ Some tests failed"
    echo ""
    echo "Please check the test output above for details."
  fi
  
  echo ""
  echo "Database Information:"
  echo "  Host: $PGHOST:$PGPORT"
  echo "  Database: $PGDATABASE"
  echo "  Admin User: $PGUSER"
  echo ""
  
  if [ "$KEEP_STACK" = true ]; then
    echo "Services Status: 🟢 Running (use 'docker compose down' to stop)"
  else
    echo "Services Status: 🔴 Stopped"
  fi
  
  echo ""
}

# Main execution function
main() {
  print_header "🚀 Gatekeeper Integration Test Runner"
  echo "Testing admin (bob), writer (will), and reader (letty) users"
  echo "======================================================="
  echo ""
  
  local overall_exit_code=0
  
  # Setup phase
  check_prerequisites
  setup_docker_services
  install_dependencies
  verify_database
  
  # Test phase
  if ! run_integration_tests; then
    overall_exit_code=1
  fi
  
  # Cleanup phase
  cleanup_test_data
  cleanup_docker_services
  
  # Summary
  display_summary $overall_exit_code
  
  exit $overall_exit_code
}

# Error handling
trap 'echo ""; print_error "Script interrupted"; cleanup_docker_services; exit 1' INT TERM

# Run main function
main "$@"