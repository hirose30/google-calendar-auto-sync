# Quick Start: Recurring Event Parent Synchronization

**Feature**: 002-recurring-event-sync
**Purpose**: Step-by-step guide for implementing parent event synchronization
**Audience**: Developers implementing this feature

## Overview

This feature fixes the critical bug where recurring calendar events trigger individual syncs for each instance (O(N) API calls) instead of syncing the parent event once (O(1) API calls).

**Key Concept**: Google Calendar recurring event instances have IDs in format `baseEventId_instanceDateTime`. By detecting the `_` character, we extract the base ID and sync the parent event instead.

---

## Implementation Steps

### Step 1: Add Recurring Instance Detection

**File**: `src/webhook/handler.ts`

**What to Add**: Helper function to detect recurring instances

```typescript
/**
 * Check if event ID represents a recurring event instance
 * Format: baseEventId_instanceDateTime (e.g., "abc123_20251115T100000Z")
 */
function isRecurringInstance(eventId: string): boolean {
  return eventId.includes('_');
}
```

**Why**: Simple string check identifies recurring instances with zero false positives (single event IDs never contain `_`).

**Test**:
```typescript
isRecurringInstance('43voav7ssku8k5ai9qmd1b6cau_20251115T100000Z') // → true
isRecurringInstance('43voav7ssku8k5ai9qmd1b6cau') // → false
```

---

### Step 2: Add Base Event ID Extraction

**File**: `src/webhook/handler.ts`

**What to Add**: Helper function to extract parent ID

```typescript
/**
 * Extract base event ID from recurring instance ID
 * Input: "abc123_20251115T100000Z"
 * Output: "abc123"
 */
function extractBaseEventId(instanceId: string): string {
  return instanceId.split('_')[0];
}
```

**Why**: Simplest possible extraction—single split operation handles all cases.

**Test**:
```typescript
extractBaseEventId('43voav7ssku8k5ai9qmd1b6cau_20251115T100000Z')
// → '43voav7ssku8k5ai9qmd1b6cau'

extractBaseEventId('singleEvent123')
// → 'singleEvent123' (handles non-recurring gracefully)
```

---

### Step 3: Create Parent Event Sync Method

**File**: `src/calendar/sync.ts`

**What to Add**: New method `syncRecurringParentEvent()`

```typescript
/**
 * Sync recurring parent event by adding secondary workspace attendees
 * This updates ALL instances at once (Google Calendar handles propagation)
 */
async syncRecurringParentEvent(
  calendarId: string,
  baseEventId: string
): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Fetching recurring parent event', {
      operation: 'syncRecurringParentEvent',
      baseEventId,
      calendarId,
    });

    // Fetch parent event using base ID
    const parentEvent = await this.calendarClient.getEvent(calendarId, baseEventId);

    // Check if parent has been cancelled
    if (parentEvent.status === 'cancelled') {
      logger.info('Parent event cancelled, skipping sync', {
        operation: 'syncRecurringParentEvent',
        baseEventId,
        calendarId,
      });
      return;
    }

    // Get primary workspace attendees
    const primaryAttendees = parentEvent.attendees || [];
    const primaryEmails = primaryAttendees.map(a => a.email);

    // Find secondary workspace mappings
    const secondaryEmails = this.userMappingStore.getSecondaryEmails(primaryEmails);

    if (secondaryEmails.length === 0) {
      logger.debug('No secondary workspace attendees to add', {
        operation: 'syncRecurringParentEvent',
        baseEventId,
        calendarId,
      });
      return;
    }

    // Check if secondary attendees already present
    const existingSecondaryEmails = primaryAttendees
      .map(a => a.email)
      .filter(email => secondaryEmails.includes(email));

    if (existingSecondaryEmails.length === secondaryEmails.length) {
      logger.debug('All secondary attendees already present on parent', {
        operation: 'syncRecurringParentEvent',
        baseEventId,
        calendarId,
        context: { secondaryEmails },
      });
      return;
    }

    // Merge attendees (add missing secondary emails)
    const mergedAttendees = [
      ...primaryAttendees,
      ...secondaryEmails
        .filter(email => !primaryAttendees.some(a => a.email === email))
        .map(email => ({ email, responseStatus: 'needsAction' })),
    ];

    // Update parent event
    await this.calendarClient.updateEvent(calendarId, baseEventId, {
      attendees: mergedAttendees,
    });

    const duration = Date.now() - startTime;

    logger.info('Parent event synced successfully', {
      operation: 'syncRecurringParentEvent',
      baseEventId,
      calendarId,
      duration,
      context: {
        addedAttendees: secondaryEmails.filter(
          email => !existingSecondaryEmails.includes(email)
        ),
        primaryAttendees: primaryEmails,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Failed to sync recurring parent event', {
      operation: 'syncRecurringParentEvent',
      baseEventId,
      calendarId,
      duration,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    throw error;
  }
}
```

**Why**: Reuses existing `CalendarClient` methods (`getEvent`, `updateEvent`) and follows same pattern as `syncEvent()`.

---

### Step 4: Update Webhook Handler Routing Logic

**File**: `src/webhook/handler.ts`

**What to Modify**: `processCalendarChanges()` method

```typescript
async processCalendarChanges(
  calendarId: string,
  events: Array<{ id?: string }>
): Promise<void> {
  for (const event of events) {
    if (!event.id) continue;

    // NEW: Branch on recurring vs single event
    if (isRecurringInstance(event.id)) {
      // Recurring instance → sync parent
      const baseId = extractBaseEventId(event.id);

      logger.info('Recurring instance detected', {
        operation: 'detectRecurringInstance',
        instanceId: event.id,
        baseEventId: baseId,
        calendarId,
      });

      // Check deduplication with base ID (not instance ID)
      if (this.dedupCache.isDuplicate(calendarId, baseId)) {
        logger.debug('Parent event already processing, skipping', {
          operation: 'processCalendarChanges',
          baseEventId: baseId,
          instanceId: event.id,
          calendarId,
        });
        continue;
      }

      // Mark base ID as processing
      this.dedupCache.markProcessing(calendarId, baseId);

      // Sync parent event
      await this.syncService.syncRecurringParentEvent(calendarId, baseId);
    } else {
      // Single event → existing flow (unchanged)
      if (this.dedupCache.isDuplicate(calendarId, event.id)) {
        continue;
      }

      this.dedupCache.markProcessing(calendarId, event.id);
      await this.syncService.syncEvent(calendarId, event.id);
    }
  }
}
```

**Why**: Minimal code change (single if/else branch) preserves backward compatibility.

---

## Testing Guide

### Test 1: Single Event (Verify Unchanged Behavior)

1. Create a single (non-recurring) event in primary workspace calendar with primary attendee
2. Wait up to 2 minutes for webhook
3. **Expected**: Event appears in secondary workspace with secondary attendee (existing behavior)
4. **Verify Logs**:
   ```
   "operation": "syncEvent"
   "eventId": "<single-event-id>" (no underscore)
   ```

---

### Test 2: Daily Recurring Event (30 Instances)

1. Create daily recurring event for 30 days in primary workspace
2. Add primary workspace attendee
3. Wait up to 2 minutes for webhook
4. **Expected**:
   - Only 1 parent event sync occurs (not 30 instance syncs)
   - All 30 instances show secondary attendee when viewed individually
5. **Verify Logs**:
   ```json
   {
     "operation": "detectRecurringInstance",
     "instanceId": "abc123_20251115T100000Z",
     "baseEventId": "abc123"
   }
   {
     "operation": "syncRecurringParentEvent",
     "baseEventId": "abc123",
     "duration": "<5000ms typically>",
     "context": {
       "addedAttendees": ["hirose30@fout.jp"],
       "primaryAttendees": ["hirose30@storegeek.jp"]
     }
   }
   ```
6. **Verify API Calls**: 1 GET + 1 PATCH = **2 total calls** (not 60)

---

### Test 3: Deduplication (Multiple Instance Webhooks)

1. Create daily recurring event (triggers multiple webhooks within seconds)
2. **Expected**: Only first webhook processes parent, subsequent webhooks skip
3. **Verify Logs**:
   ```json
   {
     "operation": "syncRecurringParentEvent",
     "baseEventId": "abc123"
   }
   {
     "operation": "processCalendarChanges",
     "message": "Parent event already processing, skipping",
     "baseEventId": "abc123",
     "instanceId": "abc123_20251116T100000Z"
   }
   ```

---

### Test 4: Cancelled Parent Event

1. Create recurring event and sync successfully
2. Cancel entire recurring series (delete parent)
3. Trigger webhook (manually or wait for next change)
4. **Expected**: No error, graceful skip with log message
5. **Verify Logs**:
   ```json
   {
     "operation": "syncRecurringParentEvent",
     "message": "Parent event cancelled, skipping sync",
     "baseEventId": "abc123"
   }
   ```

---

### Test 5: Instance Exception (Moved Time)

1. Create weekly recurring event
2. Move ONE instance to different time (creates exception)
3. **Expected**: Exception instance inherits parent attendees (unless manually overridden)
4. **Behavior**: System only syncs parent, Google Calendar handles exception inheritance

---

## Validation Checklist

Before deployment:

- [ ] Single events still sync correctly (backward compatibility)
- [ ] Daily recurring (30 instances) creates only 1 API call
- [ ] Logs show both `instanceId` and `baseEventId` for recurring events
- [ ] Deduplication prevents duplicate parent syncs within 5-minute window
- [ ] Cancelled parent events handled gracefully (no errors)
- [ ] All instances inherit attendees after parent sync (verify manually in Calendar UI)

---

## Performance Verification

**Before Feature**:
```bash
# Daily recurring for 30 days
gcloud logging read "resource.type=cloud_run_revision AND jsonPayload.operation='syncEvent'" --limit 100
# Expected: 30 individual "syncEvent" log entries (BAD ❌)
```

**After Feature**:
```bash
# Daily recurring for 30 days
gcloud logging read "resource.type=cloud_run_revision AND jsonPayload.operation='syncRecurringParentEvent'" --limit 100
# Expected: 1 "syncRecurringParentEvent" log entry (GOOD ✅)
```

**API Call Reduction**:
- Daily recurring (30 days): 60 calls → **2 calls** (97% reduction)
- Weekly recurring (1 year): 104 calls → **2 calls** (98% reduction)

---

## Rollback Plan

If issues occur in production:

1. **Immediate**: Revert to previous commit (single events will work, recurring will have bug)
2. **Identify Issue**: Check logs for error patterns
3. **Fix**: Apply targeted fix based on error type
4. **Re-deploy**: Test with single recurring event before full rollout

**Critical Safety**: Single event flow is completely unchanged (isolated if/else branch), so rollback only affects recurring event handling.

---

## References

- **Specification**: [spec.md](./spec.md)
- **Research**: [research.md](./research.md)
- **API Contract**: [contracts/calendar-api.md](./contracts/calendar-api.md)
- **Data Model**: [data-model.md](./data-model.md)
- **Google Calendar Recurring Events**: https://developers.google.com/calendar/api/concepts/events-recurr
