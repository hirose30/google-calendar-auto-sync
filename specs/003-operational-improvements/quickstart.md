# Quickstart: Operational Improvements Deployment

**Feature**: 003-operational-improvements
**Estimated Time**: 30-45 minutes
**Prerequisites**: Existing google-calendar-auto-sync service deployed and working

## Overview

This guide walks through deploying the operational improvements feature, which adds:
- Persistent webhook subscription state (Firestore)
- On-demand service activation (minScale=0)
- Automated subscription renewal (Cloud Scheduler)

Expected outcomes:
- 87% cost reduction ($25/month → $3/month)
- 99.9% webhook subscription availability
- Zero manual subscription management

## Prerequisites

- ✅ Existing service deployed with Watch Channels working
- ✅ `gcloud` CLI installed and authenticated
- ✅ Google Cloud project with billing enabled
- ✅ Service account with Calendar API + Sheets API access
- ✅ Admin access to Google Cloud Console

## Step 1: Enable Firestore (5 minutes)

**1.1 Check if Firestore already enabled:**
```bash
gcloud firestore databases list --project=YOUR_PROJECT_ID
```

If output shows existing database, skip to Step 1.3.

**1.2 Enable Firestore API and create database:**
```bash
# Enable API
gcloud services enable firestore.googleapis.com --project=YOUR_PROJECT_ID

# Create Firestore database in Native mode
gcloud firestore databases create \
  --location=asia-northeast1 \
  --type=firestore-native \
  --project=YOUR_PROJECT_ID
```

**1.3 Create Firestore indexes:**
```bash
# Index for renewal queries (expiration + status)
gcloud firestore indexes composite create \
  --collection-group=watchChannels \
  --query-scope=COLLECTION \
  --field-config field-path=status,order=ASCENDING \
  --field-config field-path=expiration,order=ASCENDING \
  --project=YOUR_PROJECT_ID

# Single-field index on expiration
gcloud firestore indexes fields update expiration \
  --collection-group=watchChannels \
  --enable-indexes \
  --project=YOUR_PROJECT_ID
```

**Expected output**: "Created index" or "Index already exists"

**Verification:**
```bash
gcloud firestore indexes composite list --project=YOUR_PROJECT_ID
```

---

## Step 2: Grant Firestore Permissions (2 minutes)

**2.1 Get Cloud Run service account email:**
```bash
# If using default compute service account
PROJECT_NUM=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")
SA_EMAIL="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

echo "Service Account: ${SA_EMAIL}"
```

**2.2 Grant Firestore access:**
```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user"
```

**Expected output**: "Updated IAM policy for project"

**Verification:**
```bash
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:${SA_EMAIL}" \
  --format="table(bindings.role)"
```

Should show `roles/datastore.user`.

---

## Step 3: Update Application Code (10 minutes)

**3.1 Install Firestore client library:**
```bash
cd /path/to/google-calendar-auto-sync
npm install @google-cloud/firestore@^7.1.0
```

**3.2 Build updated application:**
```bash
npm run build
```

**Expected output**: TypeScript compilation success, no errors

**3.3 Run tests (optional but recommended):**
```bash
npm test
```

**Expected output**: All tests passing

---

## Step 4: Deploy to Cloud Run (10 minutes)

**4.1 Build and push Docker image:**
```bash
# Set variables
PROJECT_ID="YOUR_PROJECT_ID"
REGION="asia-northeast1"
SERVICE_NAME="calendar-sync"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Build for Cloud Run (linux/amd64)
docker buildx build --platform linux/amd64 -t ${IMAGE_NAME}:latest --push .
```

**Expected output**: "Successfully built" and "Successfully tagged"

**4.2 Deploy with minScale=1 (keep existing setting for now):**
```bash
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
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "SPREADSHEET_ID=SPREADSHEET_ID:latest" \
  --set-secrets "SERVICE_ACCOUNT_KEY=SERVICE_ACCOUNT_KEY:latest"
```

**Expected output**: "Service [calendar-sync] revision [...] has been deployed"

**4.3 Get service URL:**
```bash
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --format='value(status.url)')

echo "Service URL: ${SERVICE_URL}"
```

---

## Step 5: Verify Firestore Integration (5 minutes)

**5.1 Check service logs for Firestore initialization:**
```bash
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=calendar-sync \
  AND jsonPayload.message=~'Firestore'" \
  --limit=10 \
  --format="value(timestamp,jsonPayload.message)"
```

**Expected output**: Logs showing "Firestore client initialized" or similar

**5.2 Force channel registration to populate Firestore:**
```bash
curl -X POST ${SERVICE_URL}/admin/force-register-channels \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Initial Firestore population"}'
```

**Expected output**: JSON showing channels registered

**5.3 Verify channels in Firestore:**
```bash
# Via gcloud (admin access required)
gcloud firestore documents list watchChannels --limit=10 \
  --format="table(name,createTime,updateTime)"
```

**Expected output**: List of 9 watch channel documents

---

## Step 6: Configure Cloud Scheduler (10 minutes)

**6.1 Enable Cloud Scheduler API:**
```bash
gcloud services enable cloudscheduler.googleapis.com --project=YOUR_PROJECT_ID
```

**6.2 Create service account for Cloud Scheduler:**
```bash
gcloud iam service-accounts create cloud-scheduler-sa \
  --display-name="Cloud Scheduler Service Account" \
  --project=YOUR_PROJECT_ID

SCHEDULER_SA_EMAIL="cloud-scheduler-sa@${PROJECT_ID}.iam.gserviceaccount.com"
```

**6.3 Grant Cloud Run invoker role:**
```bash
gcloud run services add-iam-policy-binding calendar-sync \
  --region=${REGION} \
  --member="serviceAccount:${SCHEDULER_SA_EMAIL}" \
  --role="roles/run.invoker" \
  --project=YOUR_PROJECT_ID
```

**6.4 Create renewal job (daily at 3 AM JST = 18:00 UTC previous day):**
```bash
gcloud scheduler jobs create http renew-watch-channels \
  --location=${REGION} \
  --schedule="0 18 * * *" \
  --uri="${SERVICE_URL}/admin/renew-expiring-channels" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA_EMAIL}" \
  --oidc-token-audience="${SERVICE_URL}" \
  --project=YOUR_PROJECT_ID
```

**6.5 Create health check job (every 6 hours):**
```bash
gcloud scheduler jobs create http health-check \
  --location=${REGION} \
  --schedule="0 */6 * * *" \
  --uri="${SERVICE_URL}/health" \
  --http-method=GET \
  --oidc-service-account-email="${SCHEDULER_SA_EMAIL}" \
  --oidc-token-audience="${SERVICE_URL}" \
  --project=YOUR_PROJECT_ID
```

**Expected output**: "Created job [...]"

**6.6 Manually trigger renewal job to test:**
```bash
gcloud scheduler jobs run renew-watch-channels \
  --location=${REGION} \
  --project=YOUR_PROJECT_ID
```

**Expected output**: "Triggered job [...]"

**6.7 Check job execution result:**
```bash
# Wait 30 seconds for job to complete
sleep 30

# Check logs
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=calendar-sync \
  AND jsonPayload.message=~'renew'" \
  --limit=5 \
  --format="value(timestamp,jsonPayload.message)"
```

**Expected output**: Logs showing renewal job executed

---

## Step 7: Change to minScale=0 (Cost Optimization) (5 minutes)

**7.1 Update service to minScale=0:**
```bash
gcloud run services update calendar-sync \
  --region=${REGION} \
  --min-instances=0 \
  --project=YOUR_PROJECT_ID
```

**Expected output**: "Service [calendar-sync] revision [...] has been deployed and is serving 100 percent of traffic"

**7.2 Wait 15 minutes for service to scale down (test cold start):**
```bash
echo "Waiting 15 minutes for service to scale to zero..."
sleep 900  # 15 minutes

# Check current instance count (should be 0)
gcloud run services describe calendar-sync \
  --region=${REGION} \
  --format="value(status.traffic[0].revisionName)"
```

**7.3 Trigger a webhook to test cold start:**
```bash
# Manual test: Create a test calendar event in Google Calendar
# Observe service logs for cold start timing
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=calendar-sync \
  AND jsonPayload.message=~'Webhook'" \
  --limit=5 \
  --format="value(timestamp,jsonPayload.message,jsonPayload.duration)"
```

**Expected output**: Webhook processed within 5 seconds (including cold start)

---

## Step 8: Verify Cost Reduction (Monitor over 7 days)

**8.1 Check Cloud Run costs before/after:**
```bash
# Current date
echo "Deployment date: $(date)"
echo "Check billing dashboard in 7 days to verify cost reduction"
echo "Expected: $25/month → $3/month (87% reduction)"
```

**8.2 Set up billing alert (optional):**
```bash
# Navigate to Cloud Console > Billing > Budgets & Alerts
# Create alert for "Cloud Run" service
# Threshold: $5/month (should stay well below this)
```

---

## Verification Checklist

After deployment, verify all components:

- [ ] **Firestore**: Database created and indexes built
- [ ] **Permissions**: Service account has `roles/datastore.user`
- [ ] **Deployment**: Service deployed successfully with Firestore client
- [ ] **Channel Registration**: `/admin/force-register-channels` populated Firestore
- [ ] **Firestore Data**: 9 watch channel documents visible in Firestore
- [ ] **Scheduler Jobs**: Two jobs created (renewal + health check)
- [ ] **Job Execution**: Manual trigger of renewal job succeeded
- [ ] **minScale=0**: Service scaled down after 15 minutes idle
- [ ] **Cold Start**: Webhook processing works after cold start (<5s)
- [ ] **Logs**: Structured JSON logs show Firestore operations

---

## Rollback Plan

If issues occur, revert to previous state:

**Immediate rollback (revert to minScale=1):**
```bash
gcloud run services update calendar-sync \
  --region=${REGION} \
  --min-instances=1 \
  --project=YOUR_PROJECT_ID
```

**Full rollback (disable Firestore):**
```bash
# Redeploy previous version (without Firestore code)
docker pull gcr.io/${PROJECT_ID}/${SERVICE_NAME}:previous-tag

gcloud run deploy calendar-sync \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:previous-tag \
  --region=${REGION} \
  --min-instances=1
```

**Service continues working**: In-memory ChannelRegistry still functions, Firestore is optional.

---

## Monitoring

**Daily monitoring tasks (first 7 days):**

1. **Check scheduled jobs executed:**
   ```bash
   gcloud scheduler jobs describe renew-watch-channels \
     --location=${REGION} \
     --format="value(status.lastAttemptTime)"
   ```

2. **Verify webhook subscriptions active:**
   ```bash
   curl ${SERVICE_URL}/admin/channel-status \
     -H "Authorization: Bearer $(gcloud auth print-identity-token)"
   ```

3. **Review service logs for errors:**
   ```bash
   gcloud logging read "resource.type=cloud_run_revision \
     AND resource.labels.service_name=calendar-sync \
     AND severity>=ERROR" \
     --limit=10 \
     --format="value(timestamp,jsonPayload.message)"
   ```

4. **Check billing trends:**
   - Cloud Console > Billing > Cost Table
   - Filter: Service = "Cloud Run"
   - Verify daily cost decreasing

---

## Troubleshooting

### Issue: "Firestore database not found"

**Solution:**
```bash
# Verify Firestore created
gcloud firestore databases describe --project=YOUR_PROJECT_ID

# If not exists, create database
gcloud firestore databases create --location=asia-northeast1 --project=YOUR_PROJECT_ID
```

### Issue: "Permission denied on Firestore"

**Solution:**
```bash
# Re-grant permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user"
```

### Issue: "Scheduler job failed to authenticate"

**Solution:**
```bash
# Verify Cloud Scheduler SA has run.invoker role
gcloud run services get-iam-policy calendar-sync \
  --region=${REGION} \
  --format=json | grep cloud-scheduler-sa
```

### Issue: "Cold start exceeds 5 seconds"

**Solution:**
```bash
# Check service logs for Firestore init time
gcloud logging read "jsonPayload.message=~'Firestore' AND jsonPayload.duration" \
  --limit=10

# If Firestore slow, consider caching strategy or pre-warming
```

### Issue: "Watch channels not being renewed"

**Solution:**
```bash
# Manually trigger renewal job
gcloud scheduler jobs run renew-watch-channels --location=${REGION}

# Check admin endpoint directly
curl -X POST ${SERVICE_URL}/admin/renew-expiring-channels \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d '{"dryRun": true}'
```

---

## Next Steps

After successful deployment:

1. **Monitor for 7 days**: Verify cost reduction and stability
2. **Set up alerts**: Cloud Monitoring for errors and job failures
3. **Document runbook**: Operator procedures for common issues
4. **Review logs**: Confirm structured logging sufficient for troubleshooting

---

## Summary

**What was deployed:**
- ✅ Firestore for persistent webhook subscription state
- ✅ Cloud Scheduler for automated renewal (daily) and health checks (6 hours)
- ✅ Admin endpoints for manual subscription management
- ✅ minScale=0 for on-demand activation (87% cost reduction)

**Expected results:**
- Monthly cost: $25 → $3 (87% reduction)
- Subscription availability: 99.9%+ (automated renewal)
- Cold start: <5 seconds (p95)
- Zero manual operations (fully automated)

**If issues occur:**
- Rollback to minScale=1 immediately
- Service continues functioning (Firestore optional)
- Contact support with service logs
