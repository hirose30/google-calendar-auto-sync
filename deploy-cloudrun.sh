#!/bin/bash
set -e

# Configuration
PROJECT_ID="sg-general-ops"
REGION="asia-northeast1"  # Tokyo region
SERVICE_NAME="calendar-sync"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting deployment to Cloud Run...${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI not found. Please install it first."
    echo "https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set project
echo -e "${BLUE}Setting GCP project to ${PROJECT_ID}...${NC}"
gcloud config set project ${PROJECT_ID}

# Build Docker image for amd64 (Cloud Run platform)
echo -e "${BLUE}Building Docker image for linux/amd64...${NC}"
docker buildx build --platform linux/amd64 -t ${IMAGE_NAME}:latest --push .

# Deploy to Cloud Run
echo -e "${BLUE}Deploying to Cloud Run...${NC}"
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 80 \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "SPREADSHEET_ID=SPREADSHEET_ID:latest" \
  --set-secrets "SERVICE_ACCOUNT_KEY=SERVICE_ACCOUNT_KEY:latest"

# Get service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --format 'value(status.url)')

echo -e "${GREEN}Deployment successful!${NC}"
echo -e "${GREEN}Service URL: ${SERVICE_URL}${NC}"
echo -e "${GREEN}Webhook URL: ${SERVICE_URL}/webhook${NC}"
echo -e "${GREEN}Health check: ${SERVICE_URL}/health${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Update .env with WEBHOOK_URL=${SERVICE_URL}/webhook"
echo "2. Restart the service to register new watch channels"
echo "3. Test with: curl ${SERVICE_URL}/health"
