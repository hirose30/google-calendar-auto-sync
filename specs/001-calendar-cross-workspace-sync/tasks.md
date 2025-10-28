# Tasks: Cross-Workspace Calendar Event Synchronization

**Input**: Design documents from `/specs/001-calendar-cross-workspace-sync/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test tasks are included but optional - implement based on your testing preferences

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project directory structure per plan.md (src/, tests/, config/)
- [x] T002 Initialize Node.js TypeScript project with package.json
- [x] T003 [P] Install googleapis, express, and dev dependencies (typescript, jest, @types/*)
- [x] T004 [P] Create tsconfig.json for TypeScript compilation
- [x] T005 [P] Create .gitignore to exclude config/*.json, dist/, node_modules/
- [x] T006 [P] Create .env.example with required environment variables
- [x] T007 [P] Create README.md with project overview and link to quickstart.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T008 Implement logger utility with structured JSON logging in src/utils/logger.ts
- [x] T009 [P] Implement sleep utility for promise-based delays in src/utils/sleep.ts
- [x] T010 [P] Implement retry utility with fixed 30s backoff (5 attempts) in src/utils/retry.ts
- [x] T011 Create ServiceAccountConfig type in src/config/types.ts
- [x] T012 Implement service account key loader in src/config/loader.ts
- [x] T013 Create Google Calendar API client wrapper with domain-wide delegation in src/calendar/client.ts
- [x] T014 [P] Create UserMapping types in src/config/types.ts
- [x] T015 [P] Create config/service-account-key.example.json template file

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 5 - User Mapping Configuration Management (Priority: P3) 🎯

**Goal**: Load user mappings from Google Spreadsheet, cached in-memory with periodic refresh

**Independent Test**: Create a test Spreadsheet with sample mappings, run loader, verify mappings are loaded into memory correctly

**Why First**: This is actually P3 priority, but it's a blocking dependency for US1/US2/US3/US4 - all stories need the mapping store. We implement it early to unblock parallel work.

### Setup & Data Layer

- [ ] T016 [US5] Implement UserMappingStore class with Map-based storage in src/state/mapping-store.ts
- [ ] T017 [US5] Implement Google Sheets API loader in src/config/loader.ts (loadUserMappingsFromSheet function)
- [ ] T018 [US5] Add mapping cache metadata tracking (lastLoadedAt, loadErrors, mappingCount) in src/state/mapping-store.ts
- [ ] T019 [US5] Implement periodic refresh logic (5 min interval) in src/index.ts startup

### Tests (Optional)

- [ ] T020 [P] [US5] Write unit tests for UserMappingStore (get, has, getAllPrimaries) in tests/unit/mapping-store.test.ts
- [ ] T021 [P] [US5] Write unit tests for Spreadsheet loader with mocked Sheets API in tests/unit/loader.test.ts

### Integration & Validation

- [ ] T022 [US5] Add environment variable SPREADSHEET_ID validation on startup in src/index.ts
- [ ] T023 [US5] Add manual reload endpoint /admin/reload-mappings in src/index.ts
- [ ] T024 [US5] Test with real Spreadsheet: create test sheet, share with service account, verify load

**Deliverable**: User mappings are loaded from Spreadsheet and cached in memory, refreshed every 5 minutes

---

## Phase 4: User Story 1 - Automatic Cross-Workspace Attendee Addition (Priority: P1) 🎯 MVP

**Goal**: When a calendar event is created with primary workspace users, automatically add corresponding secondary workspace users as attendees

**Independent Test**: Create a calendar event in hoge.jp with hirose30@hoge.jp as attendee, verify hirose30@fuga.jp is automatically added within 2 minutes

**MVP Scope**: This is the core value delivery - implement this fully before moving to other stories

### Data Layer & Business Logic

- [ ] T025 [US1] Implement sync logic core: fetch event, resolve mappings, check existing attendees in src/calendar/sync.ts
- [ ] T026 [US1] Implement attendee addition logic with retry in src/calendar/sync.ts (addSecondaryAttendees function)
- [ ] T027 [US1] Add one-to-many mapping support (one primary → multiple secondaries) in src/calendar/sync.ts

### API Integration

- [ ] T028 [US1] Implement Calendar API events.get() wrapper in src/calendar/client.ts
- [ ] T029 [US1] Implement Calendar API events.patch() wrapper for attendee updates in src/calendar/client.ts
- [ ] T030 [US1] Add rate limit handling (429 errors) with retry logic in src/calendar/client.ts

### Tests (Optional)

- [ ] T031 [P] [US1] Write unit tests for sync logic with mocked Calendar API in tests/unit/sync.test.ts
- [ ] T032 [P] [US1] Write integration tests for Calendar API client with mock googleapis in tests/integration/calendar-client.test.ts

### Integration & Validation

- [ ] T033 [US1] Integrate sync logic with Calendar client and mapping store in src/calendar/sync.ts
- [ ] T034 [US1] Add structured logging for all sync operations (success, failure, attendees added) in src/calendar/sync.ts
- [ ] T035 [US1] Manual integration test: Create event via Google Calendar UI, manually call sync function, verify secondary attendees added

**Deliverable**: Core synchronization works - secondary workspace attendees are added when primary users are in an event

---

## Phase 5: User Story 3 - Real-Time Event Detection and Processing (Priority: P2)

**Goal**: Detect calendar event changes in real-time using Google Calendar Push Notifications

**Independent Test**: Create an event in monitored calendar, verify webhook notification received within 1 minute and sync triggered automatically

**Why Before US2/US4**: Push notifications are the trigger mechanism - implementing this makes US2 (updates) testable in real scenarios

### Webhook Infrastructure

- [ ] T036 [US3] Create Express server with /webhook POST endpoint in src/index.ts
- [ ] T037 [US3] Implement webhook header validation (x-goog-channel-id, x-goog-resource-state) in src/webhook/validator.ts
- [ ] T038 [US3] Implement webhook request handler in src/webhook/handler.ts
- [ ] T039 [US3] Add /health endpoint for monitoring in src/index.ts

### Watch Channel Management

- [ ] T040 [US3] Implement WatchChannelRegistry class in src/state/channel-registry.ts
- [ ] T041 [US3] Implement watch channel registration via Calendar API events.watch() in src/calendar/watcher.ts
- [ ] T042 [US3] Implement channel renewal logic (check expiring channels daily, re-register 1 day before expiration) in src/calendar/watcher.ts
- [ ] T043 [US3] Implement channel cleanup on shutdown in src/calendar/watcher.ts

### Event Processing Pipeline

- [ ] T044 [US3] Implement webhook notification processing flow (lookup channel → fetch events → trigger sync) in src/webhook/handler.ts
- [ ] T045 [US3] Implement Calendar API events.list() with updatedMin filter (last 5 minutes) in src/calendar/client.ts
- [ ] T046 [US3] Handle "sync", "exists", "not_exists" resource states appropriately in src/webhook/handler.ts

### Tests (Optional)

- [ ] T047 [P] [US3] Write unit tests for webhook validator in tests/unit/webhook-validator.test.ts
- [ ] T048 [P] [US3] Write integration tests for /webhook endpoint using Supertest in tests/integration/webhook.test.ts
- [ ] T049 [P] [US3] Write unit tests for WatchChannelRegistry in tests/unit/channel-registry.test.ts

### Integration & Startup

- [ ] T050 [US3] Register watch channels for all mapped users on startup in src/index.ts
- [ ] T051 [US3] Add WEBHOOK_URL environment variable validation in src/index.ts
- [ ] T052 [US3] Test with ngrok: expose local webhook, register channels, create event, verify notification received

**Deliverable**: System responds to calendar changes in real-time via push notifications

---

## Phase 6: User Story 2 - Automatic Cross-Workspace Attendee Update (Priority: P1)

**Goal**: When calendar events are updated (attendees added/removed, details changed), synchronize changes to secondary workspace attendees

**Independent Test**: Create an event with synced attendees, add a new primary workspace attendee, verify corresponding secondary attendee is added automatically

**Dependency**: Requires US1 (core sync) and US3 (webhook notifications) to be complete

### Update Detection & Handling

- [ ] T053 [US2] Extend sync logic to handle attendee additions in existing events in src/calendar/sync.ts
- [ ] T054 [US2] Implement attendee removal detection and sync in src/calendar/sync.ts
- [ ] T055 [US2] Handle event detail changes (Google Calendar syncs these automatically via native behavior) - log only in src/calendar/sync.ts
- [ ] T056 [US2] Handle cancelled events (Google Calendar syncs cancellations automatically) - log only in src/calendar/sync.ts

### Tests (Optional)

- [ ] T057 [P] [US2] Write unit tests for attendee addition/removal scenarios in tests/unit/sync.test.ts
- [ ] T058 [P] [US2] Write integration tests for update synchronization in tests/integration/webhook.test.ts

### Integration & Validation

- [ ] T059 [US2] Test attendee addition: Create event, add primary attendee via UI, verify secondary attendee added
- [ ] T060 [US2] Test attendee removal: Remove primary attendee via UI, verify secondary attendee removed
- [ ] T061 [US2] Test event detail changes: Update title/time via UI, verify all attendees see updates (via Google's native sync)

**Deliverable**: Event updates (attendee changes) are synchronized automatically across workspaces

---

## Phase 7: User Story 4 - Duplicate Processing Prevention (Priority: P2)

**Goal**: Prevent duplicate attendee additions when multiple notifications arrive for the same event or when mappings form chains

**Independent Test**: Trigger multiple webhook notifications for the same event, verify attendee is added only once. Test chained mappings (A→B, B→C), verify no infinite loop.

**Dependency**: Requires US1-US3 complete (needs full sync pipeline working first)

### Deduplication Cache

- [ ] T062 [US4] Implement SyncStateCache class with TTL (5 min) in src/state/sync-cache.ts
- [ ] T063 [US4] Implement cache key generation (eventId + resourceState) in src/state/sync-cache.ts
- [ ] T064 [US4] Implement periodic cleanup (remove expired entries every 60s) in src/state/sync-cache.ts
- [ ] T065 [US4] Integrate deduplication check into sync logic (check cache before processing) in src/calendar/sync.ts

### Chain Detection

- [ ] T066 [US4] Implement primary-workspace-only check (skip B in A→B→C chain) in src/calendar/sync.ts
- [ ] T067 [US4] Add logging for skipped events (already processed, no primary attendees) in src/calendar/sync.ts

### Tests (Optional)

- [ ] T068 [P] [US4] Write unit tests for SyncStateCache (set, get, TTL, cleanup) in tests/unit/sync-cache.test.ts
- [ ] T069 [P] [US4] Write integration tests for duplicate notification handling in tests/integration/webhook.test.ts

### Integration & Validation

- [ ] T070 [US4] Test rapid updates: Modify event 5 times in 30 seconds, verify only final state synced
- [ ] T071 [US4] Test chained mappings: Create A→B, B→C mappings, add A to event, verify B added but not C
- [ ] T072 [US4] Monitor logs for duplicate processing indicators during normal operation

**Deliverable**: System prevents duplicate attendee additions and handles edge cases gracefully

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Production readiness, error handling, documentation

### Error Handling & Edge Cases

- [ ] T073 [P] Handle permission errors (403 Forbidden) - log and skip event in src/calendar/sync.ts
- [ ] T074 [P] Handle non-existent secondary users (404 Not Found) - log and continue with other mappings in src/calendar/sync.ts
- [ ] T075 [P] Handle API rate limits (429) with exponential backoff in retry utility (already in T010, verify implementation)
- [ ] T076 [P] Add circuit breaker pattern for persistent API failures (optional enhancement) in src/calendar/client.ts

### Logging & Monitoring

- [ ] T077 [P] Ensure all operations log eventId, calendarId, operation type, duration in src/calendar/sync.ts
- [ ] T078 [P] Add metrics endpoint /metrics for Prometheus (optional) in src/index.ts
- [ ] T079 [P] Document log format and key log entries for troubleshooting in README.md

### Documentation

- [ ] T080 [P] Update README.md with architecture overview, deployment instructions
- [ ] T081 [P] Document environment variables in README.md and .env.example
- [ ] T082 [P] Add troubleshooting section to README.md (common errors, how to resolve)
- [ ] T083 [P] Create runbook for operational tasks (channel renewal, mapping updates, incident response)

### Configuration & Deployment

- [ ] T084 [P] Create Dockerfile for containerized deployment
- [ ] T085 [P] Add npm scripts: dev, build, start, test in package.json
- [ ] T086 [P] Create config/user-mappings.example.json for local testing
- [ ] T087 [P] Document Cloud Run deployment steps in README.md or DEPLOYMENT.md

**Deliverable**: Production-ready service with comprehensive error handling, logging, and documentation

---

## Dependencies & Execution Strategy

### User Story Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundation)
    ↓
Phase 3 (US5 - Mapping Config) ← Blocking for all stories
    ↓
    ├─→ Phase 4 (US1 - Core Sync) ← MVP - implement first
    │       ↓
    │   Phase 5 (US3 - Push Notifications) ← Enables real-time
    │       ↓
    │   Phase 6 (US2 - Updates) ← Requires US1 + US3
    │       ↓
    │   Phase 7 (US4 - Deduplication) ← Requires US1 + US3
    │
    └─→ Phase 8 (Polish) ← Can start after US1 MVP
```

### MVP Recommendation

**Minimal Viable Product**: Phases 1-2-3-4
- Setup + Foundation + Mapping Config + Core Sync = Working MVP
- Manual testing by creating events via Calendar UI and calling sync function
- No real-time (use periodic polling or manual trigger initially)
- Deploy and validate core value before adding push notifications

**Full P1 Features**: Add Phase 5-6
- Real-time notifications + Update synchronization
- Production-ready for end users

**Production Hardening**: Add Phase 7-8
- Deduplication + Polish
- Operational excellence

### Parallel Execution Opportunities

**Within Foundation Phase** (after T008 complete):
- T009, T010, T014, T015 can run in parallel (different files)

**Within US5 Phase** (after T016 complete):
- T020, T021 (tests) can run in parallel

**Within US1 Phase** (after T025 complete):
- T031, T032 (tests) can run in parallel with T028-T030 (API wrappers)

**Within US3 Phase** (after T040 complete):
- T047, T048, T049 (tests) can run in parallel with T044-T046 (implementation)

**Within Polish Phase**:
- T073, T074, T075, T076 (error handling) can all run in parallel
- T077, T078, T079 (monitoring) can all run in parallel
- T080, T081, T082, T083 (documentation) can all run in parallel
- T084, T085, T086, T087 (deployment) can all run in parallel

---

## Task Summary

**Total Tasks**: 87 tasks
- Setup: 7 tasks
- Foundation: 8 tasks
- US5 (Mapping Config): 9 tasks
- US1 (Core Sync - MVP): 11 tasks
- US3 (Push Notifications): 17 tasks
- US2 (Updates): 9 tasks
- US4 (Deduplication): 11 tasks
- Polish: 15 tasks

**MVP Tasks**: T001-T035 (35 tasks) = Phases 1-4
**Full P1**: T001-T061 (61 tasks) = Phases 1-6
**Production Ready**: All 87 tasks = Phases 1-8

**Parallel Opportunities**: 35 tasks marked with [P] can be executed in parallel with other tasks

**Independent Test Criteria**:
- US5: Load mappings from Spreadsheet, verify in-memory store correct
- US1: Create event with primary attendee, verify secondary attendee added
- US3: Create event, verify webhook notification received within 1 minute
- US2: Update event attendees, verify changes synchronized
- US4: Trigger duplicate notifications, verify single processing

**Recommended Implementation Order**:
1. MVP First: Complete Phases 1-4 (Setup → Foundation → Mapping Config → Core Sync)
2. Deploy and validate MVP with manual testing
3. Add Real-Time: Complete Phase 5 (Push Notifications)
4. Add Updates: Complete Phase 6 (Update Sync)
5. Production Harden: Complete Phases 7-8 (Deduplication + Polish)
