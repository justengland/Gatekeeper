#!/bin/bash
# Deploy Gatekeeper Agent as Lambda function to LocalStack
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

# Configuration
LOCALSTACK_ENDPOINT=${LOCALSTACK_ENDPOINT:-http://localhost:4566}
FUNCTION_NAME=${LAMBDA_FUNCTION_NAME:-gatekeeper-agent}
AWS_REGION=${AWS_DEFAULT_REGION:-us-east-1}

# Check prerequisites
check_prerequisites() {
  print_status "Checking prerequisites..."
  
  if ! command -v aws >/dev/null 2>&1; then
    print_error "AWS CLI is not installed. Please install AWS CLI first."
    print_error "Installation: pip install awscli"
    exit 1
  fi
  
  if ! command -v zip >/dev/null 2>&1; then
    print_error "zip command is not available"
    exit 1
  fi
  
  # Check if LocalStack is running
  if ! curl -f "$LOCALSTACK_ENDPOINT/_localstack/health" >/dev/null 2>&1; then
    print_error "LocalStack is not running at $LOCALSTACK_ENDPOINT"
    print_error "Please start LocalStack first: ./infra-dev/scripts/start-services.sh"
    exit 1
  fi
  
  print_success "Prerequisites check passed"
}

# Set AWS credentials for LocalStack
setup_aws_credentials() {
  print_status "Setting up AWS credentials for LocalStack..."
  
  export AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-test}
  export AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-test}
  export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}
  
  print_success "AWS credentials configured for LocalStack"
}

# Build the Lambda package
build_lambda_package() {
  print_status "Building Lambda package..."
  
  # Create temporary directory for Lambda package
  TEMP_DIR=$(mktemp -d)
  PACKAGE_DIR="$TEMP_DIR/lambda-package"
  
  mkdir -p "$PACKAGE_DIR"
  
  # Note: This is a placeholder for when the Agent package is implemented
  # The actual implementation would build the agent package here
  cat > "$PACKAGE_DIR/index.js" << 'EOF'
// Gatekeeper Agent Lambda Handler (Placeholder)
// This will be replaced with the actual agent implementation

const { Pool } = require('pg');

// Environment variables will be injected by Lambda
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
});

exports.handler = async (event) => {
  console.log('Gatekeeper Agent Lambda invoked', JSON.stringify(event, null, 2));
  
  try {
    // Parse the job from the event
    const job = typeof event.body === 'string' ? JSON.parse(event.body) : event;
    
    console.log('Processing job:', job.type, 'ID:', job.id);
    
    // This is a placeholder - actual job processing will be implemented
    // when the Agent package is built
    
    // Test database connectivity
    const client = await pool.connect();
    const result = await client.query('SELECT current_user, now()');
    client.release();
    
    console.log('Database test successful:', result.rows[0]);
    
    // Return placeholder response
    const response = {
      sessionId: job.type === 'create_session' ? `ses_${Date.now()}` : undefined,
      status: 'ready',
      message: 'Placeholder response - Agent not fully implemented yet'
    };
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(response)
    };
    
  } catch (error) {
    console.error('Agent error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        status: 'failed',
        error: {
          code: 'LAMBDA_ERROR',
          message: error.message,
          retryable: false
        }
      })
    };
  }
};
EOF

  # Create minimal package.json
  cat > "$PACKAGE_DIR/package.json" << 'EOF'
{
  "name": "gatekeeper-agent-lambda",
  "version": "0.1.0",
  "description": "Gatekeeper Agent Lambda Function",
  "main": "index.js",
  "dependencies": {
    "pg": "^8.11.0"
  }
}
EOF

  # Install dependencies (minimal for placeholder)
  print_status "Installing Lambda dependencies..."
  cd "$PACKAGE_DIR"
  npm install --production >/dev/null 2>&1
  
  # Create the deployment package
  print_status "Creating deployment package..."
  ZIP_FILE="$TEMP_DIR/gatekeeper-agent.zip"
  zip -r "$ZIP_FILE" . >/dev/null 2>&1
  
  echo "$ZIP_FILE"
}

# Deploy to LocalStack
deploy_lambda() {
  local zip_file=$1
  
  print_status "Deploying Lambda function to LocalStack..."
  
  # Delete existing function if it exists
  aws --endpoint-url="$LOCALSTACK_ENDPOINT" lambda delete-function \
    --function-name "$FUNCTION_NAME" \
    --region "$AWS_REGION" >/dev/null 2>&1 || true
  
  # Create the function
  print_status "Creating Lambda function '$FUNCTION_NAME'..."
  
  CREATE_RESULT=$(aws --endpoint-url="$LOCALSTACK_ENDPOINT" lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "nodejs18.x" \
    --role "arn:aws:iam::123456789012:role/lambda-role" \
    --handler "index.handler" \
    --zip-file "fileb://$zip_file" \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={
      PGHOST=host.docker.internal,
      PGPORT=5432,
      PGDATABASE=app,
      PGUSER=gatekeeper_admin,
      PGPASSWORD=gatekeeper_admin_password_change_in_production,
      PGSSLMODE=prefer
    }" \
    --region "$AWS_REGION" 2>/dev/null)
  
  if [ $? -eq 0 ]; then
    FUNCTION_ARN=$(echo "$CREATE_RESULT" | grep -o '"FunctionArn": "[^"]*"' | cut -d'"' -f4)
    print_success "Lambda function created successfully"
    print_success "Function ARN: $FUNCTION_ARN"
  else
    print_error "Failed to create Lambda function"
    exit 1
  fi
}

# Test the deployed function
test_lambda() {
  print_status "Testing deployed Lambda function..."
  
  # Create test payload
  TEST_PAYLOAD='{
    "id": "test_job_123",
    "correlationId": "12345678-1234-1234-1234-123456789012",
    "type": "create_session",
    "target": {
      "host": "localhost",
      "port": 5432,
      "database": "app"
    },
    "role": "app_read",
    "ttlMinutes": 30,
    "requester": {
      "userId": "test_user"
    },
    "reason": "Lambda deployment test"
  }'
  
  print_status "Invoking function with test payload..."
  
  INVOKE_RESULT=$(aws --endpoint-url="$LOCALSTACK_ENDPOINT" lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --payload "$TEST_PAYLOAD" \
    --region "$AWS_REGION" \
    /tmp/lambda-response.json 2>&1)
  
  if [ $? -eq 0 ]; then
    print_success "Lambda invocation successful"
    
    if [ -f /tmp/lambda-response.json ]; then
      print_status "Response:"
      cat /tmp/lambda-response.json | jq . 2>/dev/null || cat /tmp/lambda-response.json
      rm -f /tmp/lambda-response.json
    fi
  else
    print_warning "Lambda invocation may have failed"
    echo "$INVOKE_RESULT"
  fi
}

# Get function info
get_function_info() {
  print_status "Getting function information..."
  
  aws --endpoint-url="$LOCALSTACK_ENDPOINT" lambda get-function \
    --function-name "$FUNCTION_NAME" \
    --region "$AWS_REGION" \
    --query '{FunctionName:Configuration.FunctionName,Runtime:Configuration.Runtime,Handler:Configuration.Handler,CodeSize:Configuration.CodeSize,LastModified:Configuration.LastModified}' \
    --output table 2>/dev/null || print_warning "Could not retrieve function info"
}

# Cleanup temporary files
cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

# Main execution
main() {
  echo "======================================"
  echo "🚀 Deploying Gatekeeper Agent to LocalStack Lambda"
  echo "======================================"
  
  # Set trap for cleanup
  trap cleanup EXIT
  
  check_prerequisites
  setup_aws_credentials
  
  # Build and deploy
  ZIP_FILE=$(build_lambda_package)
  deploy_lambda "$ZIP_FILE"
  
  # Test the deployment
  test_lambda
  get_function_info
  
  echo ""
  echo "======================================"
  echo "📋 Deployment Information"
  echo "======================================"
  echo "Function Name: $FUNCTION_NAME"
  echo "LocalStack Endpoint: $LOCALSTACK_ENDPOINT"
  echo "AWS Region: $AWS_REGION"
  echo ""
  echo "======================================"
  echo "🔧 Next Steps"
  echo "======================================"
  echo "1. View function logs:"
  echo "   aws --endpoint-url=$LOCALSTACK_ENDPOINT logs describe-log-groups --region $AWS_REGION"
  echo ""
  echo "2. Invoke function directly:"
  echo "   aws --endpoint-url=$LOCALSTACK_ENDPOINT lambda invoke \\"
  echo "     --function-name $FUNCTION_NAME \\"
  echo "     --payload '{\"test\": true}' \\"
  echo "     --region $AWS_REGION response.json"
  echo ""
  echo "3. Update Control Plane to use Lambda mode:"
  echo "   export AGENT_MODE=lambda"
  echo "   export LAMBDA_ENDPOINT=$LOCALSTACK_ENDPOINT"
  echo "   export LAMBDA_FUNCTION_NAME=$FUNCTION_NAME"
  echo ""
  
  print_success "Lambda deployment completed!"
}

# Run main function
main "$@"