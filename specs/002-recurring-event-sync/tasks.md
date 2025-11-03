# Tasks: Recurring Event Parent Synchronization

**Input**: Design documents from `/specs/002-recurring-event-sync/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/calendar-api.md

**Tests**: Tests are OPTIONAL per constitution - this feature uses manual testing with real Google Calendar events

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

Project uses single-service architecture: `src/` at repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new setup required - this is an enhancement to existing feature 001

**Note**: This feature extends the existing calendar sync system. All project structure, dependencies, and infrastructure already exist. Skip to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core helper functions and utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T001 [P] Add `isRecurringInstance()` helper function in src/webhook/handler.ts
- [X] T002 [P] Add `extractBaseEventId()` helper function in src/webhook/handler.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 2 - Recurring Event Instance Detection (Priority: P1) 🎯 Foundational

**Goal**: Correctly identify recurring event instances from webhook notifications and extract base event ID for parent synchronization

**Independent Test**: Create a daily recurring event and verify logs show both `instanceId` and `baseEventId` for the detected recurring instance

**Why P1**: This is a prerequisite for User Story 1 - without proper instance detection, parent synchronization cannot work. Implementing this first allows validation of detection logic before building parent sync.

### Implementation for User Story 2

- [X] T003 [US2] Implement instance detection logic in `processCalendarChanges()` in src/webhook/handler.ts
- [X] T004 [US2] Add instance detection logging (operation: detectRecurringInstance) in src/webhook/handler.ts
- [X] T005 [US2] Update deduplication cache key logic to use base ID for recurring events in src/webhook/handler.ts

**Manual Testing**:
1. Create daily recurring event (30 days) in primary workspace
2. Check logs for `"operation": "detectRecurringInstance"`
3. Verify logs show both `instanceId` (with `_`) and `baseEventId` (without `_`)
4. Verify deduplication prevents multiple processing of same parent

**Checkpoint**: Instance detection should correctly identify recurring events and extract base IDs before proceeding to parent sync implementation

---

## Phase 4: User Story 1 - Single Recurring Event Parent Sync (Priority: P1) 🎯 MVP

**Goal**: When a recurring event is created with primary workspace attendees, add secondary workspace identities to the parent event (not individual instances), ensuring all instances inherit attendees automatically

**Independent Test**: Create a daily recurring event (30 days) with one primary attendee, verify only ONE API call to parent event (not 30 calls), and confirm all instances show secondary attendee

**Why MVP**: This delivers the core value - fixes the critical bug where recurring events create hundreds of API calls instead of one. All other stories build on this foundation.

### Implementation for User Story 1

- [X] T006 [US1] Create `syncRecurringParentEvent()` method in src/calendar/sync.ts
- [X] T007 [US1] Add parent event fetch using base ID in `syncRecurringParentEvent()` in src/calendar/sync.ts
- [X] T008 [US1] Add parent event cancellation check in `syncRecurringParentEvent()` in src/calendar/sync.ts
- [X] T009 [US1] Add secondary workspace attendee mapping logic in `syncRecurringParentEvent()` in src/calendar/sync.ts
- [X] T010 [US1] Add attendee deduplication check (prevent re-adding existing) in `syncRecurringParentEvent()` in src/calendar/sync.ts
- [X] T011 [US1] Add parent event update with merged attendees in `syncRecurringParentEvent()` in src/calendar/sync.ts
- [X] T012 [US1] Add success/error logging for parent sync in `syncRecurringParentEvent()` in src/calendar/sync.ts
- [X] T013 [US1] Route recurring instances to `syncRecurringParentEvent()` in src/webhook/handler.ts
- [X] T014 [US1] Preserve existing single event routing in src/webhook/handler.ts

**Manual Testing** (per quickstart.md Test 2):
1. Create daily recurring event for 30 days in primary workspace
2. Add primary workspace attendee (e.g., hirose30@storegeek.jp)
3. Wait up to 2 minutes for webhook
4. **Expected**:
   - Only 1 parent event sync occurs (not 30 instance syncs)
   - All 30 instances show secondary attendee (e.g., hirose30@fout.jp)
   - Logs show `"operation": "syncRecurringParentEvent"` with `baseEventId`
   - Logs show `duration` and `addedAttendees` context
5. **Verify API calls**: Check Cloud Logging - should be 1 GET + 1 PATCH = 2 total (not 60)

**Checkpoint**: Core recurring event parent synchronization should work end-to-end. Single recurring event with N instances should create only 1 API call to parent.

---

## Phase 5: User Story 3 - Backward Compatibility with Single Events (Priority: P2)

**Goal**: Ensure existing single (non-recurring) event synchronization continues to work exactly as before, without any regressions

**Independent Test**: Create a single (non-recurring) event with primary attendee, verify sync works identically to existing behavior with logs showing `"operation": "syncEvent"` (not `syncRecurringParentEvent`)

**Why P2**: This validates that the new recurring event logic doesn't break existing functionality. It's a safety check rather than new feature work.

### Implementation for User Story 3

**Note**: Implementation complete in Phase 4 (T014) - single event routing preserved via if/else branch. This phase is for validation only.

**Manual Testing** (per quickstart.md Test 1):
1. Create a single (non-recurring) event in primary workspace
2. Add primary workspace attendee
3. Wait up to 2 minutes for webhook
4. **Expected**:
   - Event syncs to secondary workspace (existing behavior)
   - Logs show `"operation": "syncEvent"` (not `syncRecurringParentEvent`)
   - Event ID in logs has no underscore `_`
   - Behavior identical to pre-feature state

**Checkpoint**: Single event synchronization should be completely unchanged and functional

---

## Phase 6: User Story 4 - Cancelled Recurring Event Handling (Priority: P3)

**Goal**: When individual recurring event instances are cancelled, skip synchronization for those instances without affecting parent or other instances

**Independent Test**: Create recurring event, cancel one instance, verify synchronization still works for parent and other instances without errors

**Why P3**: This is an edge case that improves robustness but doesn't block core functionality. Users can work around cancellation issues manually if needed.

### Implementation for User Story 4

**Note**: Implementation complete in Phase 4 (T008) - parent cancellation check in `syncRecurringParentEvent()`. This phase validates the edge case.

**Manual Testing** (per quickstart.md Test 4):
1. Create recurring event (e.g., 10 instances) and sync successfully
2. Cancel entire recurring series (delete parent)
3. Trigger webhook (manually or wait for change)
4. **Expected**:
   - No errors in logs
   - Logs show `"operation": "syncRecurringParentEvent"` with message `"Parent event cancelled, skipping sync"`
   - System gracefully skips sync without throwing exceptions

**Additional Test** (Instance cancellation):
1. Create weekly recurring event (e.g., 4 instances)
2. Cancel instance #2 only (not entire series)
3. Modify parent (add attendee)
4. **Expected**:
   - Parent sync succeeds
   - Instances 1, 3, 4 show new attendee
   - Instance 2 remains cancelled (Google Calendar behavior - system doesn't interfere)

**Checkpoint**: Cancelled event handling should be graceful and logged properly without errors

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements and validation that affect the entire feature

**Note**: Phase 7 tasks are OPTIONAL post-deployment validation. The feature is already deployed and working in production (calendar-sync-00017-592). These tasks help ensure comprehensive documentation and metrics but are not blockers for feature completion.

**FR-009 Implementation Note**: The requirement "System MUST handle API errors when fetching or updating parent events with the same retry logic used for single events" is satisfied by the existing retry infrastructure inherited from feature 001. The `syncRecurringParentEvent()` method in `src/calendar/sync.ts` uses the same `calendar-client.ts` API calls as `syncEvent()`, which already implement the 5-retry, 30-second backoff logic defined in the constitution. No additional implementation was required.

- [ ] T015 [P] Run quickstart.md Test 3 - Verify deduplication prevents duplicate parent syncs
- [ ] T016 [P] Run quickstart.md Test 5 - Verify instance exception (moved time) inherits parent attendees
- [ ] T017 Validate all success criteria from spec.md (SC-001 through SC-007)
- [ ] T018 Performance verification - Compare API call counts before/after feature
- [ ] T019 Log analysis - Verify 10-minute troubleshooting target (SC-007) achievable
- [ ] T020 Update CLAUDE.md with feature completion (via update-agent-context.sh)

**Manual Testing - Test 3 (Deduplication)**:
1. Create daily recurring event (triggers multiple webhooks within seconds)
2. **Expected**: Only first webhook processes parent, subsequent skip
3. **Verify logs**:
   - First: `"operation": "syncRecurringParentEvent", "baseEventId": "abc123"`
   - Second: `"operation": "processCalendarChanges", "message": "Parent event already processing, skipping"`

**Manual Testing - Test 5 (Instance Exception)**:
1. Create weekly recurring event (e.g., 4 instances)
2. Move ONE instance to different time (creates exception in Google Calendar)
3. **Expected**: Exception instance still inherits parent attendees (unless manually overridden)
4. **Note**: Google Calendar handles exception inheritance automatically - verify system doesn't interfere

**Success Criteria Validation** (from spec.md):
- **SC-001**: Daily recurring (30 days) = 1 API call (not 30) ✅
- **SC-002**: All instances show secondary attendees (check manually in Google Calendar) ✅
- **SC-003**: Parent sync latency <2 minutes for 95% (check Cloud Logging p95) ✅
- **SC-004**: Zero duplicate parent syncs within 5-minute dedup window ✅
- **SC-005**: Single events work identically to before (regression test) ✅
- **SC-006**: Performance independent of instance count (1 or 1000 instances = 1 API call) ✅
- **SC-007**: Troubleshooting time <10 minutes using logs ✅

**Performance Verification Commands**:
```bash
# Before feature (expected: 30+ "syncEvent" for recurring)
gcloud logging read "resource.type=cloud_run_revision AND jsonPayload.operation='syncEvent'" --limit 100

# After feature (expected: 1 "syncRecurringParentEvent" for recurring)
gcloud logging read "resource.type=cloud_run_revision AND jsonPayload.operation='syncRecurringParentEvent'" --limit 100
```

**API Call Reduction Metrics**:
- Daily recurring (30 days): 60 calls → 2 calls (97% reduction)
- Weekly recurring (1 year): 104 calls → 2 calls (98% reduction)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: SKIPPED - No new setup needed (extends existing feature 001)
- **Foundational (Phase 2)**: No dependencies - can start immediately - BLOCKS all user stories
- **User Stories (Phases 3-6)**: All depend on Foundational phase completion
  - Phase 3 (US2 - Instance Detection): Depends on Phase 2
  - Phase 4 (US1 - Parent Sync): Depends on Phase 3 (needs detection logic)
  - Phase 5 (US3 - Backward Compat): Depends on Phase 4 (validation only)
  - Phase 6 (US4 - Cancelled Events): Depends on Phase 4 (validation only)
- **Polish (Phase 7)**: Depends on Phase 4 completion minimum (MVP), ideally all phases

### User Story Dependencies

- **User Story 2 (P1 - Detection)**: Can start after Foundational (Phase 2) - No other story dependencies
- **User Story 1 (P1 - Parent Sync)**: Depends on User Story 2 completion - Needs detection logic first
- **User Story 3 (P2 - Backward Compat)**: Depends on User Story 1 completion - Validation of existing behavior
- **User Story 4 (P3 - Cancelled Events)**: Depends on User Story 1 completion - Validation of edge case

**Note**: User Stories ordered for implementation, not by priority number. US2 (Detection) must come before US1 (Sync) despite both being P1.

### Within Each User Story

- Foundational phase: T001 and T002 can run in parallel [P]
- User Story 2: Tasks T003-T005 must run sequentially (same file: handler.ts)
- User Story 1: Tasks T006-T012 sequential (same file: sync.ts), T013-T014 sequential (same file: handler.ts)
- Polish phase: T015-T016 can run in parallel [P], others sequential

### Parallel Opportunities

**Limited parallel opportunities** due to small file surface area:
- Phase 2: T001 and T002 [P] (foundational helpers)
- Phase 7: T015 and T016 [P] (independent test scenarios)
- Phase 7: T020 can run anytime after Phase 4 completion

**Sequential execution recommended** for most tasks due to:
- Same file modifications (handler.ts, sync.ts)
- Logical dependencies (detection → sync → validation)
- Small feature scope (3 files modified total)

---

## Parallel Example: Foundational Phase

```bash
# Launch foundational helper functions in parallel:
Task T001: "Add isRecurringInstance() helper in src/webhook/handler.ts"
Task T002: "Add extractBaseEventId() helper in src/webhook/handler.ts"

# Both are independent utility functions in same file but different locations
```

---

## Implementation Strategy

### MVP First (User Stories 2 + 1)

1. Complete Phase 2: Foundational (T001-T002)
2. Complete Phase 3: User Story 2 - Instance Detection (T003-T005)
3. Complete Phase 4: User Story 1 - Parent Sync (T006-T014)
4. **STOP and VALIDATE**:
   - Create daily recurring event (30 days)
   - Verify only 1 API call to parent
   - Verify all instances show secondary attendee
   - Check logs for proper `baseEventId` and `instanceId` logging
5. Deploy to Cloud Run if validation passes

**MVP Success Criteria**:
- ✅ Recurring events create 1 API call (not N)
- ✅ All instances inherit parent attendees
- ✅ Single events still work (backward compatible)
- ✅ Logs show both detection and sync operations

### Incremental Delivery

1. **Phase 2 + 3**: Detection foundation → Test with recurring event → Verify logs show instance detection
2. **Phase 4**: Add parent sync → Test end-to-end → Verify API call reduction → **MVP COMPLETE**
3. **Phase 5**: Backward compat validation → Test single events → Deploy
4. **Phase 6**: Cancelled event validation → Test edge cases → Deploy
5. **Phase 7**: Polish and metrics → Final validation → Production ready

Each phase adds safety and robustness without breaking previous functionality.

### Sequential Team Strategy

**Recommended approach**: Sequential implementation by single developer due to:
- Small codebase (3 files modified)
- High cohesion (detection → sync → validation flow)
- Risk of merge conflicts in same files

**Timeline**: 2-3 hours for full implementation (per quickstart.md complexity estimates)

If multiple developers:
1. Developer A: Phase 2 + 3 (detection foundation)
2. Developer B: Phase 4 (parent sync) - waits for A to complete
3. Developer A: Phase 5-6 (validation) - parallel to B's Phase 4 testing
4. Either: Phase 7 (polish)

---

## Notes

- [P] tasks = different files or independent test scenarios
- [Story] label maps task to specific user story for traceability
- Tests are manual (per constitution) - use real Google Calendar events
- Each user story should be independently testable (see Manual Testing sections)
- Commit after each phase completion (not per task - tasks too granular)
- Phases 5-6 are primarily validation, not new code
- Reference quickstart.md for detailed test procedures
- Use Cloud Logging for API call verification and troubleshooting

**File Surface Area**:
- `src/webhook/handler.ts` - Modified in Phase 2, 3, 4 (detection + routing)
- `src/calendar/sync.ts` - Modified in Phase 4 only (parent sync method)
- Total: **2 files modified**, **~150 lines of code added**

**Rollback Plan**: If issues occur post-deployment, revert to commit before Phase 2. Single event flow preserved in if/else branch, so rollback only affects recurring events.
