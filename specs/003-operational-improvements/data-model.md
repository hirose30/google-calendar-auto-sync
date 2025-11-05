# Data Model: Webhook Subscription Persistence

**Feature**: 003-operational-improvements
**Date**: 2025-11-03

## Overview

This document defines the persistent data model for webhook subscription state. The goal is to enable service restarts without losing subscription registrations, supporting minScale=0 operation while maintaining 99.9% webhook availability.

## Entity: Webhook Subscription

**Purpose**: Represents an active Google Calendar push notification channel that delivers calendar change events to our service.

**Lifecycle**: Created when Watch Channel is registered, renewed before expiration, stopped when no longer needed or user removed from configuration.

**Persistence**: Firestore collection `watchChannels`

### Fields

| Field | Type | Required | Indexed | Description |
|-------|------|----------|---------|-------------|
| `channelId` | string | Yes | Primary Key | Unique identifier for this watch channel (document ID). Format: `calendar-sync-{sanitized-email}-{timestamp}`. Assigned by our service, validated by Google Calendar API. |
| `resourceId` | string | Yes | No | Google Calendar API resource identifier for this channel. Opaque string returned by Calendar API during registration. Required for stopping channels. |
| `calendarId` | string | Yes | Yes | Email address of the calendar being monitored (e.g., `user@hoge.jp`). Used to associate channels with user mappings. |
| `expiration` | number | Yes | Yes | Unix timestamp in milliseconds when this channel expires. Google Calendar channels expire after 7 days. Must be renewed before this time to maintain coverage. |
| `registeredAt` | number | Yes | No | Unix timestamp in milliseconds when this channel was first registered. For audit trail and debugging. |
| `lastUpdatedAt` | number | Yes | No | Unix timestamp in milliseconds of last modification (renewal or status change). For staleness detection. |
| `status` | string | No | Yes | Current channel state: `active`, `expired`, `stopped`. Default: `active`. Used for filtering and health monitoring. |

### Validation Rules

```typescript
interface WatchChannelDocument {
  channelId: string;           // Regex: ^[A-Za-z0-9\\-_\\+/=]+$
  resourceId: string;          // Non-empty
  calendarId: string;          // Email format (RFC 5322)
  expiration: number;          // > Date.now() at creation
  registeredAt: number;        // Immutable after creation
  lastUpdatedAt: number;       // Updated on every write
  status: 'active' | 'expired' | 'stopped';  // Enum
}
```

**Validation Logic**:
- `channelId`: Must match Google Calendar API channel ID format (alphanumeric + `-_+/=`)
- `calendarId`: Must be valid email address (user mappings use email as key)
- `expiration`: Must be future timestamp at registration (Google assigns 7 days ahead)
- `status`: Only valid values are `active`, `expired`, `stopped`

### State Transitions

```
[Not Exists] --register()-->  [active]
                                  |
                                  | --renew()-->  [active] (expiration updated)
                                  |
                                  | --detectExpired()--> [expired]
                                  |
                                  | --stop()--> [stopped]

[expired] --reRegister()--> [active] (new channelId)

[stopped] --> [Not Exists] (document deleted)
```

**Transition Rules**:
- `register()`: Creates new document with `status=active`, `expiration=now+7days`
- `renew()`: Updates `expiration` and `lastUpdatedAt`, keeps `status=active`
- `detectExpired()`: Startup detects `expiration < now`, marks `status=expired`
- `reRegister()`: Expired channels get new channelId via Calendar API, old document remains
- `stop()`: Manual removal or orphaned subscription, marks `status=stopped` (or deletes)

### Relationships

**Watch Channel → Calendar (external)**
- One-to-one: Each channel monitors exactly one calendar
- `calendarId` references Google Calendar resource (not stored locally)

**Watch Channel → User Mapping (in-memory)**
- Many-to-one: Multiple channels can exist for one user (across different time periods)
- Joined via `calendarId` matching `primaryEmail` in UserMappingStore
- Orphaned channels: If user removed from mappings, channel becomes orphaned
  - Detection: Compare `calendarId` against current UserMappingStore.getAllPrimaries()
  - Cleanup: Automatic during renewal cycle (stop orphaned channels)

**Watch Channel → Channel Registry (in-memory)**
- Firestore is source of truth, ChannelRegistry is read cache
- On startup: Load from Firestore → populate ChannelRegistry
- On registration: Write to both Firestore + ChannelRegistry
- On renewal: Update both

### Indexes

**Index 1: Expiration (for renewal queries)**
```
Field: expiration
Order: ASC
Purpose: Find channels expiring within 24 hours
Query: WHERE expiration < (now + 24h) AND status = 'active'
```

**Index 2: Status (for filtering)**
```
Field: status
Order: ASC
Purpose: Filter active/expired/stopped channels
Query: WHERE status = 'active'
```

**Index 3: Composite (future optimization)**
```
Fields: calendarId (ASC), expiration (ASC)
Purpose: Calendar-specific expiration queries (not used in MVP)
Query: WHERE calendarId = 'user@hoge.jp' AND expiration < X
```

**Rationale**: Single-field indexes sufficient for current queries. Composite index prepared for future per-calendar queries.

### Query Patterns

**Startup: Load all active channels**
```typescript
const activeChannels = await db.collection('watchChannels')
  .where('status', '==', 'active')
  .get();

// Result: All channels with status=active
// Used to populate ChannelRegistry
```

**Renewal: Find expiring soon**
```typescript
const expiringThreshold = Date.now() + 86400000; // 24 hours
const expiring = await db.collection('watchChannels')
  .where('status', '==', 'active')
  .where('expiration', '<', expiringThreshold)
  .get();

// Result: Active channels expiring within 24 hours
// Used by scheduled renewal job
```

**Status Dashboard: Get all channels**
```typescript
const allChannels = await db.collection('watchChannels')
  .orderBy('expiration', 'asc')
  .get();

// Result: All channels sorted by expiration
// Used by /admin/channel-status endpoint
```

**Lookup by ID: Get specific channel**
```typescript
const channel = await db.collection('watchChannels')
  .doc(channelId)
  .get();

// Result: Single channel document
// Used for renewal and stop operations
```

### Atomic Operations

**Registration (Create or Update)**
```typescript
async function registerChannel(channel: WatchChannelDocument): Promise<void> {
  const docRef = db.collection('watchChannels').doc(channel.channelId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);

    if (doc.exists) {
      // Channel already exists, update expiration
      transaction.update(docRef, {
        expiration: channel.expiration,
        lastUpdatedAt: Date.now(),
        status: 'active'
      });
    } else {
      // New channel
      transaction.set(docRef, {
        ...channel,
        registeredAt: Date.now(),
        lastUpdatedAt: Date.now(),
        status: 'active'
      });
    }
  });
}
```

**Renewal (Update)**
```typescript
async function renewChannel(channelId: string, newExpiration: number): Promise<void> {
  await db.collection('watchChannels').doc(channelId).update({
    expiration: newExpiration,
    lastUpdatedAt: Date.now(),
    status: 'active'  // Reset to active if previously expired
  });
}
```

**Deletion (Stop)**
```typescript
async function stopChannel(channelId: string): Promise<void> {
  // Option 1: Mark as stopped (preserves audit trail)
  await db.collection('watchChannels').doc(channelId).update({
    status: 'stopped',
    lastUpdatedAt: Date.now()
  });

  // Option 2: Delete document (cleaner, loses history)
  await db.collection('watchChannels').doc(channelId).delete();
}
```

**Rationale**: Transactions ensure atomicity for create-or-update. Simple updates don't need transaction overhead. Deletion choice depends on audit requirements (mark stopped vs delete).

### Performance Characteristics

**Write Latency**: ~50-100ms (Firestore p50)
- Registration: Create document
- Renewal: Update single field
- Stop: Delete document

**Read Latency**: ~10-50ms (Firestore p50 for cached reads)
- Startup load: Read all active channels (9-100 docs)
- Renewal query: Read channels WHERE expiration < threshold

**Storage Cost**: ~$0.01/month for 100 documents (well within free tier)

**Query Cost**: ~$0.06/million document reads (free tier: 50k reads/day)
- Startup: 9-100 reads/restart
- Renewal: 9-100 reads/day (once daily)
- Total: < 1000 reads/day (well within free tier)

### Data Retention Policy

**Active Channels**: Retained indefinitely (source of truth for active subscriptions)

**Expired Channels**: Retained until manually cleaned up or re-registered with new channelId
- Rationale: Audit trail for debugging, historical channel state

**Stopped Channels**: Two options:
1. Retain with `status=stopped` (audit trail)
2. Delete immediately (cleaner)
- Recommendation: Delete on stop (simplifies queries, reduces storage)

**Cleanup Process**: Manual cleanup script (future enhancement)
```typescript
// Delete expired channels older than 30 days
const cutoff = Date.now() - (30 * 86400000);
const old = await db.collection('watchChannels')
  .where('status', '==', 'expired')
  .where('lastUpdatedAt', '<', cutoff)
  .get();

for (const doc of old.docs) {
  await doc.ref.delete();
}
```

## Entity: Renewal Schedule (Cloud Scheduler Configuration)

**Purpose**: Defines scheduled tasks for automated subscription renewal and health monitoring.

**Persistence**: Google Cloud Scheduler job definitions (infrastructure, not application data model)

### Jobs

**Job 1: Renewal**
- Name: `renew-watch-channels`
- Schedule: `0 18 * * *` (daily at 3 AM JST = 18:00 UTC previous day)
- Target: `POST /admin/renew-expiring-channels`
- Timeout: 60 seconds
- Retry: 3 attempts with exponential backoff

**Job 2: Health Check**
- Name: `health-check`
- Schedule: `0 */6 * * *` (every 6 hours)
- Target: `GET /health`
- Timeout: 30 seconds
- Retry: 3 attempts with exponential backoff

**Rationale**: Separate jobs for distinct concerns. Renewal is critical (daily), health check is informational (every 6 hours).

## Data Migration

**Initial State**: No Firestore documents exist

**Migration Steps**:
1. Deploy service with Firestore integration enabled
2. Service starts, ChannelRegistry is empty
3. Existing watch channels continue delivering webhooks (no interruption)
4. Service does NOT know about existing channels (registry empty)
5. Two options:
   - **Option A (recommended)**: Call `/admin/force-register-channels` to stop old channels and register new ones, saving to Firestore
   - **Option B**: Wait for existing channels to expire (7 days), service registers new ones on next startup

**Backfill Strategy (Option A)**:
```bash
# After deployment
curl -X POST https://SERVICE_URL/admin/force-register-channels \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"

# Result: All channels re-registered and saved to Firestore
```

**Rationale**: Force re-registration ensures immediate Firestore population. Old channels are stopped cleanly.

## Consistency Guarantees

**Firestore → ChannelRegistry**:
- Eventually consistent (Firestore writes, then registry updated)
- Acceptable: Registry acts as read cache, Firestore is source of truth

**ChannelRegistry → Firestore**:
- Write-through: Both updated on registration/renewal
- Failure handling: If Firestore write fails, registry update aborted, retry with backoff

**Concurrent Writes**:
- Scenario: Multiple instances (during scaling) attempt to register same channel
- Protection: channelId is unique key (Firestore document ID)
- Result: Last write wins (safe, both writes use same expiration from Calendar API)

## Summary

- **Primary Entity**: Webhook Subscription (Firestore collection `watchChannels`)
- **Fields**: channelId (PK), resourceId, calendarId, expiration, registeredAt, lastUpdatedAt, status
- **Indexes**: expiration (ASC), status (ASC), composite calendar+expiration
- **Queries**: Startup load, renewal find expiring, status dashboard
- **Atomic Operations**: Transaction for create-or-update, simple update for renewal
- **Performance**: <100ms writes, <50ms reads, <$1/month cost for 100 channels
- **Migration**: Force re-registration to populate Firestore
- **Consistency**: Write-through to Firestore + registry, last-write-wins for conflicts
