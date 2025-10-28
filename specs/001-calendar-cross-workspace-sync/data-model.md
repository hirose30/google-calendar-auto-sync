# Data Model: Cross-Workspace Calendar Synchronization

**Feature**: Cross-Workspace Calendar Event Synchronization
**Date**: 2025-10-28
**Storage**: In-memory (TypeScript Map/Set structures) + JSON configuration file

## Overview

This document defines the data structures used in the calendar synchronization system. All runtime state is stored in-memory using native TypeScript/JavaScript collections. User mappings are loaded from a JSON configuration file at startup.

## Configuration Entities (Google Spreadsheet)

### UserMappingConfig

**Storage**: Google Spreadsheet (specified by `SPREADSHEET_ID` environment variable)
**Sheet Name**: `User Mappings`
**Purpose**: Defines which primary workspace users have corresponding secondary workspace identities

**Spreadsheet Structure**:

| Column A: Primary Email | Column B: Secondary Emails | Column C: Status |
|-------------------------|----------------------------|------------------|
| hirose30@hoge.jp       | hirose30@fuga.jp, hirose30@baz.jp | active |
| user1@hoge.jp          | user1@fuga.jp              | active |
| user2@hoge.jp          | user2@fuga.jp              | inactive |

**TypeScript Representation**:
```typescript
interface UserMappingRow {
  primary: string;        // Column A: Primary workspace email
  secondariesStr: string; // Column B: Comma-separated secondary emails
  status: 'active' | 'inactive' | ''; // Column C: Status (empty = active)
}

interface UserMapping {
  primary: string;        // Primary workspace email (e.g., "hirose30@hoge.jp")
  secondaries: string[];  // Parsed list of secondary emails (e.g., ["hirose30@fuga.jp", "hirose30@baz.jp"])
  status: 'active' | 'inactive'; // Defaults to 'active' if empty
}
```

**Loading via Google Sheets API**:
```typescript
import { google, sheets_v4 } from 'googleapis';

async function loadUserMappings(
  spreadsheetId: string,
  auth: any
): Promise<UserMapping[]> {
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'User Mappings!A2:C', // Skip header row
  });

  const mappings: UserMapping[] = [];

  for (const row of response.data.values || []) {
    const [primary, secondariesStr, status] = row;

    // Skip rows without primary email
    if (!primary || !secondariesStr) continue;

    // Skip inactive mappings
    const mappingStatus = (status || 'active') as 'active' | 'inactive';
    if (mappingStatus === 'inactive') continue;

    // Parse comma-separated secondary emails
    const secondaries = secondariesStr
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && s.includes('@'));

    if (secondaries.length > 0) {
      mappings.push({ primary, secondaries, status: mappingStatus });
    }
  }

  return mappings;
}
```

**Validation Rules**:
- `primary`: Must be valid email format, must end with primary workspace domain (hoge.jp)
- `secondaries`: Comma-separated list of valid email addresses, must NOT include primary workspace domain
- Uniqueness: Each `primary` email should appear only once (enforced at load time - last entry wins)
- Status: Defaults to 'active' if empty; inactive mappings are skipped during load

**Loading Strategy**:
1. **Startup**: Fetch from Spreadsheet, cache in-memory (blocking - must succeed to start)
2. **Periodic Refresh**: Re-fetch every 5 minutes in background (non-blocking)
3. **On Refresh Failure**: Log error, keep using stale cache (service continues operating)
4. **Manual Reload**: Optional admin endpoint `/admin/reload-mappings` for immediate refresh

**Cache Metadata**:
```typescript
interface MappingsCacheMetadata {
  lastLoadedAt: number;      // Unix timestamp (ms)
  lastLoadSuccess: boolean;  // True if last load succeeded
  loadErrors: number;        // Consecutive load error count
  mappingCount: number;      // Number of active mappings in cache
}
```

**Spreadsheet Setup**:
1. Create new Google Spreadsheet
2. Create sheet named `User Mappings`
3. Add header row: `Primary Email | Secondary Emails | Status`
4. Share with service account email (Viewer permission)
5. Copy Spreadsheet ID from URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
6. Set `SPREADSHEET_ID` environment variable

---

### ServiceAccountConfig

**Storage**: `config/service-account-key.json`
**Purpose**: Google Service Account credentials for Calendar API authentication

**Structure**: Standard Google Service Account JSON format
```typescript
interface ServiceAccountConfig {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}
```

**Security**:
- File permissions: 0600 (read/write owner only)
- Must be in .gitignore
- Required scopes: `https://www.googleapis.com/auth/calendar`

---

## Runtime Entities (In-Memory)

### UserMappingStore

**Storage**: `Map<string, string[]>`
**Purpose**: Fast lookup of secondary emails for a given primary email

**Structure**:
```typescript
class UserMappingStore {
  private mappings: Map<string, string[]>;

  constructor(config: UserMappingConfig) {
    this.mappings = new Map();
    for (const mapping of config.mappings) {
      if (mapping.status !== 'inactive') {
        this.mappings.set(mapping.primary, mapping.secondaries);
      }
    }
  }

  getSecondaries(primaryEmail: string): string[] | undefined {
    return this.mappings.get(primaryEmail);
  }

  getAllPrimaries(): string[] {
    return Array.from(this.mappings.keys());
  }

  hasPrimaryUser(email: string): boolean {
    return this.mappings.has(email);
  }
}
```

**Operations**:
- `getSecondaries(primary)`: O(1) lookup of secondary emails
- `getAllPrimaries()`: Returns list of all primary emails to monitor
- `hasPrimaryUser(email)`: Check if email is a mapped primary user

**Lifecycle**:
- Initialized at startup from UserMappingConfig
- Immutable during runtime (config updates require restart)

---

### SyncStateCache

**Storage**: `Map<string, SyncRecord>`
**Purpose**: Deduplication cache to prevent re-processing the same event state

**Structure**:
```typescript
interface SyncRecord {
  eventId: string;
  calendarId: string;
  resourceState: string;  // From webhook notification
  processedAt: number;    // Unix timestamp (ms)
  appliedMappings: {      // Which secondaries were added
    primary: string;
    secondaries: string[];
  }[];
}

class SyncStateCache {
  private cache: Map<string, SyncRecord>;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  set(eventId: string, resourceState: string, record: SyncRecord): void {
    const cacheKey = `${eventId}-${resourceState}`;
    this.cache.set(cacheKey, record);
  }

  get(eventId: string, resourceState: string): SyncRecord | undefined {
    const cacheKey = `${eventId}-${resourceState}`;
    const record = this.cache.get(cacheKey);
    if (!record) return undefined;

    // Check TTL
    if (Date.now() - record.processedAt > this.TTL_MS) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return record;
  }

  isProcessed(eventId: string, resourceState: string): boolean {
    return this.get(eventId, resourceState) !== undefined;
  }

  // Periodic cleanup to prevent memory growth
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.cache.entries()) {
      if (now - record.processedAt > this.TTL_MS) {
        this.cache.delete(key);
      }
    }
  }
}
```

**Cache Key**: `${eventId}-${resourceState}`
- `eventId`: Google Calendar event ID (e.g., "abc123def456")
- `resourceState`: State token from webhook notification (e.g., "sync", "exists", "not_exists")

**TTL**: 5 minutes
- Records older than 5 minutes are considered stale and removed
- Prevents memory growth from long-running process
- Cleanup runs every 1 minute via `setInterval()`

**Operations**:
- `set(eventId, resourceState, record)`: Store sync record
- `get(eventId, resourceState)`: Retrieve record if within TTL
- `isProcessed(eventId, resourceState)`: Check if already synced
- `cleanup()`: Remove expired records

---

### WatchChannelRegistry

**Storage**: `Map<string, ChannelInfo>`
**Purpose**: Track active Google Calendar push notification channels

**Structure**:
```typescript
interface ChannelInfo {
  channelId: string;      // UUID generated when registering channel
  calendarId: string;     // Which calendar this channel watches (e.g., "hirose30@hoge.jp")
  resourceId: string;     // Opaque ID returned by Google Calendar API
  expiration: number;     // Unix timestamp (ms) when channel expires
  token?: string;         // Optional verification token for webhook
}

class WatchChannelRegistry {
  private channels: Map<string, ChannelInfo>; // channelId -> ChannelInfo

  register(info: ChannelInfo): void {
    this.channels.set(info.channelId, info);
  }

  get(channelId: string): ChannelInfo | undefined {
    return this.channels.get(channelId);
  }

  unregister(channelId: string): void {
    this.channels.delete(channelId);
  }

  getExpiringSoon(thresholdMs: number = 24 * 60 * 60 * 1000): ChannelInfo[] {
    const now = Date.now();
    const threshold = now + thresholdMs;
    return Array.from(this.channels.values()).filter(
      (ch) => ch.expiration < threshold
    );
  }

  getByCalendar(calendarId: string): ChannelInfo | undefined {
    return Array.from(this.channels.values()).find(
      (ch) => ch.calendarId === calendarId
    );
  }
}
```

**Channel Lifecycle**:
1. **Registration**: When app starts, register watch channel for each mapped primary user's calendar
2. **Renewal**: Channels expire after ~7 days; renew 1 day before expiration
3. **Cleanup**: Remove expired channels from registry

**Operations**:
- `register(info)`: Add new channel to registry
- `get(channelId)`: Lookup channel info from webhook notification
- `unregister(channelId)`: Remove channel (on expiration or app shutdown)
- `getExpiringSoon(threshold)`: Find channels needing renewal
- `getByCalendar(calendarId)`: Check if calendar already has active channel

---

## External API Entities (Google Calendar API)

### CalendarEvent

**Source**: Google Calendar API `calendar.events.get()` response
**Purpose**: Represents a calendar event that may need synchronization

**Key Fields** (from googleapis):
```typescript
interface CalendarEvent {
  id: string;                    // Unique event ID
  kind: 'calendar#event';
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;              // Event title
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: EventAttendee[];   // KEY: List of attendees
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  creator?: {
    email?: string;
    displayName?: string;
  };
  iCalUID?: string;
  recurringEventId?: string;     // If part of recurring series
}

interface EventDateTime {
  dateTime?: string;             // ISO 8601 format (with timezone)
  date?: string;                 // Date-only (all-day events)
  timeZone?: string;
}

interface EventAttendee {
  email: string;                 // Attendee email (primary key for sync logic)
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  optional?: boolean;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  comment?: string;
}
```

**Sync Logic Usage**:
- Fetch event via `calendar.events.get(calendarId, eventId)`
- Extract `attendees` array
- Check which attendees are primary workspace users with mappings
- For each mapped primary attendee, add corresponding secondaries to `attendees` array
- Update event via `calendar.events.patch(calendarId, eventId, { attendees })`

**Validation Rules**:
- Must have at least one primary workspace attendee (hoge.jp) to trigger sync
- Skip if `status === 'cancelled'`
- Attendee uniqueness: Check if secondary already in `attendees` before adding

---

### WebhookNotification

**Source**: POST request to `/webhook` endpoint from Google Calendar
**Purpose**: Notifies system when calendar events change

**Headers**:
```typescript
interface WebhookHeaders {
  'x-goog-channel-id': string;        // Matches registered channelId
  'x-goog-channel-token'?: string;    // Optional verification token
  'x-goog-resource-id': string;       // Opaque resource ID from Google
  'x-goog-resource-state': string;    // "sync" | "exists" | "not_exists"
  'x-goog-resource-uri': string;      // Calendar resource URI
  'x-goog-message-number': string;    // Sequential message number
}
```

**Body**: Empty (Google Calendar push notifications don't include event details)

**Processing Flow**:
1. Extract `channelId` from headers
2. Lookup `ChannelInfo` in `WatchChannelRegistry` to get `calendarId`
3. Check `resourceState`:
   - `"sync"`: Initial sync message (ignore)
   - `"exists"`: Event created or updated (fetch and process)
   - `"not_exists"`: Event deleted (no action - handled by Google Calendar natively)
4. List recent events via `calendar.events.list()` with `updatedMin` filter
5. For each event, check deduplication cache and process if needed

**Security**:
- Optional: Verify `x-goog-channel-token` matches registered token
- Validate `channelId` exists in registry (ignore unknown channels)

---

## State Transitions

### Event Processing State Machine

```
┌──────────────┐
│ Webhook      │
│ Received     │
└──────┬───────┘
       │
       ▼
┌──────────────┐     Yes    ┌──────────────┐
│ Is Processed?├───────────►│ Skip (cached)│
│ (Dedup Check)│            └──────────────┘
└──────┬───────┘
       │ No
       ▼
┌──────────────┐
│ Fetch Event  │
│ from API     │
└──────┬───────┘
       │
       ▼
┌──────────────┐     No     ┌──────────────┐
│ Has Primary  ├───────────►│ Skip (no     │
│ Attendees?   │            │ mapping)     │
└──────┬───────┘            └──────────────┘
       │ Yes
       ▼
┌──────────────┐
│ Resolve      │
│ Mappings     │
└──────┬───────┘
       │
       ▼
┌──────────────┐     Exists  ┌──────────────┐
│ Check        ├────────────►│ Skip Adding  │
│ Secondary    │             │ (duplicate)  │
│ Already      │             └──────────────┘
│ Attendee?    │
└──────┬───────┘
       │ Not Present
       ▼
┌──────────────┐
│ Add Secondary│
│ Attendees    │
│ (with Retry) │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Cache Sync   │
│ Record       │
└──────────────┘
```

### Watch Channel Lifecycle

```
┌──────────────┐
│ App Startup  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Load User    │
│ Mappings     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Register     │
│ Watch        │
│ Channels for │
│ Each Primary │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Active       │
│ Monitoring   │◄────┐
└──────┬───────┘     │
       │             │
       ▼             │
┌──────────────┐     │
│ Check        │     │
│ Expiration   │     │
│ (Daily)      │     │
└──────┬───────┘     │
       │             │
       ▼     No      │
┌──────────────┐     │
│ Expiring     ├─────┘
│ Soon?        │
└──────┬───────┘
       │ Yes
       ▼
┌──────────────┐
│ Unregister + │
│ Re-register  │
│ Channel      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Update       │
│ Registry     │
└──────────────┘
```

## Memory Management

### Estimated Memory Footprint

Assumptions:
- 100 mapped users
- Average 50 events per user in 5-minute dedup window
- Each SyncRecord ~200 bytes

**UserMappingStore**:
- 100 entries × (50 bytes primary + 100 bytes secondaries) = 15 KB

**SyncStateCache**:
- 5000 events × 200 bytes = 1 MB (peak)
- Cleaned up every minute, removing expired entries

**WatchChannelRegistry**:
- 100 channels × 150 bytes = 15 KB

**Total Runtime Memory**: ~1.5 MB (negligible compared to Node.js base ~30-50 MB)

### Cleanup Strategy

- **SyncStateCache**: Cleanup every 60 seconds, remove entries older than 5 minutes
- **WatchChannelRegistry**: Remove expired channels on renewal check (daily)
- No cleanup needed for UserMappingStore (static after load)

## Summary

This data model provides:
- ✅ **Simple configuration**: Single JSON file for user mappings
- ✅ **Fast lookups**: O(1) mapping resolution via Map
- ✅ **Deduplication**: TTL-based cache prevents redundant processing
- ✅ **Minimal memory**: <2 MB for 100 users, 5000 cached events
- ✅ **No external dependencies**: Pure in-memory with native TypeScript collections
- ✅ **Graceful restarts**: State loss acceptable as Calendar API is source of truth
