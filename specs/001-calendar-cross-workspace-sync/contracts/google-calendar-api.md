# Google Calendar API Contracts

**Service**: Google Calendar API v3
**Client**: `googleapis` npm package
**Authentication**: Service Account with Domain-Wide Delegation

## Overview

This document defines the contracts for interacting with Google Calendar API to:
1. Register push notification channels
2. Fetch calendar events
3. Update event attendees

All operations use the `calendar_v3.Calendar` client from `googleapis` package with service account authentication.

## Authentication

### Service Account Setup

```typescript
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const serviceAccount = require('./config/service-account-key.json');

function getCalendarClient(userEmail: string): calendar_v3.Calendar {
  const jwtClient = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject: userEmail, // Impersonate this user via domain-wide delegation
  });

  return google.calendar({ version: 'v3', auth: jwtClient });
}
```

## API Operations

### 1. Register Watch Channel

**Purpose**: Set up push notifications for a calendar

**Method**: `calendar.events.watch()`

**Request**:
```typescript
interface WatchRequest {
  calendarId: string;
  requestBody: {
    id: string;           // UUID for channel identification
    type: 'web_hook';
    address: string;      // Your webhook URL (must be HTTPS)
    token?: string;       // Optional verification token
    expiration?: number;  // Optional expiration timestamp (ms)
    params?: {
      ttl?: string;       // Time-to-live in seconds (max 2592000 = 30 days, but typically expires after ~7 days)
    };
  };
}

// Example
const channelId = crypto.randomUUID();
const response = await calendar.events.watch({
  calendarId: 'hirose30@hoge.jp',
  requestBody: {
    id: channelId,
    type: 'web_hook',
    address: 'https://your-service.example.com/webhook',
    token: 'optional-verification-token',
  },
});
```

**Response**:
```typescript
interface WatchResponse {
  kind: 'api#channel';
  id: string;              // Echo of channel ID
  resourceId: string;      // Opaque resource identifier (save this!)
  resourceUri: string;     // Calendar resource URI
  token?: string;          // Echo of token if provided
  expiration: string;      // RFC 3339 timestamp when channel expires
}

// Example response
{
  kind: 'api#channel',
  id: '550e8400-e29b-41d4-a716-446655440000',
  resourceId: 'o3bg70galdnuadrdhfdk2_20231028',
  resourceUri: 'https://www.googleapis.com/calendar/v3/calendars/hirose30@hoge.jp/events?alt=json',
  expiration: '2025-11-04T10:00:00.000Z'
}
```

**Error Codes**:
- `400 Bad Request`: Invalid webhook URL (must be HTTPS, publicly accessible)
- `401 Unauthorized`: Invalid credentials or missing calendar access
- `403 Forbidden`: Domain-wide delegation not enabled or incorrect scopes
- `404 Not Found`: Calendar ID doesn't exist

**Rate Limits**:
- 100 watch requests per 100 seconds per user
- Channels expire after ~7 days (renew 1 day before expiration)

---

### 2. Stop Watch Channel

**Purpose**: Unregister a push notification channel

**Method**: `calendar.channels.stop()`

**Request**:
```typescript
interface StopChannelRequest {
  requestBody: {
    id: string;         // Channel ID from watch() response
    resourceId: string; // Resource ID from watch() response
  };
}

// Example
await calendar.channels.stop({
  requestBody: {
    id: channelId,
    resourceId: resourceId,
  },
});
```

**Response**: Empty (204 No Content) on success

**Error Codes**:
- `404 Not Found`: Channel already expired or doesn't exist

**Use Cases**:
- App shutdown (cleanup active channels)
- Channel renewal (stop old, register new)
- Calendar no longer being monitored (user mapping removed)

---

### 3. List Recent Events

**Purpose**: Fetch events that were recently updated (triggered by webhook notification)

**Method**: `calendar.events.list()`

**Request**:
```typescript
interface ListEventsRequest {
  calendarId: string;
  updatedMin: string;     // RFC 3339 timestamp (e.g., 5 minutes ago)
  singleEvents?: boolean; // Expand recurring events (default: false)
  maxResults?: number;    // Max events to return (default: 250, max: 2500)
  orderBy?: 'startTime' | 'updated';
}

// Example: Fetch events updated in last 5 minutes
const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const response = await calendar.events.list({
  calendarId: 'hirose30@hoge.jp',
  updatedMin: fiveMinutesAgo,
  singleEvents: true,
  maxResults: 100,
});
```

**Response**:
```typescript
interface ListEventsResponse {
  kind: 'calendar#events';
  etag: string;
  summary: string;        // Calendar title
  updated: string;        // Last modification time
  timeZone: string;
  items: CalendarEvent[]; // Array of events
  nextPageToken?: string; // For pagination
  nextSyncToken?: string; // For incremental sync
}
```

**Filter Logic**:
- Only events with `updated` timestamp >= `updatedMin` are returned
- Includes created, modified, and deleted events
- Deleted events have `status: 'cancelled'`

---

### 4. Get Event Details

**Purpose**: Fetch full details of a specific event

**Method**: `calendar.events.get()`

**Request**:
```typescript
interface GetEventRequest {
  calendarId: string;
  eventId: string;
}

// Example
const event = await calendar.events.get({
  calendarId: 'hirose30@hoge.jp',
  eventId: 'evt_abc123def456',
});
```

**Response**:
```typescript
interface CalendarEvent {
  kind: 'calendar#event';
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink: string;
  created: string;
  updated: string;
  summary: string;          // Event title
  description?: string;
  location?: string;
  creator: {
    email: string;
    displayName?: string;
    self?: boolean;
  };
  organizer: {
    email: string;
    displayName?: string;
    self?: boolean;
  };
  start: {
    dateTime?: string;      // ISO 8601 with timezone
    date?: string;          // Date-only for all-day events
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    organizer?: boolean;
    self?: boolean;
    resource?: boolean;
    optional?: boolean;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    comment?: string;
    additionalGuests?: number;
  }>;
  recurrence?: string[];    // RRULE, EXDATE, etc.
  recurringEventId?: string;
  iCalUID: string;
}
```

**Error Codes**:
- `404 Not Found`: Event doesn't exist or was deleted
- `410 Gone`: Event was permanently deleted (not in trash)

---

### 5. Update Event Attendees

**Purpose**: Add secondary workspace users to event attendee list

**Method**: `calendar.events.patch()`

**Request**:
```typescript
interface PatchEventRequest {
  calendarId: string;
  eventId: string;
  requestBody: {
    attendees: Array<{
      email: string;
      optional?: boolean;
      responseStatus?: 'needsAction';
    }>;
  };
  sendUpdates?: 'all' | 'externalOnly' | 'none'; // Send email notifications
}

// Example: Add secondary attendees
const event = await calendar.events.get({ calendarId, eventId });
const currentAttendees = event.data.attendees || [];
const newAttendees = [
  ...currentAttendees,
  { email: 'hirose30@fuga.jp', responseStatus: 'needsAction' },
  { email: 'hirose30@baz.jp', responseStatus: 'needsAction' },
];

await calendar.events.patch({
  calendarId: 'hirose30@hoge.jp',
  eventId: 'evt_abc123',
  requestBody: {
    attendees: newAttendees,
  },
  sendUpdates: 'all', // Send calendar invitations to new attendees
});
```

**Response**: Updated `CalendarEvent` object with new attendees

**Important**:
- `sendUpdates: 'all'` sends email notifications to all attendees (including newly added)
- `sendUpdates: 'externalOnly'` sends only to attendees outside the organizer's domain
- `sendUpdates: 'none'` skips email notifications (attendees won't be notified)
- Use `'all'` or `'externalOnly'` for cross-workspace sync to ensure users receive invitations

**Duplicate Handling**:
- Google Calendar de-duplicates attendees by email address automatically
- Safe to add an email that's already in the attendees list (no error, but no duplicate created)
- Recommendation: Check if email exists in `attendees` array before patching to avoid unnecessary API calls

**Error Codes**:
- `400 Bad Request`: Invalid attendee email format
- `403 Forbidden`: Insufficient permissions to modify event (e.g., not organizer, private event)
- `404 Not Found`: Event doesn't exist

---

## Sync Logic Workflow

### Complete Event Processing Flow

```typescript
async function processWebhookNotification(
  channelId: string,
  resourceState: string
): Promise<void> {
  // 1. Lookup channel to get calendar ID
  const channelInfo = watchRegistry.get(channelId);
  if (!channelInfo) {
    logger.warn('Unknown channel', { channelId });
    return;
  }

  if (resourceState === 'sync') {
    logger.info('Initial sync message, ignoring', { channelId });
    return;
  }

  if (resourceState === 'not_exists') {
    logger.info('Event deleted, ignoring (handled by Google Calendar)', { channelId });
    return;
  }

  const calendarId = channelInfo.calendarId;

  // 2. Fetch recent events
  const calendar = getCalendarClient(calendarId);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data } = await calendar.events.list({
    calendarId,
    updatedMin: fiveMinutesAgo,
    singleEvents: true,
    maxResults: 100,
  });

  // 3. Process each event
  for (const event of data.items || []) {
    if (event.status === 'cancelled') {
      logger.info('Event cancelled, skipping', { eventId: event.id });
      continue;
    }

    // 4. Check deduplication cache
    if (syncStateCache.isProcessed(event.id!, resourceState)) {
      logger.debug('Event already processed', { eventId: event.id });
      continue;
    }

    // 5. Resolve mappings
    const attendees = event.attendees || [];
    const primaryAttendees = attendees.filter(
      (a) => a.email && userMappings.hasPrimaryUser(a.email)
    );

    if (primaryAttendees.length === 0) {
      logger.debug('No mapped primary attendees', { eventId: event.id });
      continue;
    }

    // 6. Collect secondary emails to add
    const secondariesToAdd = new Set<string>();
    for (const primary of primaryAttendees) {
      const secondaries = userMappings.getSecondaries(primary.email!);
      if (secondaries) {
        for (const secondary of secondaries) {
          // Check if already an attendee
          if (!attendees.some((a) => a.email === secondary)) {
            secondariesToAdd.add(secondary);
          }
        }
      }
    }

    if (secondariesToAdd.size === 0) {
      logger.info('All secondaries already attendees', { eventId: event.id });
      continue;
    }

    // 7. Add secondary attendees with retry
    const newAttendees = [
      ...attendees,
      ...Array.from(secondariesToAdd).map((email) => ({
        email,
        responseStatus: 'needsAction' as const,
      })),
    ];

    await withRetry(async () => {
      await calendar.events.patch({
        calendarId,
        eventId: event.id!,
        requestBody: { attendees: newAttendees },
        sendUpdates: 'all',
      });
    });

    // 8. Cache sync record
    syncStateCache.set(event.id!, resourceState, {
      eventId: event.id!,
      calendarId,
      resourceState,
      processedAt: Date.now(),
      appliedMappings: primaryAttendees.map((p) => ({
        primary: p.email!,
        secondaries: userMappings.getSecondaries(p.email!) || [],
      })),
    });

    logger.info('Event synced successfully', {
      eventId: event.id,
      addedAttendees: Array.from(secondariesToAdd),
    });
  }
}
```

## Rate Limits & Quotas

### Google Calendar API Quotas (per project)

- **Queries per day**: 1,000,000 (default)
- **Queries per 100 seconds per user**: 1,500
- **Queries per 100 seconds**: 50,000

### Estimated Usage (100 mapped users)

- **Watch registration**: 100 channels × 1 request = 100 requests (at startup)
- **Channel renewal**: 100 channels × 1 request/week = ~14 requests/day
- **Event listing** (per webhook): 1 request × ~50 webhooks/day = 50 requests/day
- **Event patching**: ~50 events/day × 1 request = 50 requests/day

**Total**: ~214 requests/day (well within quota)

### Rate Limit Handling

```typescript
async function withRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (error.code === 429) {
      // Rate limit exceeded - exponential backoff handled by retry logic
      const retryAfter = error.response?.headers['retry-after'];
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : 30000;
      logger.warn('Rate limit hit, retrying after delay', { delay });
      await sleep(delay);
      return await operation();
    }
    throw error;
  }
}
```

## Error Handling

### Transient Errors (Retry)

- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Google API temporary issue
- `502 Bad Gateway`: Proxy or network issue
- `503 Service Unavailable`: Google API overloaded
- `ECONNRESET`, `ETIMEDOUT`: Network failures

### Permanent Errors (Log & Skip)

- `400 Bad Request`: Invalid request (malformed email, etc.)
- `401 Unauthorized`: Authentication failed (service account issue)
- `403 Forbidden`: Insufficient permissions (missing domain-wide delegation or event is private)
- `404 Not Found`: Calendar or event doesn't exist
- `410 Gone`: Event permanently deleted

## Testing

### Mock Calendar Client

```typescript
import { calendar_v3 } from 'googleapis';

const mockCalendar: Partial<calendar_v3.Calendar> = {
  events: {
    watch: jest.fn().mockResolvedValue({
      data: {
        kind: 'api#channel',
        id: 'test-channel-123',
        resourceId: 'test-resource-id',
        expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    }),
    list: jest.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt_123',
            status: 'confirmed',
            summary: 'Test Event',
            attendees: [
              { email: 'hirose30@hoge.jp', responseStatus: 'accepted' },
            ],
          },
        ],
      },
    }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
  channels: {
    stop: jest.fn().mockResolvedValue({}),
  },
};
```

## References

- [Calendar API Reference](https://developers.google.com/calendar/api/v3/reference)
- [Push Notifications](https://developers.google.com/calendar/api/guides/push)
- [Events: watch](https://developers.google.com/calendar/api/v3/reference/events/watch)
- [Events: list](https://developers.google.com/calendar/api/v3/reference/events/list)
- [Events: patch](https://developers.google.com/calendar/api/v3/reference/events/patch)
- [Rate Limits](https://developers.google.com/calendar/api/guides/quota)
