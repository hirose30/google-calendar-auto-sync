# Implementation Plan: Cross-Workspace Calendar Event Synchronization

**Branch**: `001-calendar-cross-workspace-sync` | **Date**: 2025-10-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-calendar-cross-workspace-sync/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Minimal automated system to synchronize calendar event attendees across Google Workspace domains. When calendar events are created or updated in the primary workspace (hoge.jp) with mapped users as attendees, the system automatically adds corresponding secondary workspace identities (e.g., fuga.jp) as attendees. Uses Google Calendar Push Notifications for real-time detection and runs as a simple Node.js service with in-memory state.

## Technical Context

**Language/Version**: TypeScript 5.3+ with Node.js 20 LTS

**Primary Dependencies**:
- `googleapis` - Google Calendar API client + Google Sheets API client
- `express` - HTTP server for webhook endpoint
- No external database dependencies (in-memory state management with Google Sheets as config source)

**Storage**:
- **User Mappings**: Google Spreadsheet (cached in-memory, refreshed every 5 minutes)
  - Provides admin-friendly UI for non-technical users
  - Built-in version history and collaborative editing
  - Same authentication as Calendar API (service account)
- **Synchronization State**: In-memory cache using Map/Set for deduplication within process lifetime
- **No persistent database** - state resets on restart (acceptable for MVP as Calendar API is source of truth)

**Testing**:
- Jest for unit tests
- Supertest for webhook endpoint integration tests
- Mock `googleapis` for Calendar API contract testing

**Target Platform**:
- Minimal deployment: Single Node.js process (can run on Cloud Run, Cloud Functions, or any container platform)
- Local development: `npm run dev` with nodemon

**Project Type**: Single service (webhook handler + calendar sync logic)

**Performance Goals**: <2 minute end-to-end sync latency for 95% of events, support 100 concurrent event changes

**Constraints**:
- Within Google Calendar API rate limits (1500 queries/minute/user)
- Max 5 retry attempts per event (30s intervals)
- Manual log monitoring via stdout/stderr (no cloud logging SDK)
- Stateless design: duplicate processing prevented within single process lifetime only

**Scale/Scope**: Monitor calendars for ~50-100 mapped users initially, handle events with up to 500 attendees

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Note**: Constitution template is not yet filled in for this project. Proceeding with general software engineering best practices:

- ✅ **Testability**: Design will include unit tests for mapping logic, integration tests for Google Calendar API interactions
- ✅ **Observability**: Structured logging for all sync operations, failures, and retry attempts
- ✅ **Error Handling**: Graceful failure handling with retry logic (5 attempts, 30s intervals)
- ✅ **Security**: OAuth 2.0 service account for API access, domain-wide delegation for calendar monitoring
- ✅ **Maintainability**: Clear separation of concerns (event detection, mapping resolution, attendee addition)

**RECOMMENDATION**: Consider creating a project constitution after this feature to establish consistent patterns for future development.

## Project Structure

### Documentation (this feature)

```text
specs/001-calendar-cross-workspace-sync/
├── spec.md                       # Feature specification
├── plan.md                       # This file (implementation plan)
├── research.md                   # Technology decisions and architecture
├── data-model.md                 # In-memory data structures
├── quickstart.md                 # Setup and deployment guide
├── contracts/
│   ├── webhook-api.md            # Webhook endpoint contract
│   └── google-calendar-api.md    # Google Calendar API interactions
└── tasks.md                      # Phase 2 output (/speckit.tasks - not yet created)
```

### Source Code (repository root)

```text
google-calendar-auto-sync/
├── src/
│   ├── index.ts                  # Entry point: Express server + startup logic
│   ├── calendar/
│   │   ├── client.ts             # Google Calendar API client wrapper
│   │   ├── watcher.ts            # Push notification channel management
│   │   └── sync.ts               # Core sync logic: fetch events, resolve mappings, add attendees
│   ├── config/
│   │   ├── loader.ts             # Load user-mappings.json + service account key
│   │   └── types.ts              # UserMappingConfig, ServiceAccountConfig types
│   ├── webhook/
│   │   ├── handler.ts            # Express route handler for POST /webhook
│   │   └── validator.ts          # Validate webhook headers and channel ID
│   ├── state/
│   │   ├── mapping-store.ts      # In-memory user mapping lookup (Map)
│   │   ├── sync-cache.ts         # Deduplication cache with TTL
│   │   └── channel-registry.ts   # Watch channel tracking
│   └── utils/
│       ├── logger.ts             # Structured JSON logging
│       ├── retry.ts              # Retry with fixed backoff (5 attempts, 30s)
│       └── sleep.ts              # Promise-based delay utility
├── tests/
│   ├── unit/
│   │   ├── sync.test.ts          # Test sync logic with mocked Calendar API
│   │   ├── mapping-store.test.ts # Test mapping resolution
│   │   ├── sync-cache.test.ts    # Test deduplication cache
│   │   └── retry.test.ts         # Test retry logic
│   └── integration/
│       ├── webhook.test.ts       # Supertest for webhook endpoint
│       └── calendar-client.test.ts # Contract tests with mocked googleapis
├── config/
│   ├── user-mappings.json        # User mapping configuration (gitignored)
│   ├── user-mappings.example.json # Template for user-mappings.json
│   └── service-account-key.json  # Service account credentials (gitignored)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
├── .gitignore                    # Ignore config/*.json, dist/, node_modules/
└── README.md                     # Project overview and link to quickstart.md
```

**Structure Decision**: Single service architecture (Option 1 variant) chosen for minimal setup requirements. All code in `src/` with logical grouping by responsibility:
- `calendar/`: Google Calendar API interactions
- `config/`: Configuration loading and types
- `webhook/`: HTTP endpoint handling
- `state/`: In-memory data structures
- `utils/`: Shared utilities

No separate frontend or backend - this is a pure backend service with webhook endpoint.

## Complexity Tracking

**No complexity violations** - Constitution template is not yet defined for this project. The chosen architecture follows standard practices:
- Single service (no microservices complexity)
- No external database (in-memory state only)
- Standard Express + googleapis libraries
- Straightforward testing structure (unit + integration)
