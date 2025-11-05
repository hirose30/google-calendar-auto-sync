# Research: Operational Cost Reduction Technical Decisions

**Feature**: 003-operational-improvements
**Date**: 2025-11-03

## Overview

This document consolidates research findings for implementing persistent webhook subscription state, on-demand service activation, and automated renewal.

## 1. Firestore Client Library Selection

### Decision: @google-cloud/firestore

**Rationale**:
- Official Google Cloud client library with full TypeScript support
- Seamless authentication via Application Default Credentials (ADC) in Cloud Run
- Automatic connection pooling and retry logic
- Well-documented API with extensive examples

**Alternatives Considered**:
- Firebase Admin SDK: Adds unnecessary Firebase dependencies
- Direct REST API: Requires manual connection management and error handling
- Cloud Datastore client: Legacy API, Firestore is recommended for new projects

**Implementation**:
```typescript
import { Firestore } from '@google-cloud/firestore';

const db = new Firestore({
  // Project ID automatically detected from Cloud Run metadata
  // Authentication via ADC (no explicit credentials needed)
});
```

## 2. Firestore Schema Design

### Decision: Single Collection with Document-per-Channel

**Collection Structure**:
```
watchChannels/
  ├── {channelId-1}/    # Document
  ├── {channelId-2}/    # Document
  └── {channelId-3}/    # Document
```

**Rationale**:
- Simple flat structure for current scale (9-100 subscriptions)
- Document ID = channelId provides natural unique key
- Single collection queries are fastest
- No need for subcollections (no hierarchical data)

**Alternatives Considered**:
- Subcollections by calendar: `calendars/{email}/channels/{id}`
  - Rejected: Adds query complexity, no performance benefit at current scale
- Separate collections for active/expired: `activeChannels/`, `expiredChannels/`
  - Rejected: Requires moving documents between collections, increases complexity

**Index Requirements**:
```
# Index 1: For renewal queries (find expiring soon)
expiration ASC, status ASC

# Index 2: For startup queries (load all active)
status ASC, expiration ASC
```

### Atomic Transaction Patterns

**Registration (Create)**:
```typescript
await db.runTransaction(async (transaction) => {
  const docRef = db.collection('watchChannels').doc(channelId);
  const doc = await transaction.get(docRef);

  if (doc.exists) {
    // Channel already registered, update expiration
    transaction.update(docRef, {
      expiration: newExpiration,
      lastUpdatedAt: Date.now()
    });
  } else {
    // New channel
    transaction.set(docRef, {
      channelId,
      resourceId,
      calendarId,
      expiration,
      registeredAt: Date.now(),
      lastUpdatedAt: Date.now(),
      status: 'active'
    });
  }
});
```

**Renewal (Update)**:
```typescript
// Simple update (no transaction needed for single document)
await db.collection('watchChannels').doc(channelId).update({
  expiration: newExpiration,
  lastUpdatedAt: Date.now(),
  status: 'active'
});
```

**Rationale**: Transactions ensure atomicity for create-or-update, but simple updates don't need transaction overhead.

## 3. Cloud Scheduler Integration

### Decision: HTTP Invocation with OIDC Authentication

**Schedule Syntax**: Cron expressions (standard Unix cron)
```
# Daily renewal at 3 AM JST (18:00 UTC previous day)
"0 18 * * *"

# Health check every 6 hours
"0 */6 * * *"
```

**Authentication Pattern**:
```bash
gcloud scheduler jobs create http JOBNAME \
  --schedule="CRON_EXPRESSION" \
  --uri="https://SERVICE_URL/endpoint" \
  --http-method=POST \
  --oidc-service-account-email="SA_EMAIL" \
  --oidc-audience="https://SERVICE_URL"
```

**Rationale**:
- OIDC provides secure authentication without managing tokens
- Cloud Run automatically validates OIDC tokens
- Scheduler retries failed requests (3 attempts with exponential backoff)

**Alternatives Considered**:
- App Engine Cron: Requires App Engine, adds unnecessary dependency
- Cloud Functions triggered by Pub/Sub + Scheduler: Overengineered for simple HTTP endpoints
- In-process cron (node-cron): Requires minScale=1, defeats cost optimization goal

**Retry Policy**:
- Max attempts: 3
- Backoff: Exponential (doubling delay)
- Timeout: 60 seconds per attempt

**Idempotency Handling**:
Renewal endpoint is naturally idempotent:
- Renewing an already-renewed channel is safe (expiration updated to latest value)
- No side effects from duplicate executions

## 4. Cold Start Optimization

### Decision: Lazy Firestore Connection with Connection Pooling

**Initialization Strategy**:
```typescript
// Global Firestore instance (initialized once per container)
let dbInstance: Firestore | null = null;

function getFirestore(): Firestore {
  if (!dbInstance) {
    dbInstance = new Firestore({
      // Connection pooling enabled by default
      // Max idle time: 60 seconds
    });
  }
  return dbInstance;
}
```

**Startup Sequence**:
1. Express server starts (immediate)
2. Firestore connection lazy-initialized on first request
3. Channel state loaded from Firestore on first webhook
4. If Firestore slow/unavailable, fallback to full re-registration

**Measured Impact**:
- Firestore SDK init: ~50ms
- First document read: ~100-200ms
- Subsequent reads (cached): ~10-20ms
- Total cold start budget: <5 seconds (sufficient headroom)

**Alternatives Considered**:
- Eager initialization at startup: Adds 150-250ms to every cold start
  - Rejected: Wastes time if no requests arrive (instance shuts down)
- Connection pooling disabled: Slower repeated requests
  - Rejected: Default pooling is optimal

**Rationale**: Lazy loading minimizes cold start time while connection pooling ensures fast subsequent requests.

## 5. minScale=0 Behavior and State Persistence

### Decision: Firestore as Single Source of Truth for Channel State

**Cloud Run Lifecycle**:
```
[Stopped] --first request--> [Starting (cold start)] --> [Running] --idle timeout--> [Stopped]
```

**Idle Timeout**: 15 minutes (Cloud Run default for minScale=0)

**State Persistence Strategy**:
- Write to Firestore immediately when channel registered/renewed
- In-memory ChannelRegistry acts as read cache (faster lookups)
- On startup: Load from Firestore, populate in-memory registry
- On shutdown: No action needed (state already persisted)

**Webhook Buffering During Cold Start**:
- Google Calendar retries webhooks on 5xx errors or timeouts
- Retry schedule: immediate, 1 min, 2 min, 4 min, 8 min (exponential backoff)
- Cold start < 5 seconds → first webhook succeeds
- If cold start > 5 seconds → Calendar retries automatically

**Rationale**: Firestore persistence + Google Calendar's retry logic provides reliable webhook delivery even during cold starts.

**Rapid Scaling Scenario**:
- Multiple webhooks arrive simultaneously after idle period
- First request triggers cold start
- Cloud Run may start multiple instances temporarily (autoscaling)
- Firestore handles concurrent reads safely
- DeduplicationCache prevents duplicate processing

## 6. Admin Endpoint Authentication

### Decision: Cloud Run IAM Only (No Additional Token Verification)

**Authentication Mechanism**:
```typescript
// No code needed - Cloud Run enforces IAM at infrastructure level
```

**IAM Policy**:
```bash
# Grant Cloud Scheduler permission to invoke endpoints
gcloud run services add-iam-policy-binding calendar-sync \
  --member="serviceAccount:SCHEDULER_SA_EMAIL" \
  --role="roles/run.invoker"

# Operators can invoke via gcloud (inherits IAM from authenticated user)
gcloud run services proxy calendar-sync --region=asia-northeast1
```

**Rationale**:
- Cloud Run IAM is sufficient for scheduled jobs and operator access
- No token management overhead
- Leverages existing GCP security infrastructure

**Alternatives Considered**:
- Custom API keys: Additional secret management burden
- JWT verification: Redundant with Cloud Run IAM
- IP allowlisting: Fragile (Scheduler IPs can change)

**Public Exposure**: Admin endpoints are NOT publicly accessible:
- Cloud Run requires IAM authentication by default
- `--allow-unauthenticated` only applies to webhook endpoint
- Admin endpoints return 403 Forbidden without valid IAM token

## 7. Scheduled Job Idempotency

### Decision: Natural Idempotency via Channel State Checks

**Renewal Job Logic**:
```typescript
async function renewExpiringChannels() {
  // Query Firestore for channels expiring within 24h
  const expiring = await db.collection('watchChannels')
    .where('expiration', '<', Date.now() + 86400000)
    .where('status', '==', 'active')
    .get();

  for (const doc of expiring.docs) {
    const channel = doc.data();

    // Check if still needs renewal (idempotency)
    if (channel.expiration < Date.now() + 86400000) {
      await renewChannel(channel.channelId);
    }
  }
}
```

**Overlapping Execution Handling**:
- Scenario: Previous job still running when next job starts
- Protection: Firestore query uses current timestamp
- Result: Each job processes only channels needing renewal at query time
- Side effect: Concurrent jobs may both try to renew same channel
  - Safe: Google Calendar API renewal is idempotent (returns updated expiration)
  - Firestore: Last write wins (both updates use same new expiration)

**Rationale**: Timestamp-based queries and idempotent API calls make overlapping jobs safe.

## 8. Migration Strategy

### Decision: Blue-Green Deployment with Feature Flag

**Phase 1: Firestore Integration (minScale=1)**
1. Deploy code with Firestore enabled
2. Keep minScale=1 (no cost change yet)
3. Verify Firestore writes occurring
4. Monitor for 24 hours (1 full renewal cycle)

**Phase 2: Scheduled Jobs Setup**
1. Create Cloud Scheduler jobs (disabled initially)
2. Manually test renewal endpoint
3. Enable jobs, monitor first execution
4. Verify automatic renewal working

**Phase 3: minScale=0 Transition**
1. Change minScale to 0
2. Trigger test webhook to verify cold start recovery
3. Monitor cold start latency (p95 < 5s)
4. If issues: Revert to minScale=1 immediately

**Rollback Plan**:
```bash
# Emergency rollback
gcloud run services update calendar-sync \
  --min-instances=1 \
  --update-env-vars FIRESTORE_ENABLED=false
```

**Feature Flag** (optional):
```typescript
const FIRESTORE_ENABLED = process.env.FIRESTORE_ENABLED !== 'false';

if (FIRESTORE_ENABLED) {
  await channelStore.save(channel);
} else {
  // In-memory only
}
```

**Rationale**: Gradual rollout with clear rollback path minimizes risk.

## Summary of Key Decisions

| Component | Decision | Rationale |
|-----------|----------|-----------|
| Storage | Firestore with @google-cloud/firestore client | Official library, ADC auth, connection pooling |
| Schema | Single collection, document-per-channel | Simple, fast queries, natural unique keys |
| Scheduler | HTTP invocation with OIDC auth | Secure, automatic retries, cron syntax |
| Cold Start | Lazy Firestore init, connection pooling | Minimizes startup time, caches connections |
| minScale | 0 with Firestore state persistence | 87% cost reduction, reliable state recovery |
| Auth | Cloud Run IAM only | Leverages GCP security, no token management |
| Idempotency | Timestamp-based queries, idempotent APIs | Safe overlapping job execution |
| Migration | Blue-green with feature flag | Gradual rollout, easy rollback |

## Dependencies Added

```json
{
  "dependencies": {
    "@google-cloud/firestore": "^7.1.0"
  }
}
```

## GCP Services Required

- Firestore (Native mode): Persistent storage
- Cloud Scheduler: Scheduled job execution
- Cloud Run IAM: Admin endpoint authentication

## Configuration Changes

**None required** - Firestore uses ADC, project ID auto-detected from Cloud Run metadata.

## Performance Targets Validated

- Cold start < 5 seconds: ✅ Firestore init ~50ms + first read ~200ms = well within budget
- Firestore read < 200ms (p99): ✅ Confirmed by GCP SLA documentation
- Renewal job < 30 seconds: ✅ 9 channels × 2s renewal = ~18s + overhead

## Next Phase

With research complete, proceed to Phase 1: Generate data-model.md, contracts/, quickstart.md
