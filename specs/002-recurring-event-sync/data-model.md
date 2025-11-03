# Data Model: Recurring Event Parent Synchronization

**Feature**: 002-recurring-event-sync
**Date**: 2025-10-30
**Purpose**: Entity definitions and relationships for recurring event handling

## Overview

This feature extends the existing calendar event sync data model to distinguish between recurring event instances and their parent events. No new persistent storage is introduced (follows constitution principle I - in-memory state only).

## Entities

### Recurring Event Instance

**Description**: A specific occurrence of a recurring event series, representing one instance in the sequence.

**Identification**: Event ID containing underscore separator (`baseEventId_instanceDateTime`)

**Attributes**:
- `instanceId` (string, format: `baseId_YYYYMMDDTHHMMSSZ`) - Full instance identifier from Google Calendar
- `baseEventId` (string, derived) - Parent event ID extracted by splitting on `_`
- `instanceDateTime` (string, format: ISO8601) - Occurrence timestamp encoded in ID suffix
- `status` (enum: `confirmed` | `cancelled`) - Instance status (can differ from parent)
- `calendarId` (string) - Owner calendar ID (inherited from webhook)

**Relationships**:
- Belongs to exactly one **Recurring Event Parent** (identified by `baseEventId`)
- May have instance-level overrides (attendees, time, location) that differ from parent

**Lifecycle**:
1. Created when parent event recurrence rule generates new instances
2. Webhook fired for instance changes (attendee add/remove, time modification, cancellation)
3. Deleted when parent event deleted or recurrence rule ends

**Validation Rules**:
- `instanceId` MUST contain exactly one `_` character
- `baseEventId` extracted MUST NOT be empty string
- `status === 'cancelled'` instances skipped from sync (FR-007)

**State Transitions**:
```
Created → Active → Modified → Active
                 ↘ Cancelled (terminal state)
```

**Example**:
```json
{
  "instanceId": "43voav7ssku8k5ai9qmd1b6cau_20251115T100000Z",
  "baseEventId": "43voav7ssku8k5ai9qmd1b6cau",
  "instanceDateTime": "2025-11-15T10:00:00Z",
  "status": "confirmed",
  "calendarId": "hirose30@storegeek.jp"
}
```

---

### Recurring Event Parent

**Description**: The master event defining recurrence pattern and shared properties for all instances.

**Identification**: Event ID without underscore separator (base ID only)

**Attributes**:
- `baseEventId` (string, format: alphanumeric without `_`) - Parent event identifier
- `recurrence` (array of strings, RRULE format) - Recurrence pattern (e.g., `["RRULE:FREQ=DAILY;COUNT=30"]`)
- `attendees` (array of objects) - Shared attendee list inherited by all instances
- `title` (string) - Event title (inherited by instances)
- `location` (string) - Event location (inherited by instances)
- `status` (enum: `confirmed` | `cancelled`) - Parent status (cancellation cascades to all instances)
- `calendarId` (string) - Owner calendar ID

**Relationships**:
- Has many **Recurring Event Instances** (generated from recurrence rules)
- Attendee changes propagate to all instances unless explicitly overridden at instance level

**Lifecycle**:
1. Created by user via Google Calendar (with recurrence rules)
2. Watch Channel registered for parent's calendar
3. Modified when parent properties change (title, attendees, location)
4. Deleted when parent event deleted (cascades to all instances)

**Validation Rules**:
- `baseEventId` MUST NOT contain `_` character
- `recurrence` array MUST NOT be empty (distinguishes from single events)
- `attendees` changes applied via `syncRecurringParentEvent()` only

**State Transitions**:
```
Created → Active → Modified (attendees/properties) → Active
                 ↘ Cancelled (all instances cancelled)
```

**Attendee Propagation Behavior**:
- Adding attendee to parent → All instances inherit (Google Calendar API behavior)
- Removing attendee from parent → All instances updated (unless instance override exists)
- Adding attendee to single instance → Instance-level override (not propagated to parent)

**Example**:
```json
{
  "baseEventId": "43voav7ssku8k5ai9qmd1b6cau",
  "recurrence": ["RRULE:FREQ=DAILY;COUNT=30"],
  "attendees": [
    {"email": "hirose30@storegeek.jp", "responseStatus": "accepted"},
    {"email": "hirose30@fout.jp", "responseStatus": "needsAction"}
  ],
  "title": "Daily Standup",
  "location": "Zoom",
  "status": "confirmed",
  "calendarId": "hirose30@storegeek.jp"
}
```

---

### Base Event ID (Derived Concept)

**Description**: String identifier extracted from recurring instance IDs to identify parent events.

**Not a Persistent Entity**: Computed on-the-fly during event processing.

**Extraction Logic**:
```typescript
function extractBaseEventId(instanceId: string): string {
  const parts = instanceId.split('_');
  return parts[0]; // Returns full ID if no underscore (single event)
}
```

**Usage**:
- Deduplication cache key for recurring events
- Parameter for fetching parent event via `CalendarClient.getEvent(calendarId, baseId)`
- Logging context to correlate instance webhooks with parent sync operations

---

## Relationships Diagram

```
┌─────────────────────────────┐
│ Recurring Event Parent      │
│ baseEventId: "abc123"       │
│ recurrence: ["RRULE:..."]   │
│ attendees: [...]            │
└──────────────┬──────────────┘
               │ generates
               │ 1:N
               ▼
┌─────────────────────────────┐
│ Recurring Event Instance    │
│ instanceId: "abc123_DATE1"  │  (multiple instances)
│ baseEventId: "abc123"       │
│ status: confirmed/cancelled │
└─────────────────────────────┘
       │
       │ may have instance-level
       │ overrides (attendees, time)
       ▼
 (Google Calendar behavior)
```

---

## Data Flow

### Webhook Processing Flow

```
1. Webhook arrives with instanceId "abc123_20251115T100000Z"
   ↓
2. Detect instanceId.includes('_') → TRUE (recurring instance)
   ↓
3. Extract baseEventId: "abc123"
   ↓
4. Check DeduplicationCache with key (calendarId, baseEventId)
   ↓ (if not duplicate)
5. Fetch parent event: getEvent(calendarId, "abc123")
   ↓
6. Sync parent event attendees (add secondary workspace identities)
   ↓
7. All instances (past, present, future) inherit updated attendees
```

### Single Event Flow (Unchanged)

```
1. Webhook arrives with eventId "def456"
   ↓
2. Detect eventId.includes('_') → FALSE (single event)
   ↓
3. Check DeduplicationCache with key (calendarId, eventId)
   ↓
4. Sync single event directly (existing logic)
```

---

## Storage Strategy

**In-Memory Only** (per constitution principle I):

### DeduplicationCache
- **Key**: `(calendarId, baseEventId)` for recurring, `(calendarId, instanceId)` for single
- **Value**: `{ timestamp, eventId, calendarId }`
- **TTL**: 5 minutes
- **Purpose**: Prevent duplicate parent syncs when multiple instance webhooks arrive

**No New Storage**:
- Parent events NOT cached (fetched on-demand via API)
- Instance data NOT persisted (transient webhook payloads only)
- Recurrence rules NOT stored locally (Google Calendar is source of truth)

---

## Validation Rules Summary

| Rule | Entity | Enforcement Point |
|------|--------|-------------------|
| Instance ID contains exactly one `_` | Instance | `isRecurringInstance(eventId)` |
| Base ID extraction never returns empty | Instance | `extractBaseEventId()` with fallback |
| Cancelled instances skipped | Instance | `if (event.status === 'cancelled') continue` |
| Parent ID never contains `_` | Parent | Implicit (Google Calendar format) |
| Dedup key uses base ID for recurring | Cache | `dedupCache.markProcessing(calendarId, baseId)` |

---

## Edge Cases

### Exception Instances (Moved/Modified)

**Scenario**: User moves one instance of recurring event to different time.

**Behavior**:
- Google Calendar creates instance-level override with custom `start` time
- Attendees still inherited from parent unless explicitly modified at instance level
- System syncs parent → Instance inherits updated attendees despite time override

**No special handling required** - Google Calendar API handles propagation.

---

### "This and Following" Edits

**Scenario**: User modifies recurring event with "This and following" option.

**Behavior**:
- Google Calendar creates NEW parent event with different base ID
- Original parent unchanged (covers dates before split point)
- New parent covers dates after split point

**System behavior**:
- Treats as two separate recurring events (different base IDs)
- Syncs each parent independently
- No cross-parent linking required

---

### Parent Deletion

**Scenario**: User deletes entire recurring event series.

**Behavior**:
- Parent event status set to `cancelled`
- All instances inherit cancelled status
- Webhook fires for parent deletion

**System behavior**:
- Fetch parent returns `status: 'cancelled'`
- Skip sync (same logic as cancelled single events)
- Log cancellation event for audit trail

---

## References

- Google Calendar API Events Resource: https://developers.google.com/calendar/api/v3/reference/events
- Existing data model: `specs/001-calendar-cross-workspace-sync/data-model.md` (if exists)
- Constitution storage principles: `.specify/memory/constitution.md` Section I
