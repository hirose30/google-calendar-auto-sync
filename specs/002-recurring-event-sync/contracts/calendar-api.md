# API Contract: Google Calendar API Integration

**Feature**: 002-recurring-event-sync
**Date**: 2025-10-30
**Purpose**: Define interactions with Google Calendar API for recurring event parent sync

## Overview

This contract extends the existing Google Calendar API integration to support fetching and updating recurring event parents. No new API endpoints or authentication mechanisms are introduced - all operations reuse existing Calendar API v3 methods.

---

## Existing API Methods (Reused)

### GET Event (Fetch Parent)

**Endpoint**: `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}`

**Purpose**: Fetch recurring event parent using base event ID

**Authentication**: Service Account with Domain-Wide Delegation (existing)

**Request Parameters**:
- `calendarId` (path, string, required) - Calendar ID (email address format)
- `eventId` (path, string, required) - **Base event ID** (without `_` suffix for parents)

**Request Headers**:
```
Authorization: Bearer {access_token}
```

**Success Response** (200 OK):
```json
{
  "kind": "calendar#event",
  "id": "43voav7ssku8k5ai9qmd1b6cau",
  "status": "confirmed",
  "summary": "Daily Standup",
  "location": "Zoom",
  "start": {
    "dateTime": "2025-11-01T10:00:00+09:00",
    "timeZone": "Asia/Tokyo"
  },
  "end": {
    "dateTime": "2025-11-01T10:30:00+09:00",
    "timeZone": "Asia/Tokyo"
  },
  "recurrence": [
    "RRULE:FREQ=DAILY;COUNT=30"
  ],
  "attendees": [
    {
      "email": "hirose30@storegeek.jp",
      "responseStatus": "accepted",
      "organizer": true
    }
  ],
  "recurringEventId": null
}
```

**Note**: Parent events have:
- `recurrence` array (not null/empty)
- `recurringEventId` is null (instances have this field pointing to parent)

**Error Responses**:
- `404 Not Found` - Event does not exist (parent deleted)
- `403 Forbidden` - Service account lacks calendar access
- `401 Unauthorized` - Authentication failed
- `500 Internal Server Error` - Google API transient failure

**Retry Strategy**: Reuse existing retry logic (5 attempts, 30s backoff) for 5xx errors. Do not retry 4xx errors.

**Usage in Feature**:
```typescript
const parentEvent = await calendarClient.getEvent(calendarId, baseEventId);
```

---

### PATCH Event (Update Parent Attendees)

**Endpoint**: `PATCH https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}`

**Purpose**: Add secondary workspace attendees to recurring event parent

**Authentication**: Service Account with Domain-Wide Delegation (existing)

**Request Parameters**:
- `calendarId` (path, string, required) - Calendar ID
- `eventId` (path, string, required) - Base event ID (parent)

**Request Headers**:
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Request Body** (partial update):
```json
{
  "attendees": [
    {
      "email": "hirose30@storegeek.jp",
      "responseStatus": "accepted"
    },
    {
      "email": "hirose30@fout.jp",
      "responseStatus": "needsAction"
    }
  ]
}
```

**Success Response** (200 OK):
```json
{
  "kind": "calendar#event",
  "id": "43voav7ssku8k5ai9qmd1b6cau",
  "status": "confirmed",
  "summary": "Daily Standup",
  "attendees": [
    {
      "email": "hirose30@storegeek.jp",
      "responseStatus": "accepted"
    },
    {
      "email": "hirose30@fout.jp",
      "responseStatus": "needsAction"
    }
  ],
  "recurrence": ["RRULE:FREQ=DAILY;COUNT=30"]
}
```

**Important Behavior**:
- Updating parent attendees automatically propagates to ALL instances
- Google Calendar handles instance inheritance (no per-instance PATCH needed)
- Instance-level overrides preserved (if user manually modified specific instance attendees)

**Error Responses**:
- `404 Not Found` - Parent deleted during update
- `403 Forbidden` - Service account lacks write access
- `409 Conflict` - Concurrent modification (rare, retry resolves)
- `500 Internal Server Error` - Transient failure

**Retry Strategy**: Same as GET (5 attempts, 30s backoff for 5xx/409)

**Usage in Feature**:
```typescript
await calendarClient.updateEvent(calendarId, baseEventId, {
  attendees: mergedAttendees
});
```

---

## Instance ID Format Contract

**Format**: `{baseEventId}_{instanceDateTime}`

**Examples**:
- `43voav7ssku8k5ai9qmd1b6cau_20251115T100000Z`
- `abc123def456_20251201T143000Z`
- `xyz789_20260101T000000Z`

**Components**:
- `baseEventId` - Alphanumeric string (typically 26 characters)
- `_` - Single underscore separator (literal, not escaped)
- `instanceDateTime` - ISO 8601 format `YYYYMMDDTHHMMSSZ` (UTC)

**Validation**:
```typescript
function isRecurringInstance(eventId: string): boolean {
  return eventId.includes('_');
}

function extractBaseEventId(eventId: string): string {
  return eventId.split('_')[0];
}
```

**Guarantees**:
- Single events NEVER contain `_` in ID
- Recurring instances ALWAYS contain exactly one `_`
- Base ID component NEVER contains `_`

**Edge Cases**:
- Exception instances (moved/modified): Still follow `baseId_newDateTime` format
- "This and following" split: Creates NEW base ID (different parent)

---

## Attendee Propagation Contract

### Parent → Instance Inheritance

**Rule**: Attendees added to parent event automatically appear in ALL instances.

**Timing**: Propagation is immediate (Google Calendar API guarantees consistency).

**Verification**:
1. PATCH parent with new attendee
2. GET any instance (via instance ID)
3. Verify instance attendees include parent's attendees

**Test Example**:
```bash
# Add attendee to parent
PATCH /calendars/user@example.com/events/abc123
{ "attendees": [{"email": "new@example.com"}] }

# Verify instance inherited
GET /calendars/user@example.com/events/abc123_20251115T100000Z
# Response includes "new@example.com" in attendees array
```

### Instance Override Behavior

**Rule**: Manually modifying attendees on a SPECIFIC instance creates an override.

**Behavior**:
- Instance retains custom attendee list
- Future parent changes DO NOT override instance
- Instance marked with `originalStartTime` field (indicates override)

**System Impact**: Our sync only modifies PARENT, so instance overrides preserved.

---

## Error Handling Contract

### Retryable Errors

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| 500 | Internal Server Error | Retry with backoff (5 attempts, 30s) |
| 503 | Service Unavailable | Retry with backoff |
| 429 | Rate Limit Exceeded | Retry with backoff |
| 409 | Conflict (concurrent edit) | Retry once |

### Non-Retryable Errors

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| 404 | Event Not Found | Log and skip (parent deleted) |
| 403 | Forbidden | Log critical error (permission issue) |
| 401 | Unauthorized | Log critical error (auth failure) |
| 400 | Bad Request | Log error (malformed request) |

### Logging Requirements

**Success Case**:
```typescript
logger.info('Parent event synced successfully', {
  operation: 'syncRecurringParentEvent',
  baseEventId,
  calendarId,
  duration,
  context: {
    addedAttendees: ['hirose30@fout.jp'],
    primaryAttendees: ['hirose30@storegeek.jp']
  }
});
```

**Error Case**:
```typescript
logger.error('Failed to fetch recurring parent event', {
  operation: 'getRecurringParentEvent',
  baseEventId,
  calendarId,
  error: {
    code: 404,
    message: 'Event not found',
    stack: error.stack
  },
  context: {
    originalInstanceId: 'abc123_20251115T100000Z'
  }
});
```

---

## Performance Contract

### Latency Expectations

| Operation | Expected Latency | Notes |
|-----------|------------------|-------|
| GET parent event | 200-500ms | Single API call |
| PATCH parent event | 300-700ms | Single API call + propagation |
| Total sync operation | 5-7 seconds | Includes retry overhead |

**Success Criteria**: 95% of parent syncs complete within 2 minutes (SC-003).

### API Quota Impact

**Before Feature** (recurring bug):
- Daily recurring (30 instances) = 30 GET + 30 PATCH = **60 API calls**
- Weekly recurring (52 instances) = **104 API calls**

**After Feature**:
- Any recurring series = 1 GET + 1 PATCH = **2 API calls**
- Reduction: **96-98% fewer API calls**

**Quota Limits** (per Google):
- 1,000,000 queries/day (Calendar API default)
- Our usage: ~100-200 calls/day → Well below quota

---

## Compatibility Notes

### Google Calendar API Version

**Version**: Calendar API v3
**Stability**: GA (Generally Available)
**Breaking Changes**: None expected (stable since 2017)

### Domain-Wide Delegation

**Requirement**: Service account MUST have domain-wide delegation enabled with scope:
```
https://www.googleapis.com/auth/calendar
```

**Validation**: Existing feature 001 already uses this scope (no changes needed).

### Cross-Domain Access

**Limitation**: Service account can only access calendars within its delegated domain.

**Impact**: None (all calendars belong to same workspace).

---

## Testing Strategy

### Manual Test Cases

1. **Parent Event Fetch**:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     "https://www.googleapis.com/calendar/v3/calendars/user@example.com/events/abc123"
   # Verify: recurrence field present, recurringEventId null
   ```

2. **Parent Attendee Update**:
   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"attendees":[{"email":"new@example.com"}]}' \
     "https://www.googleapis.com/calendar/v3/calendars/user@example.com/events/abc123"
   # Verify: 200 OK, attendees updated
   ```

3. **Instance Inheritance Verification**:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     "https://www.googleapis.com/calendar/v3/calendars/user@example.com/events/abc123_20251115T100000Z"
   # Verify: attendees match parent
   ```

### Error Scenario Tests

1. **404 Parent Deleted**: Fetch non-existent base ID → Verify graceful skip
2. **403 Permission Denied**: Use unauthorized service account → Verify logged error
3. **429 Rate Limit**: (Difficult to reproduce) → Verify retry logic kicks in

---

## References

- Google Calendar API v3 Documentation: https://developers.google.com/calendar/api/v3/reference
- Events Resource Reference: https://developers.google.com/calendar/api/v3/reference/events
- Recurring Events Guide: https://developers.google.com/calendar/api/concepts/events-recurr
- Service Account Authentication: https://developers.google.com/identity/protocols/oauth2/service-account
