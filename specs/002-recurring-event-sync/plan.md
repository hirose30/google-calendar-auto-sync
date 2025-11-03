# Implementation Plan: Recurring Event Parent Synchronization

**Branch**: `002-recurring-event-sync` | **Date**: 2025-10-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-recurring-event-sync/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Fix critical bug where recurring calendar events create hundreds/thousands of individual API calls (one per instance) by implementing parent event detection and synchronization. When a recurring event instance is detected via webhook (Event ID contains `_`), extract the base event ID, fetch the parent recurring event, and add secondary workspace attendees to the parent only once. All instances (past, present, future) automatically inherit attendees from the parent, reducing API load from O(N) to O(1) per recurring series.

## Technical Context

**Language/Version**: TypeScript 5.3+ with Node.js 20 LTS
**Primary Dependencies**: Express (webhook server), googleapis (Calendar API + Sheets API), google-auth-library (JWT client)
**Storage**: In-memory (UserMappingStore, ChannelRegistry, DeduplicationCache) - no external database per constitution
**Testing**: Manual testing with real Google Calendar events (unit tests optional per constitution)
**Target Platform**: Cloud Run (serverless containers), linux/amd64 via docker buildx
**Project Type**: Single service (API webhook endpoint + background sync workers)
**Performance Goals**: 1 API call per recurring series (not N calls for N instances), 95% sync latency <2 minutes, 0 duplicate parent updates
**Constraints**: max-instances 1 (single instance for deduplication cache consistency), existing retry logic (5 attempts, 30s intervals)
**Scale/Scope**: Enhancement to existing feature 001 - adds recurring event detection logic to existing sync flow, affects 3-4 source files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ I. Minimal Deployment Footprint
- **Pass**: No new services, no external dependencies, extends existing single-service architecture
- **Pass**: In-memory state only (no database)
- **Pass**: Reuses existing DeduplicationCache and retry mechanisms

### ✅ II. API-First Integration
- **Pass**: Uses existing Google Calendar API client
- **Pass**: No new authentication mechanisms
- **Pass**: Parent event fetch uses same Calendar API as instance fetch

### ✅ III. Observable Operations (NON-NEGOTIABLE)
- **Pass**: Will log parent event detection (include base ID + instance ID)
- **Pass**: Will log parent sync separately from instance sync
- **Pass**: Maintains 10-minute troubleshooting target (SC-007)

### ✅ IV. Graceful Failure Handling
- **Pass**: Reuses existing retry logic (5 attempts, 30s backoff)
- **Pass**: Parent fetch/update errors handled same as instance errors
- **Pass**: No new error categories introduced

### ✅ V. Configuration as Data
- **Pass**: No configuration changes needed
- **Pass**: Uses existing user mapping Spreadsheet
- **Pass**: No new admin endpoints required

### Performance Standards
- **Pass**: Improves API efficiency (N calls → 1 call per series)
- **Pass**: Maintains 95% <2min latency target (SC-003)
- **Pass**: Zero duplicates via existing deduplication cache (SC-004)

### Security Requirements
- **Pass**: No changes to authentication or secrets management
- **Pass**: Same service account impersonation for parent events

### Deployment Policies
- **Pass**: No deployment changes (remains single instance)
- **Pass**: No new environment variables
- **Pass**: Health check unchanged

**Result**: ✅ **ALL GATES PASSED** - No constitution violations

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── calendar/
│   ├── client.ts           # No changes (uses existing getEvent() for parent fetch)
│   ├── sync.ts             # MODIFY: Add syncRecurringParentEvent() method
│   └── watcher.ts          # No changes
├── webhook/
│   └── handler.ts          # MODIFY: Add isRecurringInstance(), extractBaseEventId(), route to parent sync
├── state/
│   ├── dedup-cache.ts      # No changes (reuse existing)
│   └── mapping-store.ts    # No changes
└── utils/
    └── logger.ts           # No changes

tests/                      # Optional (constitution allows manual testing)
└── (manual testing with real Calendar events)
```

**Structure Decision**: Single-service architecture (existing). This is an **enhancement** to the existing synchronization system, not a new feature. Changes concentrated in 2 files:
1. `calendar/sync.ts` - Add `syncRecurringParentEvent()` method with parent event detection and synchronization logic
2. `webhook/handler.ts` - Add `isRecurringInstance()` and `extractBaseEventId()` helpers, route recurring instances to parent sync

**Implementation Note**: The existing `calendar-client.ts` `getEvent()` method is reused for parent event fetching - no modifications needed.

No new modules, no new dependencies, no new configuration files.

## Complexity Tracking

**No violations** - Constitution Check passed all gates. This section is not applicable.
