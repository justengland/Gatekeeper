#!/bin/bash
# Clean up Gatekeeper development environment
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

# Use docker compose (newer syntax)
DOCKER_COMPOSE_CMD="docker compose"

# Function to clean up Docker containers and volumes
cleanup_docker() {
  print_status "Stopping and removing Docker containers..."
  
  # Stop all services
  $DOCKER_COMPOSE_CMD down --remove-orphans 2>/dev/null || true
  
  # Remove volumes if requested
  if [ "$1" = "--volumes" ] || [ "$1" = "-v" ]; then
    print_warning "Removing Docker volumes (this will delete all data)..."
    $DOCKER_COMPOSE_CMD down --volumes --remove-orphans 2>/dev/null || true
    
    # Remove named volumes explicitly
    docker volume rm gatekeeper_postgres_data gatekeeper_localstack_data gatekeeper_redis_data 2>/dev/null || true
  fi
  
  # Clean up any orphaned containers
  ORPHANED_CONTAINERS=$(docker ps -aq --filter "name=gatekeeper-" 2>/dev/null || true)
  if [ -n "$ORPHANED_CONTAINERS" ]; then
    print_status "Removing orphaned containers..."
    docker rm -f $ORPHANED_CONTAINERS >/dev/null 2>&1 || true
  fi
  
  print_success "Docker cleanup completed"
}

# Function to clean up LocalStack Lambda functions
cleanup_lambda() {
  if curl -f http://localhost:4566/_localstack/health >/dev/null 2>&1; then
    print_status "Cleaning up LocalStack Lambda functions..."
    
    # List and delete Lambda functions
    export AWS_ACCESS_KEY_ID=test
    export AWS_SECRET_ACCESS_KEY=test
    export AWS_DEFAULT_REGION=us-east-1
    
    FUNCTIONS=$(aws --endpoint-url=http://localhost:4566 lambda list-functions --query 'Functions[].FunctionName' --output text --region us-east-1 2>/dev/null || true)
    
    if [ -n "$FUNCTIONS" ]; then
      for func in $FUNCTIONS; do
        print_status "Deleting Lambda function: $func"
        aws --endpoint-url=http://localhost:4566 lambda delete-function --function-name "$func" --region us-east-1 >/dev/null 2>&1 || true
      done
      print_success "Lambda functions cleaned up"
    else
      print_status "No Lambda functions to clean up"
    fi
  else
    print_status "LocalStack not running, skipping Lambda cleanup"
  fi
}

# Function to clean up ephemeral database users
cleanup_database() {
  print_status "Cleaning up ephemeral database users..."
  
  if docker ps --format "{{.Names}}" | grep -q "gatekeeper-postgres"; then
    CLEANUP_RESULT=$(docker exec gatekeeper-postgres psql -U postgres -d app -c "SELECT * FROM gk_cleanup_expired_users(0);" 2>/dev/null || true)
    
    if [ -n "$CLEANUP_RESULT" ]; then
      print_success "Database cleanup completed"
      echo "$CLEANUP_RESULT" | grep -E "(gk_|was_expired)" || true
    else
      print_warning "Database cleanup function not available"
    fi
  else
    print_status "PostgreSQL container not running, skipping database cleanup"
  fi
}

# Function to clean up temporary files
cleanup_temp_files() {
  print_status "Cleaning up temporary files..."
  
  # Clean up common temp files
  rm -f /tmp/lambda-response.json 2>/dev/null || true
  rm -f /tmp/gatekeeper-*.zip 2>/dev/null || true
  rm -rf /tmp/gatekeeper-* 2>/dev/null || true
  
  # Clean up node_modules if --deep flag is passed
  if [ "$1" = "--deep" ]; then
    print_warning "Performing deep cleanup (removing node_modules)..."
    find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
    rm -f pnpm-lock.yaml 2>/dev/null || true
  fi
  
  print_success "Temporary files cleaned up"
}

# Function to reset environment
reset_environment() {
  print_status "Resetting environment variables..."
  
  # Unset Gatekeeper-specific environment variables
  unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  unset CONTROL_PLANE_PORT AGENT_PORT AGENT_MODE
  unset LOCALSTACK_ENDPOINT LAMBDA_ENDPOINT LAMBDA_FUNCTION_NAME
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
  
  print_success "Environment variables reset"
}

# Function to show cleanup summary
show_summary() {
  echo ""
  echo "======================================"
  echo "🧹 Cleanup Summary"
  echo "======================================"
  
  # Check what's still running
  RUNNING_CONTAINERS=$(docker ps --format "{{.Names}}" | grep "gatekeeper-" | wc -l | xargs)
  if [ "$RUNNING_CONTAINERS" -gt 0 ]; then
    print_warning "$RUNNING_CONTAINERS Gatekeeper containers still running"
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep "gatekeeper-" || true
  else
    print_success "No Gatekeeper containers running"
  fi
  
  # Check volumes
  VOLUMES=$(docker volume ls --format "{{.Name}}" | grep "gatekeeper" | wc -l | xargs)
  if [ "$VOLUMES" -gt 0 ]; then
    print_status "$VOLUMES Gatekeeper volumes present"
    if [ "$1" != "--volumes" ] && [ "$1" != "-v" ]; then
      print_status "Use 'cleanup.sh --volumes' to remove volumes and data"
    fi
  else
    print_success "No Gatekeeper volumes present"
  fi
  
  echo ""
  echo "Environment is clean and ready for fresh start!"
}

# Show help
show_help() {
  echo "Gatekeeper Development Environment Cleanup"
  echo ""
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "OPTIONS:"
  echo "  --help, -h      Show this help message"
  echo "  --volumes, -v   Remove Docker volumes (deletes all data)"
  echo "  --deep          Deep cleanup (remove node_modules, lock files)"
  echo "  --all           Full cleanup (containers, volumes, temp files)"
  echo ""
  echo "Examples:"
  echo "  $0                    # Basic cleanup (containers only)"
  echo "  $0 --volumes          # Remove containers and data volumes"
  echo "  $0 --deep             # Remove containers and node_modules"
  echo "  $0 --all              # Full cleanup of everything"
  echo ""
}

# Main execution
main() {
  case "$1" in
    --help|-h)
      show_help
      exit 0
      ;;
    --all)
      echo "======================================"
      echo "🧹 Full Gatekeeper Environment Cleanup"
      echo "======================================"
      cleanup_lambda
      cleanup_database
      cleanup_docker --volumes
      cleanup_temp_files --deep
      reset_environment
      show_summary --volumes
      ;;
    --volumes|-v)
      echo "======================================"
      echo "🧹 Gatekeeper Cleanup (with volumes)"
      echo "======================================"
      cleanup_lambda
      cleanup_database
      cleanup_docker --volumes
      cleanup_temp_files
      reset_environment
      show_summary --volumes
      ;;
    --deep)
      echo "======================================"
      echo "🧹 Deep Gatekeeper Cleanup"
      echo "======================================"
      cleanup_lambda
      cleanup_database
      cleanup_docker
      cleanup_temp_files --deep
      reset_environment
      show_summary
      ;;
    "")
      echo "======================================"
      echo "🧹 Basic Gatekeeper Cleanup"
      echo "======================================"
      cleanup_lambda
      cleanup_database
      cleanup_docker
      cleanup_temp_files
      reset_environment
      show_summary
      ;;
    *)
      print_error "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
  
  print_success "Cleanup completed successfully!"
}

# Run main function
main "$@"