#!/bin/bash

# Google Cloud Run deployment script for calendar-sync service
# This is an EXAMPLE file - copy to deploy-cloudrun.sh and configure

set -e

# Configuration
PROJECT_ID="${PROJECT_ID:-YOUR_PROJECT_ID}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-calendar-sync}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Deployment options
MIN_INSTANCES="${MIN_INSTANCES:-1}"  # Set to 0 for cost optimization after Firestore is configured
MAX_INSTANCES="${MAX_INSTANCES:-1}"
MEMORY="${MEMORY:-512Mi}"
CPU="${CPU:-1}"
TIMEOUT="${TIMEOUT:-300}"

# Secrets (must be created in Secret Manager)
SPREADSHEET_ID_SECRET="${SPREADSHEET_ID_SECRET:-SPREADSHEET_ID}"
SERVICE_ACCOUNT_KEY_SECRET="${SERVICE_ACCOUNT_KEY_SECRET:-SERVICE_ACCOUNT_KEY}"

echo "🚀 Deploying ${SERVICE_NAME} to Google Cloud Run"
echo "  Project: ${PROJECT_ID}"
echo "  Region: ${REGION}"
echo "  Min instances: ${MIN_INSTANCES}"
echo "  Max instances: ${MAX_INSTANCES}"

# Build and push Docker image
echo "📦 Building Docker image..."
docker buildx build --platform linux/amd64 -t "${IMAGE_NAME}:latest" --push .

# Deploy to Cloud Run
echo "🌐 Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}:latest" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory "${MEMORY}" \
  --cpu "${CPU}" \
  --timeout "${TIMEOUT}" \
  --min-instances "${MIN_INSTANCES}" \
  --max-instances "${MAX_INSTANCES}" \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "SPREADSHEET_ID=${SPREADSHEET_ID_SECRET}:latest" \
  --set-secrets "SERVICE_ACCOUNT_KEY=${SERVICE_ACCOUNT_KEY_SECRET}:latest" \
  --project "${PROJECT_ID}"

# Get service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --format='value(status.url)' \
  --project "${PROJECT_ID}")

echo "✅ Deployment complete!"
echo "  Service URL: ${SERVICE_URL}"
echo "  Health check: ${SERVICE_URL}/health"
echo ""
echo "⚙️  Configuration:"
echo "  - minScale=${MIN_INSTANCES} (cost optimization: set to 0 after Firestore setup)"
echo "  - maxScale=${MAX_INSTANCES}"
echo "  - Memory: ${MEMORY}"
echo "  - CPU: ${CPU}"
echo ""
echo "📝 Next steps:"
if [ "${MIN_INSTANCES}" -eq "1" ]; then
  echo "  1. Verify service is working: curl ${SERVICE_URL}/health"
  echo "  2. Check Firestore integration: monitor logs for 'Firestore' messages"
  echo "  3. After 24 hours of stable operation, change MIN_INSTANCES=0 for cost savings"
else
  echo "  1. Verify cold start performance: monitor startup time in logs"
  echo "  2. Test webhook delivery after idle period (15 minutes)"
  echo "  3. Monitor Cloud Run metrics for instance scaling behavior"
fi
