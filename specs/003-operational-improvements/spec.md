# Feature Specification: Operational Cost Reduction and Reliability Improvements

**Feature Branch**: `003-operational-improvements`
**Created**: 2025-11-03
**Status**: Draft
**Input**: User description: "運用改善機能: Cloud Scheduler & Firestoreによるコスト削減と信頼性向上

現在の Google Calendar Auto-Sync サービスは以下の課題があります：
1. コスト問題: Cloud Run が minScale=1 で常時稼働しており、月額約$25かかっている
2. Watch Channel管理の不透明性: インメモリで管理されているため、サービス再起動時に状態が失われる
3. Webhook通知の信頼性: Watch Channelの有効期限（7日間）管理が不明確で、通知が来なくなることがある"

## User Scenarios & Testing

### User Story 1 - Persistent Watch Channel State Across Service Restarts (Priority: P1)

As a system operator, when the calendar synchronization service restarts (due to maintenance, updates, or scaling events), the system automatically restores all active webhook subscriptions from persistent storage, ensuring continuous calendar event notifications without manual intervention or gaps in coverage.

**Why this priority**: This is the foundation for reliable operation. Without persistent state, every service restart requires re-registering all webhook subscriptions, creating coverage gaps where calendar changes are missed. This directly impacts the core business value of real-time calendar synchronization.

**Independent Test**: Can be fully tested by verifying that webhook subscriptions survive service restarts - register subscriptions, restart the service, and confirm that calendar changes still trigger notifications without re-registration.

**Acceptance Scenarios**:

1. **Given** the service has 9 active webhook subscriptions and persistent storage contains their metadata, **When** the service restarts normally, **Then** all 9 subscriptions are restored from storage within 3 seconds and calendar change notifications continue without interruption.

2. **Given** a webhook subscription in storage has expired (expiration time is in the past), **When** the service starts up, **Then** the system detects the expired subscription, automatically re-registers it with the calendar provider, and updates storage with the new expiration time.

3. **Given** persistent storage contains stale subscription data (more than 7 days old), **When** the service starts, **Then** the system identifies all stale subscriptions, re-registers them with the calendar provider, and updates storage with fresh metadata.

4. **Given** persistent storage is temporarily unavailable during startup, **When** the service attempts to load subscriptions, **Then** the system automatically falls back to full re-registration with the calendar provider and logs a warning for operator review.

---

### User Story 2 - Reduce Operational Costs with On-Demand Service Activation (Priority: P1)

As a project owner, I want the calendar synchronization service to automatically stop when idle and start instantly when calendar change notifications arrive, so that I only pay for actual usage rather than continuous 24/7 operation.

**Why this priority**: This directly addresses the business problem of high operational costs ($25/month) with an 87% cost reduction ($3/month). For a service handling sporadic events (a few notifications per hour), continuous operation is wasteful. This makes the service financially sustainable for long-term use.

**Independent Test**: Can be tested by configuring on-demand activation, waiting 15 minutes without calendar activity, verifying the service has stopped, then triggering a calendar change and confirming the service responds correctly after automatic startup.

**Acceptance Scenarios**:

1. **Given** on-demand activation is enabled and no calendar change notifications arrive for 15 minutes, **When** checking service status, **Then** the service has automatically stopped and no compute charges are accruing.

2. **Given** the service has stopped due to inactivity, **When** a calendar change notification arrives from the calendar provider, **Then** the service automatically starts within 5 seconds and processes the notification successfully.

3. **Given** the service processes a calendar change and returns to idle state, **When** 15 minutes pass without further notifications, **Then** the service automatically stops again.

4. **Given** multiple calendar changes occur in quick succession after the service has stopped, **When** the first notification triggers service startup, **Then** all subsequent notifications are handled by the same service instance without additional startup delays.

---

### User Story 3 - Automated Webhook Subscription Renewal (Priority: P1)

As a system operator, I want webhook subscriptions to be automatically checked and renewed before expiration, so that calendar change notifications continue working indefinitely without manual maintenance or service interruptions.

**Why this priority**: Webhook subscriptions expire after 7 days, causing the service to miss calendar changes until manual intervention. This operational burden and potential service disruption directly impacts reliability. Automated renewal eliminates this maintenance task and ensures continuous operation.

**Independent Test**: Can be tested by creating subscriptions with short expiration times, configuring automated renewal checks, and verifying that subscriptions are renewed before expiration without operator action.

**Acceptance Scenarios**:

1. **Given** a webhook subscription expires in 12 hours, **When** the scheduled renewal check runs at 3 AM daily, **Then** the system renews that subscription with the calendar provider, updates storage with the new expiration time (now + 7 days), and logs the successful renewal.

2. **Given** all webhook subscriptions have more than 24 hours until expiration, **When** the scheduled renewal check runs, **Then** the system verifies all subscriptions, determines no action is needed, and completes the check within 10 seconds.

3. **Given** the scheduled renewal job fails due to a temporary network error, **When** the job automatically retries (built-in retry mechanism), **Then** the second attempt succeeds and subscriptions are renewed successfully.

4. **Given** multiple subscriptions are expiring soon, **When** the renewal job runs, **Then** all expiring subscriptions are renewed concurrently, and the entire operation completes within 30 seconds.

---

### User Story 4 - Operational Health Monitoring (Priority: P2)

As a system operator, I want the service to periodically report its health status and trigger alerts when problems are detected, so I can proactively address issues before they impact calendar synchronization.

**Why this priority**: While the service can operate without proactive monitoring, early detection of problems (missing subscriptions, configuration errors, provider connectivity issues) significantly reduces mean time to resolution and prevents extended outages. This improves overall reliability but isn't required for basic functionality.

**Independent Test**: Can be tested by configuring health checks, simulating various failure conditions (invalid credentials, missing subscriptions), and verifying that appropriate alerts are triggered.

**Acceptance Scenarios**:

1. **Given** the service is operating normally, **When** the scheduled health check runs every 6 hours, **Then** the check returns healthy status showing subscription count, user mapping status, and last successful synchronization time.

2. **Given** the service cannot load user mappings from the configuration source, **When** the scheduled health check runs, **Then** the check reports degraded health with specific error details, triggering an operator alert.

3. **Given** no webhook subscriptions are registered (subscription registry is empty), **When** the scheduled health check runs, **Then** the system logs a critical warning and triggers an alert for immediate operator investigation.

4. **Given** the service has stopped due to inactivity, **When** the scheduled health check runs, **Then** the check automatically starts the service to perform health validation, then allows it to stop again if no other activity is present.

---

### User Story 5 - Manual Subscription Management Operations (Priority: P2)

As a system operator, I need administrative commands to manually inspect and manage webhook subscriptions for troubleshooting and maintenance tasks, without requiring code changes or database access.

**Why this priority**: These operational tools significantly improve debuggability and enable quick resolution of issues (stuck subscriptions, configuration problems, testing scenarios). While the system can function without them, they reduce operational complexity and mean time to recovery for problems.

**Independent Test**: Can be tested by executing each administrative command and verifying the expected behavior (force re-registration succeeds, status display shows accurate information, individual subscription removal works correctly).

**Acceptance Scenarios**:

1. **Given** an operator suspects webhook subscriptions are stale or misconfigured, **When** they invoke the force re-registration command, **Then** the system stops all existing subscriptions, re-registers all 9 subscriptions with the calendar provider, updates storage, and returns success confirmation with timing details.

2. **Given** an operator wants to inspect current subscription status, **When** they invoke the status display command, **Then** the system returns detailed information for all active subscriptions including subscription identifiers, associated calendar addresses, and expiration times.

3. **Given** an operator needs to remove a specific problematic subscription, **When** they invoke the removal command with a subscription identifier, **Then** the system stops that subscription with the calendar provider, removes it from storage, and confirms successful deletion.

4. **Given** an operator attempts to use an administrative command without proper authentication, **When** the command request arrives, **Then** the system denies access and returns an authentication error.

---

### User Story 6 - Efficient Data Access Patterns (Priority: P3)

As a developer, I want the persistent storage schema to support fast queries for common operations (retrieve all subscriptions, find expiring subscriptions, query by calendar address) so that service startup and renewal operations complete quickly even as subscription counts grow.

**Why this priority**: This is an optimization that ensures good performance as the system scales. With current scale (9 subscriptions), even basic storage patterns work fine. This becomes important only if the system grows to hundreds of subscriptions, making it a future-proofing measure rather than an immediate need.

**Independent Test**: Can be tested by loading the storage with many test subscriptions (100+), executing common query operations, and verifying response times meet performance targets.

**Acceptance Scenarios**:

1. **Given** persistent storage contains 100 webhook subscriptions, **When** the service starts and queries all subscriptions, **Then** the query completes in less than 100 milliseconds.

2. **Given** subscriptions are indexed by calendar address in storage, **When** querying subscriptions for a specific calendar, **Then** the query uses the index and returns results in less than 50 milliseconds.

3. **Given** the renewal job queries for subscriptions expiring within 24 hours, **When** the query executes, **Then** the storage uses an index on expiration time and returns matching subscriptions efficiently.

4. **Given** concurrent reads and writes to storage occur (service startup while renewal job runs), **When** both operations access subscription data, **Then** the storage handles concurrent access correctly without errors or data inconsistencies.

---

### Edge Cases

- **What happens when persistent storage experiences intermittent failures?**
  The system falls back to re-registering subscriptions from the current user mapping configuration. This maintains service availability but may temporarily miss notifications during the fallback process.

- **How does the system handle calendar provider rate limits during bulk re-registration?**
  The system implements exponential backoff and retry logic. If rate limited, subscriptions are registered sequentially with delays rather than concurrently, ensuring eventual success at the cost of slower startup.

- **What happens if a subscription is manually deleted from storage but still active with the calendar provider?**
  The service won't track the orphaned subscription, and the calendar provider will send notifications that are rejected as "unknown subscription." The next scheduled renewal cycle or service restart will clean up and establish consistent state.

- **How does the system handle timezone differences for scheduled operations?**
  All scheduled times are specified in the operator's preferred timezone (JST in the example) and automatically converted to UTC for execution. Daylight saving time changes are handled automatically by the scheduling mechanism.

- **What happens if renewal is delayed and a subscription actually expires?**
  Calendar changes will result in failed notifications until the next successful renewal or service restart. The system logs these failures, and health checks will detect the missing subscriptions, triggering operator alerts.

- **How does the system handle subscriptions for users who are removed from the mapping configuration?**
  Orphaned subscriptions are automatically identified and stopped during the next renewal cycle. This prevents unnecessary subscription maintenance for users no longer being synchronized.

## Requirements

### Functional Requirements

- **FR-001**: System MUST persist webhook subscription metadata (subscription identifier, resource identifier, calendar address, expiration time) to durable storage when subscriptions are registered
- **FR-002**: System MUST load webhook subscription state from persistent storage during service startup before processing any calendar change notifications
- **FR-003**: System MUST support service configuration that allows automatic stopping when idle and starting on-demand when notifications arrive
- **FR-004**: System MUST provide an administrative endpoint that renews webhook subscriptions expiring within 24 hours
- **FR-005**: System MUST provide an administrative endpoint that forces re-registration of all webhook subscriptions
- **FR-006**: System MUST provide an administrative endpoint that displays current webhook subscription status including identifiers and expiration times
- **FR-007**: Scheduled job MUST run daily at operator-specified time (3 AM JST) to check and renew expiring webhook subscriptions
- **FR-008**: Scheduled job MUST run periodically (every 6 hours) to perform health checks and report service status
- **FR-009**: System MUST detect expired subscriptions in persistent storage during startup and automatically re-register them
- **FR-010**: System MUST fall back to full subscription re-registration if persistent storage is unavailable
- **FR-011**: System MUST update persistent storage atomically when registering or stopping subscriptions to prevent data inconsistencies
- **FR-012**: System MUST log all webhook subscription operations (register, renew, stop) with timestamps for audit trail and troubleshooting

### Key Entities

- **Webhook Subscription**: Represents an active calendar change notification channel. Key attributes include unique subscription identifier (assigned by calendar provider), calendar address being monitored, expiration timestamp, resource identifier (provider-specific tracking), and registration timestamp.

- **Renewal Schedule**: Represents scheduled automated tasks. Key attributes include task identifier, execution frequency (daily, every 6 hours), scheduled execution time, target endpoint or operation, and last successful execution timestamp.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Monthly operational cost is reduced to $5 or less (87% reduction from current $25/month cost)
- **SC-002**: Service startup time including persistent storage retrieval completes within 5 seconds for 95% of restarts
- **SC-003**: Webhook subscription availability (ability to receive calendar change notifications) is 99.9% or higher over any 30-day period
- **SC-004**: Automated renewal successfully renews 100% of expiring subscriptions within 24 hours of expiration
- **SC-005**: Persistent storage read operations complete within 200 milliseconds for 99% of queries
- **SC-006**: Service startup after period of inactivity completes within 5 seconds and successfully processes incoming calendar change notifications
- **SC-007**: Zero subscription data loss during service restarts (subscription count before restart equals subscription count after startup)
- **SC-008**: Scheduled automated tasks execute successfully 99% of the time over any 30-day period

## Out of Scope

The following are explicitly excluded from this feature to maintain focus on operational improvements:

- Migration of user mapping configuration to persistent storage (remains loaded from spreadsheet as designed)
- Migration of deduplication cache to external cache service (remains in-memory for current scale)
- User interface or dashboard for monitoring webhook subscription status (command-line administrative tools only)
- Automatic scaling beyond single-instance on-demand operation (single instance sufficient for current event volume)
- Multi-region deployment or geographic redundancy (single-region deployment meets current needs)
- Automatic subscription registration when new users are added to mapping configuration during runtime (handled on next service restart)
- Webhook subscription management for other services or calendar providers (focused on current Google Calendar integration)

## Dependencies

- Durable storage service with read/write API must be available and configured
- Task scheduling service with HTTP endpoint invocation capability must be available
- Service account with read/write permissions for persistent storage
- Service account with invocation permissions for scheduled task execution
- Current webhook subscription functionality must remain operational (no breaking changes to existing calendar provider integration)

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Persistent storage outage causes subscription data loss | High | Low | Automatic fallback to full re-registration; subscription data can be reconstructed from user mapping configuration |
| Service startup exceeds 5 seconds, missing calendar change notifications | Medium | Medium | Optimize storage queries; calendar provider automatically retries failed notification deliveries |
| Scheduled renewal job fails repeatedly, leading to subscription expiration | High | Low | Built-in retry policy on scheduled jobs; manual force re-registration endpoint available; health monitoring alerts operators to failures |
| Concurrent storage writes cause data corruption or inconsistency | Medium | Low | Use atomic write operations in storage layer; test concurrent access scenarios thoroughly |
| Increased storage costs exceed budget projections | Low | Low | Monitor costs continuously; current scale (9 subscriptions) is well within free tier limits; implement data retention policies if needed |

## Assumptions

- Calendar provider supports webhook subscription expiration renewal (standard behavior for subscription-based notification systems)
- Service restarts occur infrequently enough that occasional cold start delays (5 seconds) are acceptable to users
- Current event volume (estimated few notifications per hour) remains within single-instance processing capacity even with on-demand activation
- Persistent storage service has 99.9% availability SLA or better to support reliability goals
- Operator has access to administrative endpoints for manual troubleshooting when needed
- Scheduled task execution has sufficient reliability (99%+) to support automated renewal requirements
