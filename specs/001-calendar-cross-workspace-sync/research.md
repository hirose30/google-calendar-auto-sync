# Research: Cross-Workspace Calendar Synchronization

**Feature**: Cross-Workspace Calendar Event Synchronization
**Date**: 2025-10-28
**Purpose**: Document technology choices and architecture decisions for minimal TypeScript implementation

## Overview

This document captures research findings and decisions for building a minimal calendar synchronization service using TypeScript, with no external storage dependencies and in-memory state management.

## Key Decisions

### 1. Language & Runtime

**Decision**: TypeScript 5.3+ with Node.js 20 LTS

**Rationale**:
- TypeScript provides type safety for Google Calendar API interactions (complex event/attendee structures)
- Node.js 20 LTS offers stable async/await patterns ideal for API-heavy workloads
- Excellent `googleapis` library support with TypeScript definitions
- Minimal resource footprint suitable for single-process deployment

**Alternatives Considered**:
- **Python**: Strong Google API support, but less type safety and heavier runtime
- **Go**: Excellent performance, but steeper learning curve and less flexible for rapid prototyping

### 2. Google Calendar Push Notifications

**Decision**: Use Google Calendar Push Notifications (webhook-based) for real-time event detection

**Rationale**:
- Near real-time delivery (<1 minute typically) meets 2-minute SLA requirement
- Avoids polling overhead and API quota consumption
- Standard Google Cloud pattern with good documentation
- Webhook endpoint can be served by simple Express server

**Implementation Details**:
- Register watch channels via Calendar API `watch()` method for each mapped user's calendar
- Receive POST notifications at `/webhook` endpoint when events change
- Notification contains `resourceId` and `channelId` but NOT event details (must fetch via API)
- Channel expiration: ~1 week (requires periodic re-registration logic)

**Alternatives Considered**:
- **Periodic Polling**: Simpler but higher latency (5-15 min intervals), higher API quota usage
- **Cloud Pub/Sub**: More infrastructure, overkill for minimal setup

**References**:
- https://developers.google.com/calendar/api/guides/push
- https://developers.google.com/calendar/api/v3/reference/events/watch

### 3. Storage Strategy

**Decision**: Google Spreadsheet for user mappings + in-memory cache, no external database

**Rationale**:
- **User Mappings Source**: Google Spreadsheet provides non-technical admin interface
  - Admins can edit mappings without code changes or deployments
  - Built-in change history and audit trail
  - Collaborative editing for multiple administrators
  - Familiar UI for non-developers
  - Uses same Google authentication as Calendar API (no additional auth setup)
- **Performance**: Cached in-memory after initial load (1-2 second fetch, then <1ms lookups)
- **Synchronization state**: Ephemeral in-memory cache (acceptable - Calendar API is source of truth)
- Eliminates database operational complexity and cost

**In-Memory State**:
```typescript
// User mappings: primary email -> list of secondary emails (cached from Spreadsheet)
const userMappings: Map<string, string[]> = new Map();

// Deduplication cache: event ID + sync token -> timestamp
const processedEvents: Map<string, number> = new Map();

// Watch channel registry: channel ID -> {calendarId, expiration}
const activeChannels: Map<string, ChannelInfo> = new Map();

// Spreadsheet cache metadata
let mappingsCacheTimestamp: number = 0;
const CACHE_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
```

**Google Spreadsheet Format**:

Spreadsheet structure (example: `User Mappings` sheet):
```
| Primary Email          | Secondary Emails                        | Status   |
|------------------------|-----------------------------------------|----------|
| hirose30@hoge.jp       | hirose30@fuga.jp, hirose30@baz.jp      | active   |
| user1@hoge.jp          | user1@fuga.jp                           | active   |
| user2@hoge.jp          | user2@fuga.jp                           | inactive |
```

**Loading Strategy**:
1. **Startup**: Fetch from Spreadsheet, cache in-memory (blocking - must succeed to start)
2. **Periodic Refresh**: Re-fetch every 5 minutes in background (non-blocking)
3. **On Refresh Failure**: Log error, keep using stale cache (service continues operating)
4. **Cache Invalidation**: Manual API endpoint `/admin/reload-mappings` for immediate refresh

**Implementation** (using Google Sheets API):
```typescript
import { google } from 'googleapis';

async function loadUserMappings(spreadsheetId: string): Promise<Map<string, string[]>> {
  const sheets = google.sheets({ version: 'v4', auth: jwtClient });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'User Mappings!A2:C', // Skip header row
  });

  const mappings = new Map<string, string[]>();

  for (const row of response.data.values || []) {
    const [primary, secondariesStr, status] = row;

    // Skip inactive or invalid entries
    if (status === 'inactive' || !primary || !secondariesStr) continue;

    // Parse comma-separated secondary emails
    const secondaries = secondariesStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (secondaries.length > 0) {
      mappings.set(primary, secondaries);
    }
  }

  return mappings;
}

// Periodic refresh
setInterval(async () => {
  try {
    const newMappings = await loadUserMappings(SPREADSHEET_ID);
    userMappings.clear();
    for (const [key, value] of newMappings) {
      userMappings.set(key, value);
    }
    mappingsCacheTimestamp = Date.now();
    logger.info('User mappings refreshed from Spreadsheet', {
      count: userMappings.size
    });
  } catch (error) {
    logger.error('Failed to refresh user mappings, using stale cache', { error });
  }
}, CACHE_REFRESH_INTERVAL_MS);
```

**Trade-offs**:
- ✅ **Admin-friendly**: Non-technical users can manage mappings via familiar Spreadsheet UI
- ✅ **Fast lookups**: In-memory cache provides <1ms response time
- ✅ **Audit trail**: Spreadsheet version history tracks all changes
- ✅ **Hot reload**: Changes propagate within 5 minutes without service restart
- ⚠️  **Initial latency**: 1-2 second Spreadsheet fetch at startup (acceptable)
- ⚠️  **Stale data risk**: Up to 5 minutes delay for mapping changes (mitigated by manual reload endpoint)
- ⚠️  **Additional API dependency**: Requires Sheets API access (minimal quota impact: ~288 reads/day)

**Performance Characteristics**:
- **Spreadsheet read**: 1-2 seconds (once per 5 minutes)
- **In-memory lookup**: <1ms (all sync operations)
- **Sheets API quota**: 100 reads/100 seconds (our usage: ~0.003 reads/second = well within limits)

**Alternatives Considered**:
- **Local JSON file**: Requires code deployment for updates, no collaborative editing
- **Firestore**: Persistent state, but adds database complexity and cost
- **SQLite**: Local persistent storage, but requires file I/O and migration management
- **Redis**: Fast in-memory with persistence, but requires separate service

### 4. Authentication & Authorization

**Decision**: Google Service Account with Domain-Wide Delegation

**Rationale**:
- Service accounts can impersonate any user in the Google Workspace domain
- Required for accessing multiple users' calendars without individual OAuth flows
- Credentials stored in `config/service-account-key.json` (not committed to git)
- Workspace admin grants domain-wide delegation for Calendar API scopes

**Required Scopes**:
- `https://www.googleapis.com/auth/calendar` - Full calendar access (read events, modify attendees)
- `https://www.googleapis.com/auth/calendar.events` - Event-specific access

**Setup Steps** (documented in quickstart.md):
1. Create service account in Google Cloud Console
2. Enable Calendar API
3. Download service account key JSON
4. In Google Workspace Admin, grant domain-wide delegation with Calendar scopes
5. Configure service account email in `config/service-account-key.json`

**Alternatives Considered**:
- **OAuth 2.0 User Consent**: Requires each user to grant access individually (doesn't scale)
- **API Keys**: Insufficient for accessing private calendar data

**References**:
- https://developers.google.com/identity/protocols/oauth2/service-account
- https://support.google.com/a/answer/162106

### 5. Deduplication Strategy

**Decision**: In-memory cache with event ID + resource state token

**Rationale**:
- Google Calendar sends multiple notifications for the same event change
- Cache key: `${eventId}-${resourceState}` prevents re-processing the same state
- TTL: 5 minutes (cleared periodically to prevent memory growth)
- On cache miss: Fetch event from Calendar API and compare attendee lists before modifying

**Implementation**:
```typescript
interface ProcessedEventRecord {
  eventId: string;
  calendarId: string;
  syncToken: string;
  processedAt: number; // timestamp
  appliedMappings: string[]; // secondary emails added
}

// Deduplication check
function isAlreadyProcessed(eventId: string, syncToken: string): boolean {
  const cacheKey = `${eventId}-${syncToken}`;
  const record = processedEvents.get(cacheKey);
  if (!record) return false;

  // Consider processed if within last 5 minutes
  return (Date.now() - record) < 5 * 60 * 1000;
}
```

**Edge Cases Handled**:
- Multiple rapid updates: Only final state processed (webhook coalescing)
- Restart during processing: State lost, but Calendar API fetch will show current attendees
- Chained mappings (A→B, B→C): Only process primary workspace users (B→C ignored per FR-011)

**Alternatives Considered**:
- **Persistent deduplication log**: More reliable but requires storage
- **No deduplication**: Relies entirely on Google Calendar's duplicate prevention (insufficient per testing)

### 6. Retry Logic

**Decision**: In-process retry with exponential backoff (5 attempts, 30s intervals per spec clarification)

**Rationale**:
- Handles transient API errors (rate limits, network blips)
- Clarification specified fixed 30s intervals (not exponential) for simplicity
- After 5 failures: Log error and abandon (manual intervention required per monitoring approach)

**Implementation**:
```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 5,
  delayMs: number = 30000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) {
        console.error(`Operation failed after ${maxAttempts} attempts`, error);
        throw error;
      }
      console.warn(`Attempt ${attempt} failed, retrying in ${delayMs}ms`, error);
      await sleep(delayMs);
    }
  }
  throw new Error('Unreachable');
}
```

**Retry Categories**:
- **Transient (retry)**: 429 Rate Limit, 500/502/503 Server Errors, ECONNRESET
- **Permanent (no retry)**: 400 Bad Request, 401 Unauthorized, 404 Not Found

**Alternatives Considered**:
- **Queue-based retry**: More robust but requires external queue infrastructure
- **Exponential backoff**: More sophisticated but spec specified fixed intervals

### 7. Logging Strategy

**Decision**: Structured JSON logging to stdout/stderr with log levels

**Rationale**:
- Stdout/stderr captured by container platforms (Cloud Run, Docker, Kubernetes)
- JSON format enables parsing by log aggregation tools (Cloud Logging, Datadog, etc.)
- No SDK dependencies (winston or pino libraries optional)
- Log levels: ERROR (stderr), WARN/INFO/DEBUG (stdout)

**Log Structure**:
```typescript
interface LogEntry {
  timestamp: string; // ISO 8601
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  message: string;
  context?: {
    eventId?: string;
    calendarId?: string;
    primaryUser?: string;
    secondaryUsers?: string[];
    operation?: string;
    duration?: number; // ms
    error?: { message: string; stack?: string };
  };
}
```

**Key Log Points**:
- Webhook received (calendarId, resourceState)
- Event fetched from Calendar API (eventId, attendees count)
- Mapping resolution (primary user → secondary users)
- Attendee addition attempts (success/failure per secondary user)
- Retry attempts (attempt number, error type)
- Final outcome (success, partial success, failure)

**Alternatives Considered**:
- **Cloud Logging SDK**: Adds dependency, overkill for minimal setup
- **File-based logging**: Requires log rotation, harder to aggregate

### 8. Project Structure

**Decision**: Simple single-service structure with TypeScript

```
src/
├── index.ts              # Entry point: Express server + webhook handler
├── calendar/
│   ├── client.ts         # Google Calendar API client wrapper
│   ├── watcher.ts        # Push notification setup + channel management
│   └── sync.ts           # Core sync logic: fetch event, resolve mappings, add attendees
├── config/
│   ├── loader.ts         # Load user-mappings.json + service account key
│   └── types.ts          # UserMapping, ServiceAccountConfig types
├── utils/
│   ├── logger.ts         # Structured logging utilities
│   ├── retry.ts          # Retry with fixed backoff
│   └── dedup.ts          # In-memory deduplication cache
└── types/
    └── calendar.ts       # TypeScript types for Calendar API objects

tests/
├── unit/
│   ├── sync.test.ts      # Unit tests for sync logic
│   ├── dedup.test.ts     # Deduplication cache tests
│   └── retry.test.ts     # Retry logic tests
└── integration/
    └── webhook.test.ts   # Supertest for webhook endpoint

config/
├── user-mappings.json         # User mapping configuration (gitignored template)
└── service-account-key.json   # Service account credentials (gitignored)
```

**Rationale**:
- Flat structure suitable for small codebase (<2000 LOC estimated)
- Clear separation: calendar operations, configuration, utilities
- Tests mirror source structure
- Config directory separate from code (environment-specific files)

**Alternatives Considered**:
- **Monorepo with packages**: Overkill for single service
- **Layered architecture** (controllers/services/repositories): Too heavyweight for minimal setup

## Technology Stack Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Language** | TypeScript 5.3+ | Type safety, Google API support |
| **Runtime** | Node.js 20 LTS | Stable async patterns, minimal footprint |
| **Web Server** | Express 4.x | Simple webhook endpoint hosting |
| **Google API Client** | `googleapis` npm package | Official Google Calendar API client |
| **Authentication** | Service Account + Domain-Wide Delegation | Access multiple users' calendars |
| **Event Detection** | Google Calendar Push Notifications | Real-time webhook delivery |
| **Storage** | In-memory (Map/Set) + JSON config file | No external database dependencies |
| **Testing** | Jest + Supertest | Standard Node.js testing stack |
| **Logging** | Structured JSON to stdout/stderr | Container-friendly, no SDK needed |
| **Deployment** | Docker container (Cloud Run compatible) | Portable, minimal infrastructure |

## Open Questions / Future Considerations

1. **Channel Re-registration**: Watch channels expire after ~1 week. Need periodic job to re-register.
   - **Solution**: Simple setInterval() loop in main process to refresh channels 1 day before expiration

2. **Horizontal Scaling**: In-memory state not shared across instances.
   - **MVP**: Single instance deployment sufficient for 50-100 users
   - **Future**: Add Redis for shared deduplication cache if scaling needed

3. **Configuration Updates**: Requires process restart to reload user-mappings.json.
   - **MVP**: Acceptable - mappings change infrequently
   - **Future**: File watcher (`chokidar`) for hot reload without restart

4. **Monitoring**: Manual log review during MVP.
   - **Future**: Add Prometheus metrics endpoint for automated alerting

5. **Security**: Service account key in config file.
   - **MVP**: Secure with file permissions (0600) and .gitignore
   - **Production**: Use Secret Manager or environment variables for key management

## Next Steps

1. **Phase 1**: Generate data-model.md with in-memory entity definitions
2. **Phase 1**: Create API contracts (webhook payload, Calendar API interactions)
3. **Phase 1**: Write quickstart.md with setup instructions (service account, domain delegation, config files)
4. **Phase 2**: Break down into implementation tasks in tasks.md
