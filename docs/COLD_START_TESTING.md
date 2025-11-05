# Cold Start Testing Guide

This document outlines how to test cold start behavior when running with `minScale=0`.

## Prerequisites

- Service deployed with Firestore integration
- minScale changed to 0
- Cloud Run deployed successfully

## Test Procedure

### 1. Verify Service Scales Down

Wait 15 minutes without any activity (no HTTP requests to the service).

```bash
# Check if service has scaled to zero
gcloud run services describe calendar-sync \
  --region asia-northeast1 \
  --format="value(status.traffic[0].revisionName)"
```

After 15 minutes of inactivity, the service should have no active instances.

### 2. Trigger Cold Start with Webhook

Create a calendar event to trigger a webhook notification:

1. Go to Google Calendar
2. Create a new event in one of the monitored calendars
3. Observe the cold start process

### 3. Monitor Cold Start Timing

Check service logs for startup performance:

```bash
gcloud logging read \
  "resource.type=cloud_run_revision \
   AND resource.labels.service_name=calendar-sync \
   AND jsonPayload.operation=start" \
  --limit=5 \
  --format="value(timestamp,jsonPayload.duration,jsonPayload.context.startupPerformance)"
```

### 4. Verify Success Criteria

**Target**: Cold start completes within 5 seconds

**Metrics to check**:
- Total startup time (from logs)
- First webhook processing time
- Firestore initialization time
- Channel restoration time

### 5. Performance Baseline

Expected cold start breakdown:
- Express server start: ~500ms
- Firestore init (lazy): ~50ms
- Load user mappings: ~1-2s
- Restore channels from Firestore: ~200-500ms
- **Total**: 2-3 seconds (well within 5s target)

## Troubleshooting

### Cold Start > 5 Seconds

If cold start exceeds 5 seconds:

1. Check Firestore query performance:
   ```bash
   gcloud logging read "jsonPayload.operation=ChannelStore.loadAllChannels" \
     --limit=5 \
     --format="value(timestamp,jsonPayload.duration)"
   ```

2. Check Spreadsheet loading time:
   ```bash
   gcloud logging read "jsonPayload.operation=refreshUserMappings" \
     --limit=5 \
     --format="value(timestamp,jsonPayload.duration)"
   ```

3. Optimize:
   - Reduce Spreadsheet rows
   - Add Firestore indexes
   - Consider lazy loading non-critical operations

### Webhook Failures During Cold Start

If webhooks fail during cold start:

1. Check Google Calendar retry logs
2. Verify webhook endpoint returns 200 OK
3. Increase Cloud Run timeout if needed

## Rollback

If cold start performance is unacceptable:

```bash
# Revert to minScale=1
gcloud run services update calendar-sync \
  --region asia-northeast1 \
  --min-instances=1
```

This immediately restores always-on behavior while maintaining Firestore integration.

## Success Indicators

✅ Cold start completes in < 5 seconds (p95)
✅ Webhooks processed successfully after cold start
✅ No errors in Firestore operations
✅ Channel count matches expected (9 channels)
✅ Service scales to 0 after 15 minutes idle
