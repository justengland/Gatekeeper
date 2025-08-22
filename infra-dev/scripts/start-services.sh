#!/bin/bash
# Start local Gatekeeper development services
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
  print_status "Checking prerequisites..."
  
  if ! command_exists docker; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
  fi
  
  # Check for docker compose (newer) or docker-compose (legacy)
  if ! command_exists docker || ! (docker compose version >/dev/null 2>&1 || command_exists docker-compose); then
    print_error "Docker Compose is not available. Please install Docker Compose."
    exit 1
  fi
  
  print_success "Prerequisites check passed"
}

# Function to wait for service to be ready
wait_for_service() {
  local service=$1
  local max_attempts=${2:-30}
  local attempt=1
  
  print_status "Waiting for $service to be ready..."
  
  while [ $attempt -le $max_attempts ]; do
    if docker compose ps $service | grep -q "Up (healthy)"; then
      print_success "$service is ready"
      return 0
    fi
    
    if [ $attempt -eq 1 ]; then
      print_status "Waiting for $service to start..."
    fi
    
    sleep 2
    attempt=$((attempt + 1))
  done
  
  print_warning "$service is not showing as healthy after $max_attempts attempts"
  return 1
}

# Function to test database connection
test_database() {
  print_status "Testing database connection..."
  
  # Wait a bit for the database to fully initialize
  sleep 5
  
  if docker exec gatekeeper-postgres pg_isready -U postgres -d app >/dev/null 2>&1; then
    print_success "Database is accessible"
    
    # Test the setup validation
    print_status "Running setup validation..."
    if docker exec -i gatekeeper-postgres psql -U postgres -d app -c "SELECT * FROM gk_validate_setup();" >/dev/null 2>&1; then
      print_success "Database setup validation passed"
    else
      print_warning "Database setup validation had issues - check logs"
    fi
  else
    print_error "Database is not accessible"
    return 1
  fi
}

# Function to test LocalStack
test_localstack() {
  print_status "Testing LocalStack connection..."
  
  # Wait for LocalStack to be ready
  sleep 5
  
  if curl -f http://localhost:4566/_localstack/health >/dev/null 2>&1; then
    print_success "LocalStack is accessible"
    
    # Test Lambda service
    if curl -f http://localhost:4566/_localstack/health | grep -q '"lambda": "available"' 2>/dev/null; then
      print_success "Lambda service is available"
    else
      print_warning "Lambda service may not be ready yet"
    fi
  else
    print_error "LocalStack is not accessible"
    return 1
  fi
}

# Main execution
main() {
  echo "======================================"
  echo "🚀 Starting Gatekeeper Development Stack"
  echo "======================================"
  
  check_prerequisites
  
  # Set environment
  export COMPOSE_PROJECT_NAME=gatekeeper
  
  # Start services
  print_status "Starting Docker services..."
  
  # Use docker compose (newer syntax)
  DOCKER_COMPOSE_CMD="docker compose"
  
  # Start core services (postgres and localstack)
  $DOCKER_COMPOSE_CMD up -d postgres localstack
  
  # Wait for services to be ready
  wait_for_service postgres 30
  wait_for_service localstack 30
  
  # Test services
  test_database
  test_localstack
  
  print_success "Development stack is ready!"
  
  echo ""
  echo "======================================"
  echo "📋 Service Information"
  echo "======================================"
  echo "PostgreSQL:"
  echo "  Host: localhost:5432"
  echo "  Database: app"
  echo "  Admin User: gatekeeper_admin"
  echo "  Connection: psql -h localhost -p 5432 -U gatekeeper_admin -d app"
  echo ""
  echo "LocalStack:"
  echo "  Gateway: http://localhost:4566"
  echo "  Health: http://localhost:4566/_localstack/health"
  echo "  AWS CLI: aws --endpoint-url=http://localhost:4566 <command>"
  echo ""
  echo "======================================"
  echo "🔧 Next Steps"
  echo "======================================"
  echo "1. Test database access:"
  echo "   ./infra-dev/scripts/test-db.sh"
  echo ""
  echo "2. Deploy Lambda function:"
  echo "   ./infra-dev/scripts/deploy-lambda.sh"
  echo ""
  echo "3. Start development services:"
  echo "   pnpm --filter control-plane dev"
  echo "   pnpm --filter agent dev"
  echo ""
  echo "4. View logs:"
  echo "   $DOCKER_COMPOSE_CMD logs -f postgres"
  echo "   $DOCKER_COMPOSE_CMD logs -f localstack"
  echo ""
  echo "5. Stop services:"
  echo "   $DOCKER_COMPOSE_CMD down"
  echo ""
}

# Run with error handling
if main "$@"; then
  print_success "Stack started successfully"
  exit 0
else
  print_error "Failed to start stack"
  exit 1
fi