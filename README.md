# Google Calendar Cross-Workspace Synchronization

Automated system to synchronize calendar event attendees across Google Workspace domains.

## Overview

When calendar events are created or updated in a primary Google Workspace (e.g., hoge.jp) with mapped users as attendees, this system automatically adds corresponding secondary workspace identities (e.g., fuga.jp) as attendees to the same event.

## Features

- **Automatic Attendee Sync**: Add secondary workspace users when primary users are invited to events
- **Real-Time Detection**: Uses Google Calendar Push Notifications for near real-time synchronization
- **Update Propagation**: Synchronizes attendee additions, removals, and event detail changes
- **Deduplication**: Prevents duplicate processing and handles rapid event updates gracefully
- **Spreadsheet Configuration**: User mappings managed via Google Spreadsheet (no code deployment needed)

## Quick Start

**Japanese users**: See [Japanese Quick Start Guide (QUICKSTART_JA.md)](QUICKSTART_JA.md) for 5-minute setup!

For detailed setup instructions, see [TESTING.md](TESTING.md) or [quickstart.md](specs/001-calendar-cross-workspace-sync/quickstart.md)

### Prerequisites

- Node.js 20 LTS or later
- Google Workspace admin access
- Google Cloud project with Calendar API and Sheets API enabled
- Service account with domain-wide delegation

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# - Set SPREADSHEET_ID
# - Set WEBHOOK_URL (for production)
# - Configure CONFIG_DIR if needed

# Build TypeScript
npm run build

# Start the service
npm start
```

### Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm test:coverage

# Lint code
npm run lint

# Format code
npm run format
```

## Architecture

- **TypeScript + Node.js 20 LTS**: Type-safe implementation with modern JavaScript runtime
- **Express**: Webhook endpoint for Google Calendar Push Notifications
- **googleapis**: Google Calendar API and Google Sheets API client
- **In-Memory State**: User mappings cached from Spreadsheet, sync state managed in memory
- **Serverless-Ready**: Designed to run as a single process on Cloud Run or similar platforms

## Project Structure

```
src/
├── index.ts              # Entry point: Express server + startup logic
├── calendar/
│   ├── client.ts         # Google Calendar API client wrapper
│   ├── watcher.ts        # Push notification channel management
│   └── sync.ts           # Core sync logic
├── config/
│   ├── loader.ts         # Configuration loading (Spreadsheet + service account)
│   └── types.ts          # Configuration type definitions
├── webhook/
│   ├── handler.ts        # Webhook request handler
│   └── validator.ts      # Webhook header validation
├── state/
│   ├── mapping-store.ts  # In-memory user mapping store
│   ├── sync-cache.ts     # Deduplication cache
│   └── channel-registry.ts # Watch channel tracking
└── utils/
    ├── logger.ts         # Structured JSON logging
    ├── retry.ts          # Retry logic with backoff
    └── sleep.ts          # Promise-based delay utility

tests/
├── unit/                 # Unit tests
└── integration/          # Integration tests

config/
├── service-account-key.json       # Google service account credentials (gitignored)
├── service-account-key.example.json # Template
└── user-mappings.example.json      # Example mapping format (deprecated - use Spreadsheet)
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `WEBHOOK_URL` | Yes (prod) | `http://localhost:3000/webhook` | Public HTTPS URL for webhooks |
| `SPREADSHEET_ID` | **Yes** | - | Google Spreadsheet ID with user mappings |
| `CONFIG_DIR` | No | `./config` | Directory containing service account key |
| `LOG_LEVEL` | No | `info` | Logging level (debug/info/warn/error) |
| `DEDUP_CACHE_TTL_MS` | No | `300000` (5 min) | Deduplication cache TTL |
| `MAPPING_REFRESH_INTERVAL_MS` | No | `300000` (5 min) | Mapping refresh interval |
| `CHANNEL_RENEWAL_THRESHOLD_MS` | No | `86400000` (1 day) | Channel renewal threshold |

### User Mappings Spreadsheet

Create a Google Spreadsheet with the following structure:

**Sheet Name**: `User Mappings`

| Primary Email | Secondary Emails | Status |
|---------------|------------------|--------|
| user1@hoge.jp | user1@fuga.jp | active |
| user2@hoge.jp | user2@fuga.jp, user2@baz.jp | active |

- **Primary Email**: User in the primary workspace
- **Secondary Emails**: Comma-separated list of corresponding secondary workspace identities
- **Status**: `active` or `inactive` (empty = active)

Share the Spreadsheet with your service account email (Viewer permission).

## Success Criteria

This system is designed to meet the following success criteria:

| ID | Criteria | Target | Measurement Method |
|----|----------|--------|-------------------|
| **SC-001** | Event creation sync latency | Within 2 minutes for 95% of cases | Measure p95 via Cloud Logging queries |
| **SC-002** | Event update sync latency | Within 2 minutes for 95% of cases | Measure p95 via Cloud Logging queries |
| **SC-003** | Event detection rate | 99.9% or higher | Monitor Watch Channel registration status |
| **SC-004** | Duplicate processing prevention | 0 duplicates | Check DeduplicationCache logs |
| **SC-005** | Concurrent processing performance | Handle 100 simultaneous event changes | Load testing (optional) |
| **SC-006** | Administrative effort reduction | 90% reduction vs. manual management | Subjective evaluation |
| **SC-007** | User satisfaction | 85% or higher | User survey (after production deployment) |
| **SC-008** | Troubleshooting time | Root cause identification within 10 minutes | Ensured by comprehensive logging |

For details, see the Monitoring section in [DEPLOYMENT.md](DEPLOYMENT.md).

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-28T17:15:54.990Z",
  "cache": {
    "mappingCount": 1,
    "lastLoadedAt": "2025-10-28T17:13:21.179Z",
    "loadErrors": 0
  }
}
```

### Manual Mapping Reload

```bash
curl -X POST http://localhost:3000/admin/reload-mappings
```

### Logs

Structured JSON logs output to stdout/stderr for container platform integration.

Key log fields:
- `timestamp`: ISO 8601
- `level`: ERROR, WARN, INFO, DEBUG
- `message`: Human-readable message
- `context`: Contextual data (eventId, calendarId, operation, duration, error)

**Important log messages:**
- `Service account key loaded from environment variable` - Startup successful
- `User mappings loaded from Spreadsheet` - Mapping loaded successfully
- `Watch channel registered successfully` - Webhook registration successful
- `Event synced successfully` - Synchronization successful

## Deployment

### Google Cloud Run (Recommended)

**Easy Deployment:**

```bash
# 1. Copy example deployment script and configure PROJECT_ID
cp deploy-cloudrun.sh.example deploy-cloudrun.sh
nano deploy-cloudrun.sh

# 2. Run deployment
./deploy-cloudrun.sh
```

**Benefits:**
- ✅ Fixed HTTPS URL (no need to change Webhook URL)
- ✅ Free tier available (up to 1M requests/month)
- ✅ Automatic SSL certificates
- ✅ Integrated logging
- ✅ Concurrency control (`--max-instances 1` prevents duplicate processing)

See [DEPLOYMENT.md](DEPLOYMENT.md) for details.

**Scaling Configuration:**
- `--max-instances 1` (recommended, zero cost)
- Single instance can handle ~1000 events/day
- **No external cache needed** (in-memory DeduplicationCache is sufficient)

### Docker

```bash
# Build image
docker build -t calendar-sync .

# Run container
docker run -p 3000:3000 \
  -v $(pwd)/config:/app/config \
  -e SPREADSHEET_ID=your_spreadsheet_id \
  -e WEBHOOK_URL=https://your-webhook-url.com/webhook \
  calendar-sync
```

## Troubleshooting

### Common Issues

1. **"Insufficient permissions" error**
   - Verify domain-wide delegation is configured in Google Workspace Admin
   - Check service account Client ID and scopes are correct
   - Wait 10-15 minutes for propagation

2. **Webhook notifications not received**
   - Ensure WEBHOOK_URL is publicly accessible via HTTPS
   - For local testing, use ngrok to expose localhost
   - Verify watch channels are registered (check logs on startup)

3. **Mappings not loading**
   - Verify SPREADSHEET_ID is correct
   - Check Spreadsheet is shared with service account email
   - Ensure Sheets API is enabled in Google Cloud Console

4. **Secondary attendees not added**
   - Check logs for specific error messages
   - Verify secondary user email addresses are correct
   - Ensure service account has Calendar API access

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/sync.test.ts

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Code Quality

```bash
# Lint TypeScript
npm run lint

# Format code with Prettier
npm run format
```

## Terminology

Key terms used throughout this project:

| Term | Description | Example |
|------|-------------|---------|
| **Primary Workspace** | Main Google Workspace domain | hoge.jp |
| **Secondary Workspace** | Target Google Workspace domain(s) for synchronization | fuga.jp, baz.jp |
| **User Mapping** | Relationship between primary and secondary user identities | user@hoge.jp → user@fuga.jp |
| **Watch Channel** | Google Calendar Push Notification channel | Valid for 7 days, auto-renewed |
| **Sync Event** | Event that triggers calendar synchronization | create, update, delete |
| **Deduplication Cache** | Temporary cache to prevent duplicate processing | 5-minute TTL |
| **FR** | Functional Requirement | FR-001, FR-002... |
| **US** | User Story | US1, US2... |
| **SC** | Success Criteria | SC-001, SC-002... |
| **P1/P2/P3** | Priority levels | P1=Highest, P3=Lowest |
| **MVP** | Minimum Viable Product | Phase 1-4 (core sync functionality) |
| **TTL** | Time To Live | Cache retention period |

### Abbreviations

- **API**: Application Programming Interface
- **JWT**: JSON Web Token
- **OAuth**: Open Authorization
- **GCR**: Google Container Registry
- **SA**: Service Account
- **TTL**: Time To Live
- **SLA**: Service Level Agreement
- **p95**: 95th percentile

## License

MIT

## Support

For issues and questions, see:
- [Feature Specification](specs/001-calendar-cross-workspace-sync/spec.md)
- [Implementation Plan](specs/001-calendar-cross-workspace-sync/plan.md)
- [Quickstart Guide](specs/001-calendar-cross-workspace-sync/quickstart.md)
- [Deployment Guide](DEPLOYMENT.md)
