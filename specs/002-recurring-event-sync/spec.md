# Feature Specification: Recurring Event Parent Synchronization

**Feature Branch**: `002-recurring-event-sync`
**Created**: 2025-10-30
**Status**: Draft
**Input**: User description: "繰り返しのイベントを作った時、イベント単体にへの個別のユーザ同期ではなく、親カレンダーに動悸したら、一発でユーザが反映されるような仕組みにしたい。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Recurring Event Parent Sync (Priority: P1)

When a user creates a recurring calendar event (e.g., daily standup meeting, weekly team sync) and adds primary workspace attendees, the system automatically adds corresponding secondary workspace identities to the **parent recurring event** rather than to each individual instance. This ensures all past, present, and future instances inherit the secondary attendees automatically.

**Why this priority**: This is the core value proposition - without parent event synchronization, the system creates hundreds or thousands of individual updates (one per instance), which is inefficient, creates excessive API calls, and doesn't reflect how users expect recurring events to work in Google Calendar.

**Independent Test**: Can be fully tested by creating a single daily recurring event with one primary workspace attendee, then verifying that only one API call is made to update the parent event (not N calls for N instances), and that all instances show the secondary attendee.

**Acceptance Scenarios**:

1. **Given** a user creates a new daily recurring event for the next 30 days with `user@hoge.jp` as an attendee, **When** the system detects the webhook notification, **Then** the system adds `user@fuga.jp` to the **parent recurring event** only once, and all 30 instances automatically inherit the secondary attendee.

2. **Given** a user creates a weekly recurring event with no end date and adds `manager@hoge.jp` as an attendee, **When** the synchronization runs, **Then** the system adds `manager@fuga.jp` to the parent event, and all future instances (including those created months later) automatically include the secondary attendee.

3. **Given** a recurring event parent already has secondary attendees synchronized, **When** the user adds another primary workspace attendee `newuser@hoge.jp` to the parent event, **Then** the system adds only `newuser@fuga.jp` without duplicating existing secondary attendees.

---

### User Story 2 - Recurring Event Instance Detection (Priority: P1)

When the system processes webhook notifications for calendar events, it must correctly identify whether an event is a recurring event instance and extract the parent event ID to perform synchronization at the parent level.

**Why this priority**: This is a prerequisite for P1 Story 1 - without proper instance detection, the system cannot determine which events need parent-level synchronization. This prevents the current bug where individual instances are processed separately.

**Independent Test**: Can be tested by examining event IDs from webhook payloads and verifying that recurring instances (with `_` suffix) are correctly identified and their base event ID is extracted.

**Acceptance Scenarios**:

1. **Given** a webhook notification for event ID `abc123_20251115T100000Z` (recurring instance), **When** the system processes the notification, **Then** the system identifies it as a recurring instance and extracts base event ID `abc123`.

2. **Given** a webhook notification for event ID `def456` (single event, no `_` suffix), **When** the system processes the notification, **Then** the system treats it as a non-recurring event and processes it normally.

3. **Given** multiple webhook notifications for different instances of the same recurring event (`xyz789_20251101T...`, `xyz789_20251102T...`), **When** these are processed within the deduplication window, **Then** the system processes the parent event `xyz789` only once, ignoring subsequent instance notifications.

---

### User Story 3 - Backward Compatibility with Single Events (Priority: P2)

Existing single (non-recurring) calendar events continue to work exactly as they do today, with secondary attendees added directly to the event.

**Why this priority**: This ensures the new recurring event logic doesn't break existing functionality. While critical for production stability, it's lower priority than P1 because it's mostly validation of existing behavior.

**Independent Test**: Can be tested by creating a single (non-recurring) event and verifying the synchronization behavior matches the current system's behavior exactly.

**Acceptance Scenarios**:

1. **Given** a user creates a single (non-recurring) event with `alice@hoge.jp` as an attendee, **When** the system processes the webhook, **Then** `alice@fuga.jp` is added to that specific event (no change from current behavior).

2. **Given** the system is processing a mix of single and recurring events in the same webhook batch, **When** synchronization runs, **Then** single events are handled individually and recurring events are handled at parent level, with no errors or cross-contamination.

---

### User Story 4 - Cancelled Recurring Event Handling (Priority: P3)

When individual instances of a recurring event are cancelled (e.g., "skip this week's meeting"), the system correctly ignores those cancelled instances without affecting the parent event or other instances.

**Why this priority**: This is an edge case that improves user experience but doesn't block core functionality. Users can work around it by manually managing cancelled instances if needed.

**Independent Test**: Can be tested by cancelling a single instance of a recurring event and verifying that synchronization still works correctly for the parent and other instances.

**Acceptance Scenarios**:

1. **Given** a recurring event with 10 instances where instance #5 is cancelled, **When** the system processes webhook notifications, **Then** the parent event and 9 active instances have secondary attendees, but instance #5 remains cancelled with no synchronization attempted.

2. **Given** a webhook notification for a cancelled recurring instance, **When** the system processes it, **Then** the system skips synchronization for that specific instance but does not affect the parent event or other instances.

---

### Edge Cases

- **What happens when a recurring event has an exception** (e.g., one instance moved to a different time)?
  - System should synchronize the parent event; the exception instance inherits attendees from parent unless explicitly modified.

- **How does system handle "this and following" edits** (where a user modifies a recurring event starting from a specific date)?
  - Google Calendar creates a new recurring event series for "this and following"; system treats it as a separate parent event and synchronizes accordingly.

- **What happens when the parent event itself is deleted?**
  - System detects the parent event status as `cancelled` and skips synchronization (same as current single event cancellation logic).

- **How does system handle recurring events with very large instance counts** (e.g., daily for 5 years = 1,825 instances)?
  - System performs only one parent event synchronization regardless of instance count, making this efficient even for large series.

- **What happens when a user manually removes a secondary attendee from a specific instance?**
  - The manual removal persists as an instance-level override; system does not re-add the attendee to that specific instance (Google Calendar behavior).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST identify recurring event instances by detecting the `_` character in the event ID (format: `baseEventId_instanceDateTime`)

- **FR-002**: System MUST extract the base event ID from recurring instance IDs by removing the `_instanceDateTime` suffix

- **FR-003**: System MUST fetch the parent recurring event using the base event ID when processing a recurring instance notification

- **FR-004**: System MUST add secondary workspace attendees to the **parent recurring event** (not individual instances) when primary workspace attendees are detected

- **FR-005**: System MUST use the deduplication cache to prevent multiple synchronizations of the same parent event when multiple instance notifications arrive within the cache TTL window (currently 5 minutes)

- **FR-006**: System MUST continue to synchronize single (non-recurring) events using the existing direct event synchronization logic

- **FR-007**: System MUST skip synchronization for cancelled recurring event instances (status === 'cancelled') without affecting the parent event

- **FR-008**: System MUST log parent event synchronization separately from instance detection to enable troubleshooting (include both base event ID and original instance ID in logs)

- **FR-009**: System MUST handle API errors when fetching or updating parent events with the same retry logic used for single events (5 retries, 30-second intervals)

### Key Entities

- **Recurring Event Instance**: A specific occurrence of a recurring event series, identified by event ID format `baseId_instanceDateTime` (e.g., `abc123_20251115T100000Z`)

- **Recurring Event Parent**: The master event that defines the recurrence pattern and shared properties (title, attendees, location) for all instances, identified by the base event ID without suffix (e.g., `abc123`)

- **Base Event ID**: The portion of a recurring instance ID before the `_` separator, used to identify and fetch the parent event

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Creating a recurring event with N instances results in exactly **1 API call** to update the parent event (not N calls), measurable via API request logs

- **SC-002**: All instances of a synchronized recurring event (past, present, and future) display secondary workspace attendees without individual processing, verifiable by checking any random instance in Google Calendar

- **SC-003**: System processes recurring event webhooks within the same latency as single events (95% within 2 minutes from notification to parent sync completion)

- **SC-004**: Deduplication cache prevents redundant parent event synchronization when multiple instance notifications arrive within 5 minutes (0 duplicate parent updates per recurring event series)

- **SC-005**: Single (non-recurring) event synchronization behavior remains unchanged (100% backward compatibility, measurable by regression testing existing single event flows)

- **SC-006**: System handles recurring events with any instance count (1 to 1000+) with constant performance (parent sync time independent of instance count)

- **SC-007**: Logs clearly distinguish between recurring instance detection and parent event synchronization, enabling troubleshooting within 10 minutes (same as existing SC-008 target)

## Assumptions

- Google Calendar API behavior: When attendees are added to a recurring event parent, all instances automatically inherit those attendees unless explicitly overridden at the instance level

- Recurring event ID format: Google Calendar uses the format `baseEventId_instanceDateTime` (with underscore separator) consistently for recurring instances

- Deduplication window sufficiency: The current 5-minute TTL is sufficient to catch multiple webhook notifications for the same recurring event series (based on typical webhook delivery patterns)

- Parent event API access: The Calendar API allows fetching and updating recurring event parents using the base event ID with the same authentication and permissions as individual events

## Out of Scope

- Handling recurring events with complex recurrence patterns (e.g., "every 2nd Tuesday except holidays") - system relies on Google Calendar to manage recurrence logic

- Synchronizing changes made to individual instance overrides (e.g., if a user manually edits just one instance's attendees) - parent-level sync only

- Creating new recurring event series - system only synchronizes attendees on existing events created by users

- Supporting non-Google calendar systems or iCal recurring event formats - Google Calendar specific implementation
