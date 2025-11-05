# Tasks: Operational Cost Reduction and Reliability Improvements

**Input**: Design documents from `/specs/003-operational-improvements/`
**Prerequisites**: spec.md (user stories), research.md (technical decisions), data-model.md (Firestore schema), contracts/admin-endpoints.md (API specs)

**Tests**: Tests are NOT explicitly requested in the feature specification, so no test tasks are included. Focus is on implementation and deployment.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. All P1 stories (US1, US2, US3) can be implemented in parallel after foundational work is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Current stack: TypeScript 5.3+, Node.js 20 LTS, Express 4.18, googleapis 128.0
- Deployment: Google Cloud Run (asia-northeast1)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and configure Firestore access

- [x] T001 Install Firestore client library: `npm install @google-cloud/firestore@^7.1.0`
- [x] T002 Update package.json and package-lock.json with new dependency
- [x] T003 [P] Create TypeScript types for Firestore documents in src/state/types.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core Firestore integration infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Create Firestore client singleton in src/state/firestore-client.ts with lazy initialization pattern
- [x] T005 [P] Create ChannelStore class in src/state/channel-store.ts for Firestore CRUD operations
- [x] T006 [P] Create ChannelSync class in src/state/channel-sync.ts to synchronize ChannelRegistry ↔ Firestore
- [x] T007 Update ChannelRegistry in src/state/channel-registry.ts to support sync operations (add update method)
- [x] T008 Add Firestore initialization to service startup in src/index.ts (lazy init, no blocking)
- [x] T009 Add error handling for Firestore operations with fallback logic in src/state/channel-store.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Persistent Watch Channel State Across Service Restarts (Priority: P1) 🎯 MVP

**Goal**: Enable service to restore webhook subscriptions from Firestore on startup, eliminating subscription gaps during restarts

**Independent Test**: Register subscriptions, restart the service (kill and restart process), verify calendar changes still trigger notifications without manual re-registration

### Implementation for User Story 1

- [x] T010 [P] [US1] Implement saveChannel() method in src/state/channel-store.ts to persist channel to Firestore with atomic transaction
- [x] T011 [P] [US1] Implement loadAllChannels() method in src/state/channel-store.ts to retrieve all active channels on startup
- [x] T012 [US1] Modify registerChannel() in src/calendar/watcher.ts to call ChannelStore.saveChannel() after Calendar API registration
- [x] T013 [US1] Add startup channel restoration in src/index.ts to load from Firestore and populate ChannelRegistry
- [x] T014 [US1] Implement expired channel detection in src/state/channel-sync.ts during startup (expiration < now)
- [x] T015 [US1] Add automatic re-registration for expired channels in src/calendar/watcher.ts
- [x] T016 [US1] Implement Firestore fallback logic in src/index.ts: if Firestore unavailable, proceed with full re-registration
- [x] T017 [US1] Add structured logging for all Firestore operations in src/state/channel-store.ts (save, load, errors)

**Checkpoint**: At this point, User Story 1 should be fully functional - service restarts should restore subscriptions from Firestore

---

## Phase 4: User Story 2 - Reduce Operational Costs with On-Demand Service Activation (Priority: P1)

**Goal**: Enable minScale=0 configuration to stop service when idle and auto-start on webhook arrival, reducing costs by 87%

**Independent Test**: Deploy with minScale=0, wait 15 minutes without activity, verify service stopped (check Cloud Run metrics), create calendar event, verify service auto-starts and processes webhook within 5 seconds

### Implementation for User Story 2

- [x] T018 [US2] Optimize Firestore connection initialization in src/state/firestore-client.ts for cold start performance (<50ms init time)
- [x] T019 [US2] Add connection pooling configuration to Firestore client in src/state/firestore-client.ts
- [x] T020 [US2] Implement startup performance logging in src/index.ts to measure cold start timing (Express start, Firestore init, channel load)
- [x] T021 [US2] Update deployment script deploy-cloudrun.sh to support minScale=0 configuration (initially keep minScale=1 for safe rollout)
- [x] T022 [US2] Add environment variable FIRESTORE_ENABLED feature flag in src/config/loader.ts for gradual rollout
- [x] T023 [US2] Test cold start behavior: verify service starts within 5 seconds and processes first webhook successfully
- [x] T024 [US2] Document minScale=0 transition procedure in specs/003-operational-improvements/quickstart.md (already created, verify accuracy)

**Checkpoint**: At this point, service is ready for minScale=0 deployment with persistent state ensuring reliable recovery after idle periods

---

## Phase 5: User Story 3 - Automated Webhook Subscription Renewal (Priority: P1)

**Goal**: Implement scheduled job that automatically renews webhook subscriptions before expiration, eliminating manual maintenance

**Independent Test**: Configure renewal job with test schedule (every 5 minutes), create channels with short expiration, verify channels are automatically renewed before expiration without operator action

### Implementation for User Story 3

- [x] T025 [P] [US3] Create renewal service in src/scheduler/renewal.ts with findExpiringChannels() method
- [x] T026 [P] [US3] Implement renewChannel() method in src/scheduler/renewal.ts to stop old channel and register new one
- [ ] T027 [P] [US3] Add POST /admin/renew-expiring-channels endpoint in src/index.ts calling renewal service
- [ ] T028 [US3] Implement request body parsing for renewal endpoint (dryRun, expirationThreshold parameters)
- [ ] T029 [US3] Add renewal summary response in src/scheduler/renewal.ts (renewed, skipped, failed arrays with details)
- [ ] T030 [US3] Implement idempotency checks in renewal logic: skip channels with expiration > threshold
- [ ] T031 [US3] Add structured logging for renewal operations in src/scheduler/renewal.ts (channel renewed, skipped, failed)
- [ ] T032 [US3] Add error handling for renewal failures (Calendar API rate limits, network errors) with exponential backoff
- [ ] T033 [US3] Update ChannelStore in src/state/channel-store.ts with updateExpiration() method for renewal
- [ ] T034 [US3] Create Cloud Scheduler job configuration script in scripts/setup-scheduler.sh for daily renewal at 3 AM JST

**Checkpoint**: Renewal endpoint is functional and can be invoked manually or by Cloud Scheduler. All user stories 1-3 are now complete and independently functional.

---

## Phase 6: User Story 4 - Operational Health Monitoring (Priority: P2)

**Goal**: Implement health check endpoint and scheduled monitoring to detect issues before they impact service

**Independent Test**: Configure health check job, simulate failure conditions (stop channels, break Firestore connection), verify health endpoint reports degraded status and logs alerts

### Implementation for User Story 4

- [ ] T035 [P] [US4] Create health check service in src/scheduler/health-check.ts with checkSubscriptionStatus() method
- [ ] T036 [P] [US4] Implement health metrics collection in src/scheduler/health-check.ts (subscription count, Firestore connectivity, last renewal time)
- [ ] T037 [US4] Add GET /health endpoint in src/index.ts returning health status (already exists, enhance with subscription details)
- [ ] T038 [US4] Enhance /health endpoint to include subscription count, user mapping status, last successful sync
- [ ] T039 [US4] Add health check degradation detection in src/scheduler/health-check.ts (no subscriptions, Firestore unavailable)
- [ ] T040 [US4] Implement structured logging for health check results in src/scheduler/health-check.ts with severity levels
- [ ] T041 [US4] Create Cloud Scheduler job configuration in scripts/setup-scheduler.sh for health check every 6 hours

**Checkpoint**: Health monitoring is active, providing visibility into service status and early warning of issues

---

## Phase 7: User Story 5 - Manual Subscription Management Operations (Priority: P2)

**Goal**: Provide admin endpoints for manual troubleshooting and subscription management

**Independent Test**: Execute each admin command via curl with gcloud auth token, verify expected behavior (force re-registration works, status displays correctly, individual removal succeeds)

### Implementation for User Story 5

- [ ] T042 [P] [US5] Add POST /admin/force-register-channels endpoint in src/index.ts to stop all channels and re-register
- [ ] T043 [P] [US5] Implement force registration logic in src/scheduler/renewal.ts (reuse channel registration code)
- [ ] T044 [P] [US5] Add GET /admin/channel-status endpoint in src/index.ts to display all subscriptions with expiration times
- [ ] T045 [P] [US5] Implement channel status formatting in src/scheduler/renewal.ts (JSON and table formats)
- [ ] T046 [P] [US5] Add POST /admin/stop-channel endpoint in src/index.ts to manually remove specific channel
- [ ] T047 [US5] Implement stopChannel() method in src/state/channel-store.ts to delete channel from Firestore
- [ ] T048 [US5] Add authentication verification for admin endpoints in src/index.ts (Cloud Run IAM handled automatically, add logging)
- [ ] T049 [US5] Add audit logging for all admin operations in src/index.ts (endpoint invoked, user/service account, result)
- [ ] T050 [US5] Create admin endpoint testing script in scripts/test-admin-endpoints.sh with example curl commands

**Checkpoint**: All admin endpoints are functional, providing operators with tools for troubleshooting and manual management

---

## Phase 8: User Story 6 - Efficient Data Access Patterns (Priority: P3)

**Goal**: Optimize Firestore queries with proper indexing to ensure fast operations at scale

**Independent Test**: Load Firestore with 100+ test subscriptions, execute common queries (load all, find expiring), verify response times < 100ms for reads

### Implementation for User Story 6

- [ ] T051 [P] [US6] Create Firestore index configuration in firestore.indexes.json for expiration field
- [ ] T052 [P] [US6] Add composite index configuration in firestore.indexes.json for status + expiration queries
- [ ] T053 [US6] Add index deployment script in scripts/deploy-firestore-indexes.sh using gcloud commands
- [ ] T054 [US6] Add query performance logging in src/state/channel-store.ts to track Firestore read/write latency
- [ ] T055 [US6] Implement connection pool tuning in src/state/firestore-client.ts for concurrent access handling
- [ ] T056 [US6] Add calendar-specific index (future optimization) in firestore.indexes.json for per-calendar queries
- [ ] T057 [US6] Create performance testing script in scripts/test-performance.sh to load 100 test channels and measure query times

**Checkpoint**: All indexing optimizations are deployed, ensuring fast queries even as subscription count grows

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Deployment automation, documentation, and final validation

- [ ] T058 [P] Create comprehensive deployment guide in DEPLOYMENT.md with Firestore setup steps
- [ ] T059 [P] Update README.md with operational improvements overview (minScale=0, automated renewal)
- [ ] T060 [P] Create rollback procedure documentation in specs/003-operational-improvements/ROLLBACK.md
- [ ] T061 Create GCP setup script in scripts/setup-gcp.sh to enable Firestore API and create database
- [ ] T062 Create IAM permissions script in scripts/setup-iam.sh to grant service account Firestore access
- [ ] T063 Add migration script in scripts/migrate-to-firestore.sh to populate initial Firestore data
- [ ] T064 Run full deployment validation using specs/003-operational-improvements/quickstart.md
- [ ] T065 [P] Code cleanup: Remove any debugging logs, ensure consistent error handling patterns
- [ ] T066 [P] Security review: Verify admin endpoints are IAM-protected, no secrets in logs
- [ ] T067 Validate all success criteria from spec.md (cost < $5/month, startup < 5s, availability > 99.9%)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories 1-3 (P1, Phases 3-5)**: All depend on Foundational phase completion
  - These are P1 stories and can proceed in parallel (if staffed)
  - Or sequentially in order (US1 → US2 → US3)
- **User Stories 4-5 (P2, Phases 6-7)**: Depend on Foundational, can run in parallel with or after P1 stories
- **User Story 6 (P3, Phase 8)**: Optimization, can run anytime after Foundational
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Persistent state - FOUNDATIONAL, needed by US2 and US3
- **User Story 2 (P1)**: minScale=0 - Depends on US1 (requires persistent state)
- **User Story 3 (P1)**: Automated renewal - Depends on US1 (requires ChannelStore), can run parallel to US2
- **User Story 4 (P2)**: Health monitoring - Independent, can start after Foundational
- **User Story 5 (P2)**: Admin endpoints - Independent, can start after Foundational
- **User Story 6 (P3)**: Query optimization - Independent, can run anytime

### Critical Path for MVP

1. Phase 1: Setup (T001-T003)
2. Phase 2: Foundational (T004-T009) ← BLOCKS EVERYTHING
3. Phase 3: User Story 1 (T010-T017) ← REQUIRED for US2, US3
4. Phase 4: User Story 2 (T018-T024) ← Cost reduction goal
5. Phase 5: User Story 3 (T025-T034) ← Automated operations goal

**MVP Complete**: After US1 + US2 + US3, all P1 requirements are met (persistent state, cost reduction, automated renewal)

### Parallel Opportunities

**Within Foundational (Phase 2)**:
- T005 (ChannelStore) and T006 (ChannelSync) can run in parallel (different files)

**Within User Story 1 (Phase 3)**:
- T010 (saveChannel) and T011 (loadAllChannels) can run in parallel (same file, different methods)

**Within User Story 3 (Phase 5)**:
- T025 (renewal service) and T027 (endpoint) can run in parallel initially

**Within User Story 5 (Phase 7)**:
- T042, T044, T046 (all admin endpoints) can run in parallel (different endpoints in src/index.ts)

**Across User Stories (if team capacity allows)**:
- After Foundational completes, US4 and US5 can run in parallel with US1-3
- US6 can run in parallel with any other story (optimization)

---

## Parallel Example: Foundational Phase

```bash
# Launch ChannelStore and ChannelSync in parallel:
Task: "Create ChannelStore class in src/state/channel-store.ts"
Task: "Create ChannelSync class in src/state/channel-sync.ts"
```

## Parallel Example: User Story 5 (Admin Endpoints)

```bash
# Launch all admin endpoint implementations in parallel:
Task: "Add POST /admin/force-register-channels endpoint in src/index.ts"
Task: "Add GET /admin/channel-status endpoint in src/index.ts"
Task: "Add POST /admin/stop-channel endpoint in src/index.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1-3 Only)

1. Complete Phase 1: Setup (install Firestore library)
2. Complete Phase 2: Foundational (CRITICAL - ChannelStore, ChannelSync infrastructure)
3. Complete Phase 3: User Story 1 (persistent state)
4. Complete Phase 4: User Story 2 (minScale=0 for cost reduction)
5. Complete Phase 5: User Story 3 (automated renewal)
6. **STOP and VALIDATE**: Test all P1 stories independently
7. Deploy with minScale=1 initially, verify Firestore integration
8. Transition to minScale=0, verify cost reduction
9. Enable Cloud Scheduler jobs, verify automated renewal

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently (restart service, verify restoration) → Deploy to staging
3. Add User Story 2 → Test independently (minScale=0 cold start) → Deploy to staging
4. Add User Story 3 → Test independently (manual renewal trigger) → Deploy to staging
5. **MVP COMPLETE**: Deploy all P1 stories to production
6. Add User Story 4 → Health monitoring → Deploy incrementally
7. Add User Story 5 → Admin tools → Deploy incrementally
8. Add User Story 6 → Optimizations → Deploy incrementally

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together (blocking phase)
2. Once Foundational is done:
   - Developer A: User Story 1 (persistent state) ← Must complete first
   - Developer B: User Story 4 (health monitoring) ← Can run in parallel
   - Developer C: User Story 5 (admin endpoints) ← Can run in parallel
3. After US1 completes:
   - Developer A: User Story 2 (minScale=0)
   - Developer B: User Story 3 (automated renewal)
   - Developer C: User Story 6 (optimizations)
4. Stories complete and integrate independently

---

## Deployment Sequence (Production)

**Week 1: Foundation + Persistent State**
- Deploy T001-T017 (Setup + Foundational + US1)
- Keep minScale=1 (no cost change yet)
- Verify Firestore writes occurring for 7 days
- Monitor service restarts restore subscriptions correctly

**Week 2: Cost Reduction**
- Deploy T018-T024 (US2: minScale=0 support)
- Test in staging with minScale=0
- Production: Change minScale to 0
- Monitor cold starts, verify < 5 seconds
- If issues: Rollback to minScale=1

**Week 3: Automated Renewal**
- Deploy T025-T034 (US3: renewal endpoint + scheduler)
- Create Cloud Scheduler jobs (disabled initially)
- Manually test renewal endpoint
- Enable scheduled jobs
- Monitor daily renewals for 1 week

**Week 4+: Monitoring & Admin Tools**
- Deploy T035-T050 (US4, US5: health monitoring + admin endpoints)
- Incrementally enable health checks
- Train operators on admin tools
- Deploy T051-T057 (US6: optimizations) if needed

---

## Notes

- [P] tasks = different files or independent methods, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group (e.g., all methods in one service)
- Stop at any checkpoint to validate story independently
- Follow gradual rollout strategy: Firestore @ minScale=1 → validate → change to minScale=0 → validate → enable scheduler
- Avoid: cross-story dependencies that break independence (US2 depends on US1, document this clearly)
- All file paths use existing project structure (src/state/, src/calendar/, src/scheduler/)

---

## Success Metrics (per spec.md)

After all P1 stories (US1-3) are complete:

- **SC-001**: Monthly cost reduced to $5 or less (verify in GCP billing after 30 days)
- **SC-002**: Service startup < 5 seconds for 95% of restarts (measure via Cloud Run cold start metrics)
- **SC-003**: Webhook subscription availability > 99.9% over 30 days (monitor via structured logs)
- **SC-004**: 100% of expiring subscriptions renewed within 24 hours (verify renewal job logs)
- **SC-005**: Firestore reads < 200ms for 99% of queries (measure via performance logging)
- **SC-006**: Cold start processes webhooks within 5 seconds (monitor first webhook after idle)
- **SC-007**: Zero subscription data loss during restarts (verify channel count before/after restart)
- **SC-008**: Scheduled jobs succeed 99% of time over 30 days (monitor Cloud Scheduler execution history)
