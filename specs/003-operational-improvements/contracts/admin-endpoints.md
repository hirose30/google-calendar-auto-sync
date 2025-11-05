# API Contract: Admin Endpoints

**Feature**: 003-operational-improvements
**Date**: 2025-11-03

## Overview

Administrative HTTP endpoints for manual webhook subscription management, used by operators for troubleshooting and by Cloud Scheduler for automated maintenance.

## Authentication

**Method**: Cloud Run IAM with OIDC tokens

**Authorization**:
- Cloud Scheduler service account: `roles/run.invoker` on calendar-sync service
- Human operators: Authenticated via `gcloud auth` with `roles/run.invoker`

**Rejected Requests**:
- HTTP 403 Forbidden: No valid IAM token
- HTTP 401 Unauthorized: Expired or invalid OIDC token

## Endpoint 1: Renew Expiring Channels

**Purpose**: Find and renew webhook subscriptions expiring within 24 hours. Called by Cloud Scheduler daily.

### Request

**Method**: `POST`
**Path**: `/admin/renew-expiring-channels`
**Headers**:
```
Authorization: Bearer {OIDC_TOKEN}
Content-Type: application/json
```

**Body** (optional):
```json
{
  "dryRun": false,
  "expirationThreshold": 86400000  // Optional: custom threshold in milliseconds (default 24h)
}
```

**Parameters**:
- `dryRun` (boolean, optional, default: `false`): If true, return channels that would be renewed without taking action
- `expirationThreshold` (number, optional, default: `86400000`): Milliseconds from now to consider "expiring soon"

### Response

**Status**: `200 OK`

**Body**:
```json
{
  "renewed": [
    {
      "channelId": "calendar-sync-user1-hoge-jp-1730612345678",
      "calendarId": "user1@hoge.jp",
      "oldExpiration": "2025-11-10T18:00:00Z",
      "newExpiration": "2025-11-17T18:00:00Z",
      "duration": 234  // milliseconds to renew this channel
    }
  ],
  "skipped": [
    {
      "channelId": "calendar-sync-user2-hoge-jp-1730612345679",
      "calendarId": "user2@hoge.jp",
      "expiration": "2025-11-15T18:00:00Z",
      "reason": "Expiration > threshold (still 4.5 days away)"
    }
  ],
  "failed": [
    {
      "channelId": "calendar-sync-user3-hoge-jp-1730612345680",
      "calendarId": "user3@hoge.jp",
      "error": "Google Calendar API rate limit exceeded (429)",
      "retryAfter": 30  // seconds
    }
  ],
  "summary": {
    "total": 9,
    "renewed": 2,
    "skipped": 6,
    "failed": 1,
    "duration": 1234  // total milliseconds for entire operation
  }
}
```

### Error Responses

**500 Internal Server Error**: Critical failure (e.g., Firestore unavailable)
```json
{
  "error": "Failed to query Firestore",
  "message": "Connection to Firestore timed out after 5000ms",
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

**503 Service Unavailable**: Service starting up (cold start in progress)
```json
{
  "error": "Service initializing",
  "message": "Channel registry not yet loaded, retry in 5 seconds",
  "retryAfter": 5
}
```

### Behavior

1. Query Firestore for channels WHERE `expiration < (now + threshold)` AND `status = 'active'`
2. For each channel:
   - Call Google Calendar API `channels.stop()` with old channelId
   - Call Google Calendar API `events.watch()` to register new channel
   - Update Firestore with new expiration
   - Update in-memory ChannelRegistry
3. Collect results (renewed/skipped/failed)
4. Return summary

**Idempotency**: Safe to call multiple times. Already-renewed channels will be skipped (expiration > threshold).

**Concurrency**: If multiple requests arrive simultaneously, Firestore queries use "now" timestamp, so each request processes channels needing renewal at query time. Duplicate renewals are safe (Google Calendar API returns new expiration, Firestore last-write-wins).

---

## Endpoint 2: Force Register Channels

**Purpose**: Stop all existing webhook subscriptions and re-register from current user mappings. Used for troubleshooting and manual migration.

### Request

**Method**: `POST`
**Path**: `/admin/force-register-channels`
**Headers**:
```
Authorization: Bearer {OIDC_TOKEN}
Content-Type: application/json
```

**Body** (optional):
```json
{
  "reason": "Manual troubleshooting - investigating missing webhooks"
}
```

**Parameters**:
- `reason` (string, optional): Human-readable explanation, logged for audit trail

### Response

**Status**: `200 OK`

**Body**:
```json
{
  "stopped": 9,
  "registered": 9,
  "failed": [],
  "channels": [
    {
      "channelId": "calendar-sync-user1-hoge-jp-1730615678901",
      "calendarId": "user1@hoge.jp",
      "expiration": "2025-11-17T18:00:00Z",
      "registered": true
    },
    {
      "channelId": "calendar-sync-user2-hoge-jp-1730615678902",
      "calendarId": "user2@hoge.jp",
      "expiration": "2025-11-17T18:00:00Z",
      "registered": true
    }
  ],
  "summary": {
    "reason": "Manual troubleshooting - investigating missing webhooks",
    "stopped": 9,
    "registered": 9,
    "failed": 0,
    "duration": 2345  // milliseconds
  },
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

### Error Responses

**500 Internal Server Error**: Critical failure
```json
{
  "error": "Failed to stop existing channels",
  "message": "Google Calendar API returned 500 Internal Server Error",
  "channelsStopped": 5,
  "channelsRegistered": 0,
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

### Behavior

1. Load all active channels from Firestore
2. Stop each channel via Google Calendar API `channels.stop()`
3. Delete or mark stopped in Firestore
4. Load current user mappings from UserMappingStore
5. For each primary user email:
   - Register new watch channel via Calendar API `events.watch()`
   - Save to Firestore
   - Add to in-memory ChannelRegistry
6. Return summary

**Idempotency**: NOT fully idempotent (stopping channels is destructive). However, safe to retry on partial failure (already-stopped channels return 404, which is ignored).

**Use Cases**:
- Migration: Populate Firestore after initial deployment
- Troubleshooting: Suspected stale channels causing missed webhooks
- Recovery: After Firestore data loss or corruption

---

## Endpoint 3: Channel Status

**Purpose**: Display current webhook subscription status. Used by operators for monitoring and by health dashboards.

### Request

**Method**: `GET`
**Path**: `/admin/channel-status`
**Headers**:
```
Authorization: Bearer {OIDC_TOKEN}
```

**Query Parameters** (optional):
- `format` (string, optional, default: `json`): Output format (`json` or `table`)
- `filter` (string, optional): Filter by status (`active`, `expired`, `stopped`, `all`)

### Response

**Status**: `200 OK`

**Body** (`format=json`):
```json
{
  "channels": [
    {
      "channelId": "calendar-sync-user1-hoge-jp-1730612345678",
      "calendarId": "user1@hoge.jp",
      "expiration": "2025-11-10T18:00:00Z",
      "expiresIn": "6d 12h 34m",
      "status": "active",
      "registeredAt": "2025-11-03T18:00:00Z",
      "lastUpdatedAt": "2025-11-03T18:00:00Z"
    },
    {
      "channelId": "calendar-sync-user2-hoge-jp-1730612345679",
      "calendarId": "user2@hoge.jp",
      "expiration": "2025-11-04T18:00:00Z",
      "expiresIn": "18h 34m",
      "status": "active",
      "registeredAt": "2025-10-28T18:00:00Z",
      "lastUpdatedAt": "2025-11-03T18:00:00Z",
      "warning": "Expiring within 24 hours"
    }
  ],
  "summary": {
    "total": 9,
    "active": 8,
    "expiringSoon": 2,  // < 24 hours
    "expired": 1,
    "stopped": 0
  },
  "health": {
    "firestoreConnected": true,
    "calendarApiConnected": true,
    "lastRenewal": "2025-11-03T03:00:00Z",
    "nextRenewal": "2025-11-04T03:00:00Z"
  },
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

**Body** (`format=table`):
```text
CHANNEL STATUS REPORT
Generated: 2025-11-03 14:23:45 JST

┌──────────────────────────────────┬─────────────────────┬──────────────────────┬────────────┬────────────┐
│ Channel ID                       │ Calendar ID         │ Expiration           │ Expires In │ Status     │
├──────────────────────────────────┼─────────────────────┼──────────────────────┼────────────┼────────────┤
│ calendar-sync-user1-...          │ user1@hoge.jp       │ 2025-11-10 18:00 JST │ 6d 12h 34m │ ✓ Active   │
│ calendar-sync-user2-...          │ user2@hoge.jp       │ 2025-11-04 18:00 JST │ 18h 34m    │ ⚠ Expiring │
│ calendar-sync-user3-...          │ user3@hoge.jp       │ 2025-11-02 18:00 JST │ (expired)  │ ✗ Expired  │
└──────────────────────────────────┴─────────────────────┴──────────────────────┴────────────┴────────────┘

Summary: 9 total, 8 active, 2 expiring soon, 1 expired
Health: Firestore ✓ | Calendar API ✓ | Last Renewal: 2025-11-03 03:00 JST
```

### Error Responses

**500 Internal Server Error**: Cannot retrieve status
```json
{
  "error": "Failed to query Firestore",
  "message": "Connection refused",
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

### Behavior

1. Query Firestore for all channels (ordered by expiration ASC)
2. For each channel, calculate `expiresIn` = expiration - now
3. Categorize:
   - `expiringSoon`: expiration < now + 24h
   - `expired`: expiration < now
   - `active`: expiration >= now
4. Check health:
   - Firestore: Connection status
   - Calendar API: Last successful API call
   - Renewal: Last scheduled job execution
5. Format response (JSON or table)

**Caching**: No caching (always read from Firestore for accurate status)

**Performance**: O(n) where n = number of channels (9-100), typically < 100ms

---

## Endpoint 4: Stop Channel (Optional)

**Purpose**: Manually stop a specific webhook subscription. Used for debugging and removing orphaned channels.

### Request

**Method**: `POST`
**Path**: `/admin/stop-channel`
**Headers**:
```
Authorization: Bearer {OIDC_TOKEN}
Content-Type: application/json
```

**Body**:
```json
{
  "channelId": "calendar-sync-user1-hoge-jp-1730612345678",
  "reason": "Testing channel removal"
}
```

**Parameters**:
- `channelId` (string, required): Channel identifier to stop
- `reason` (string, optional): Audit trail explanation

### Response

**Status**: `200 OK`

**Body**:
```json
{
  "channelId": "calendar-sync-user1-hoge-jp-1730612345678",
  "calendarId": "user1@hoge.jp",
  "stopped": true,
  "removedFromFirestore": true,
  "removedFromRegistry": true,
  "reason": "Testing channel removal",
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

### Error Responses

**404 Not Found**: Channel not found
```json
{
  "error": "Channel not found",
  "channelId": "calendar-sync-unknown-1234567890",
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

**500 Internal Server Error**: Failed to stop
```json
{
  "error": "Failed to stop channel with Google Calendar API",
  "channelId": "calendar-sync-user1-hoge-jp-1730612345678",
  "message": "API returned 500 Internal Server Error",
  "removedFromFirestore": false,
  "removedFromRegistry": false,
  "timestamp": "2025-11-03T14:23:45.678Z"
}
```

### Behavior

1. Look up channel in Firestore by channelId
2. Stop channel via Google Calendar API `channels.stop()`
3. Delete from Firestore
4. Remove from in-memory ChannelRegistry
5. Log action with reason for audit trail

**Idempotency**: Safe to call multiple times (already-stopped channel returns 404 from Calendar API, Firestore delete is idempotent)

---

## Security Considerations

**Authentication**: All endpoints require Cloud Run IAM authentication (OIDC token)

**Authorization**: Only service accounts and authenticated users with `roles/run.invoker` can invoke

**Rate Limiting**: Cloud Run default rate limiting applies (1000 requests/second per service)

**Audit Logging**: All admin endpoint invocations logged to Cloud Logging with:
- Timestamp
- Endpoint path
- Invoking service account/user
- Request body (reason field if present)
- Response summary (success/failure counts)

**Secrets**: No secrets exposed in responses (channel IDs and calendar emails are non-sensitive)

---

## Testing Contract

**Unit Tests**:
- Mock Firestore and Calendar API clients
- Verify correct query construction
- Verify error handling (API failures, Firestore unavailable)

**Integration Tests**:
- Call endpoints with real Firestore (test project)
- Verify channels created/updated/deleted correctly
- Verify idempotency (call same endpoint twice)
- Verify authentication (401/403 for missing/invalid tokens)

**Manual Testing**:
```bash
# Authenticate
gcloud auth print-identity-token > token.txt

# Test renewal
curl -X POST https://SERVICE_URL/admin/renew-expiring-channels \
  -H "Authorization: Bearer $(cat token.txt)" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# Test status
curl https://SERVICE_URL/admin/channel-status \
  -H "Authorization: Bearer $(cat token.txt)"

# Test force register
curl -X POST https://SERVICE_URL/admin/force-register-channels \
  -H "Authorization: Bearer $(cat token.txt)" \
  -d '{"reason": "Manual test"}'
```

---

## Versioning

**API Version**: v1 (implied, no version in path)

**Backward Compatibility**: If response fields change, new fields are added (never removed). Clients should ignore unknown fields.

**Breaking Changes**: Require new endpoint paths (e.g., `/v2/admin/renew-channels`)

---

## Summary

| Endpoint | Method | Purpose | Idempotent | Scheduled |
|----------|--------|---------|------------|-----------|
| `/admin/renew-expiring-channels` | POST | Renew channels expiring within 24h | Yes | Yes (daily) |
| `/admin/force-register-channels` | POST | Stop all and re-register from mappings | No | No |
| `/admin/channel-status` | GET | Display current subscription status | Yes | No |
| `/admin/stop-channel` | POST | Manually stop specific channel | Yes | No |

**Authentication**: Cloud Run IAM with OIDC tokens
**Authorization**: `roles/run.invoker` on calendar-sync service
**Audit**: All requests logged to Cloud Logging
