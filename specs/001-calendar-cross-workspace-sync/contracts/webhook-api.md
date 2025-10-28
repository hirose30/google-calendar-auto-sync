# Webhook API Contract

**Service**: Calendar Sync Webhook Handler
**Protocol**: HTTP POST
**Purpose**: Receive Google Calendar push notifications when events change

## Endpoint

```
POST /webhook
```

## Request

### Headers (Required)

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `x-goog-channel-id` | string | UUID of the registered watch channel | `"550e8400-e29b-41d4-a716-446655440000"` |
| `x-goog-resource-id` | string | Opaque identifier for the watched resource | `"o3bg70..." ` |
| `x-goog-resource-state` | string | Type of notification | `"sync"` \| `"exists"` \| `"not_exists"` |
| `x-goog-resource-uri` | string | URI of the watched calendar resource | `"https://www.googleapis.com/calendar/v3/calendars/hirose30@hoge.jp/events?alt=json"` |
| `x-goog-message-number` | string | Sequential message number (monotonically increasing) | `"1"`, `"2"`, `"3"` |

### Headers (Optional)

| Header | Type | Description |
|--------|------|-------------|
| `x-goog-channel-token` | string | Verification token (if set during channel registration) |
| `x-goog-channel-expiration` | string | RFC 3339 timestamp when channel expires |

### Body

Empty. Google Calendar push notifications do not include event details in the request body.

## Response

### Success (200 OK)

```json
{
  "status": "ok",
  "message": "Notification received"
}
```

### Ignored Notification (200 OK)

Returned when notification is valid but doesn't require processing (e.g., initial "sync" message, unknown channel, already processed).

```json
{
  "status": "ignored",
  "reason": "Initial sync message" | "Unknown channel" | "Already processed"
}
```

### Error (400 Bad Request)

```json
{
  "status": "error",
  "message": "Missing required header: x-goog-channel-id"
}
```

### Error (500 Internal Server Error)

```json
{
  "status": "error",
  "message": "Failed to process notification",
  "details": "Error message for logging"
}
```

## Processing Flow

```
1. Receive POST /webhook
2. Extract x-goog-channel-id header
3. Lookup channel in WatchChannelRegistry
   ├─ If not found → Return 200 OK (ignored: unknown channel)
   └─ If found → Get calendarId
4. Check x-goog-resource-state
   ├─ "sync" → Return 200 OK (ignored: initial sync)
   ├─ "not_exists" → Return 200 OK (ignored: deletion handled by Google Calendar)
   └─ "exists" → Continue processing
5. Fetch recent events from calendar (updated in last 5 minutes)
6. For each event:
   ├─ Check deduplication cache
   ├─ Fetch full event details
   ├─ Resolve user mappings
   ├─ Add secondary attendees (if not already present)
   └─ Cache sync record
7. Return 200 OK
```

## Examples

### Example 1: Event Created

**Request**:
```http
POST /webhook HTTP/1.1
Host: your-service.example.com
x-goog-channel-id: 550e8400-e29b-41d4-a716-446655440000
x-goog-resource-id: o3bg70galdnuadrdhfdk2_20231028
x-goog-resource-state: exists
x-goog-resource-uri: https://www.googleapis.com/calendar/v3/calendars/hirose30@hoge.jp/events?alt=json
x-goog-message-number: 42
Content-Length: 0
```

**Response**:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok",
  "message": "Notification received"
}
```

**Internal Processing** (not visible to Google):
1. Lookup channel `550e8400...` → finds `calendarId = "hirose30@hoge.jp"`
2. Fetch events updated since 5 minutes ago
3. Find event `evt_abc123` with attendees: `["hirose30@hoge.jp", "user2@hoge.jp"]`
4. Resolve mappings:
   - `hirose30@hoge.jp` → `["hirose30@fuga.jp"]`
   - `user2@hoge.jp` → `["user2@fuga.jp"]`
5. Add attendees: `hirose30@fuga.jp`, `user2@fuga.jp` to event
6. Cache sync record: `evt_abc123-exists` → processed at timestamp

### Example 2: Initial Sync Message

**Request**:
```http
POST /webhook HTTP/1.1
Host: your-service.example.com
x-goog-channel-id: 550e8400-e29b-41d4-a716-446655440000
x-goog-resource-id: o3bg70galdnuadrdhfdk2_20231028
x-goog-resource-state: sync
x-goog-resource-uri: https://www.googleapis.com/calendar/v3/calendars/hirose30@hoge.jp/events?alt=json
x-goog-message-number: 1
Content-Length: 0
```

**Response**:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ignored",
  "reason": "Initial sync message"
}
```

### Example 3: Unknown Channel

**Request**:
```http
POST /webhook HTTP/1.1
Host: your-service.example.com
x-goog-channel-id: 999-unknown-channel
x-goog-resource-id: o3bg70galdnuadrdhfdk2_20231028
x-goog-resource-state: exists
x-goog-resource-uri: https://www.googleapis.com/calendar/v3/calendars/unknown@hoge.jp/events?alt=json
x-goog-message-number: 5
Content-Length: 0
```

**Response**:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ignored",
  "reason": "Unknown channel"
}
```

## Security Considerations

### Optional Token Verification

If `x-goog-channel-token` is set during channel registration, verify it matches the token stored in `WatchChannelRegistry`:

```typescript
const channelInfo = registry.get(channelId);
const tokenFromHeader = req.headers['x-goog-channel-token'];

if (channelInfo.token && channelInfo.token !== tokenFromHeader) {
  return res.status(401).json({
    status: 'error',
    message: 'Invalid channel token'
  });
}
```

### Rate Limiting

Google Calendar may send bursts of notifications during rapid event changes. Consider:
- Processing notifications asynchronously (queue-based)
- Deduplication cache prevents redundant work
- Return 200 OK immediately after validation to avoid timeout

### HTTPS Required

Webhook endpoint must be served over HTTPS in production. Google Calendar will not deliver notifications to HTTP endpoints.

## Testing

### Unit Tests

Mock webhook request with headers:
```typescript
import request from 'supertest';
import app from '../src/index';

describe('POST /webhook', () => {
  it('should accept valid notification with exists state', async () => {
    const response = await request(app)
      .post('/webhook')
      .set('x-goog-channel-id', 'test-channel-123')
      .set('x-goog-resource-state', 'exists')
      .set('x-goog-resource-id', 'test-resource')
      .set('x-goog-resource-uri', 'https://...')
      .set('x-goog-message-number', '1');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should ignore sync messages', async () => {
    const response = await request(app)
      .post('/webhook')
      .set('x-goog-channel-id', 'test-channel-123')
      .set('x-goog-resource-state', 'sync')
      .set('x-goog-resource-id', 'test-resource')
      .set('x-goog-resource-uri', 'https://...')
      .set('x-goog-message-number', '1');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ignored');
    expect(response.body.reason).toBe('Initial sync message');
  });

  it('should return 400 for missing channel-id header', async () => {
    const response = await request(app)
      .post('/webhook')
      .set('x-goog-resource-state', 'exists');

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
  });
});
```

### Integration Test with Google Calendar

1. Register a test watch channel for a test calendar
2. Create an event in the test calendar via API
3. Wait for webhook notification (typically <30 seconds)
4. Verify secondary attendees were added to the event
5. Stop the watch channel

## References

- [Google Calendar Push Notifications](https://developers.google.com/calendar/api/guides/push)
- [Watch API Reference](https://developers.google.com/calendar/api/v3/reference/events/watch)
