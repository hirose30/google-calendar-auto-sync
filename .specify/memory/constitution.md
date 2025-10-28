# Google Calendar Auto-Sync Constitution

## Core Principles

### I. Minimal Deployment Footprint

**Single-Service Architecture**: Every feature should run as a single, self-contained service without unnecessary complexity.

- Services must be independently deployable
- No microservices unless absolutely necessary (scale requirements >1000 events/day)
- In-memory state preferred over external databases when acceptable
- Clear justification required for adding external dependencies

**Rationale**: This project runs on Cloud Run with minimal resources. Simplicity reduces operational overhead and costs.

### II. API-First Integration

**Google APIs as Source of Truth**: Calendar and configuration data live in Google services, not local databases.

- Google Calendar API: Authoritative source for event data
- Google Sheets API: Configuration management (user mappings)
- Service Account with Domain-Wide Delegation: Authentication standard
- Push Notifications: Real-time event detection mechanism

**Rationale**: Leverage Google's infrastructure instead of building redundant storage layers.

### III. Observable Operations (NON-NEGOTIABLE)

**Structured Logging Mandatory**: All operations must emit structured JSON logs for troubleshooting.

- Every sync operation logs: eventId, calendarId, operation, duration, result
- Error logs include: error message, stack trace, retry count, context
- Success criteria: Administrator can identify root cause within 10 minutes (SC-008)
- Log levels: ERROR (failures), WARN (retries), INFO (operations), DEBUG (details)

**Required Log Events**:
- Service startup: Service account loaded, mappings loaded, watch channels registered
- Sync operations: Event detected, attendees resolved, sync success/failure
- Errors: Permission denied, API rate limit, network timeout, invalid mapping

**Rationale**: Cloud Run logs are the primary troubleshooting interface. Rich logs are non-negotiable.

### IV. Graceful Failure Handling

**Retry with Backoff**: Transient failures must be retried automatically.

- Fixed backoff: 30 seconds between attempts
- Max retries: 5 attempts
- After exhaustion: Log failure with context for manual review
- No silent failures: Every error path must log or throw

**Error Categories**:
- **Retryable**: Network timeout, API rate limit (429), temporary service unavailable (503)
- **Non-retryable**: Permission denied (403), not found (404), invalid request (400)
- **Critical**: Service account authentication failure, spreadsheet access denied

**Rationale**: Google APIs have occasional transient failures. Retry logic prevents false alarms.

### V. Configuration as Data

**Google Spreadsheet as Admin UI**: Non-technical users must be able to manage user mappings without code deployment.

- Spreadsheet schema: Primary Email | Secondary Emails | Status
- Cached in-memory with periodic refresh (5 minutes)
- Invalid entries logged as warnings, processing continues with valid entries
- Manual reload endpoint: `/admin/reload-mappings`

**Rationale**: Administrators need self-service mapping management without developer intervention.

## Additional Constraints

### Performance Standards

- **Latency SLA**: 95% of events synchronized within 2 minutes (SC-001, SC-002)
- **Detection Rate**: 99.9% of events detected via Watch Channels (SC-003)
- **Concurrency**: Support 100 concurrent event changes without degradation (SC-005)
- **Zero Duplicates**: Deduplication cache prevents duplicate attendee additions (SC-004)

### Security Requirements

- **Service Account Only**: No user credentials stored or managed
- **Domain-Wide Delegation**: Calendar access via impersonation, not OAuth flows
- **Secrets Management**: Cloud Run secrets for SPREADSHEET_ID and SERVICE_ACCOUNT_KEY
- **No Sensitive Logging**: Never log service account keys or full attendee lists

### Deployment Policies

- **Single Instance Default**: `--max-instances 1` for MVP to prevent duplicate processing
- **ARM64 → amd64**: Use `docker buildx --platform linux/amd64` for Cloud Run compatibility
- **Environment Variables**: All configuration via environment variables, no hardcoded values
- **Health Check**: `/health` endpoint must return cache status and timestamp

## Development Workflow

### Testing Gates

- **Unit Tests**: Core sync logic, mapping resolution, retry behavior
- **Integration Tests**: Webhook endpoint, Calendar API client contracts
- **Manual Testing**: Real calendar events before production deployment

**Note**: Tests are optional but recommended for production confidence.

### Code Quality

- **TypeScript 5.3+**: Type safety mandatory, no `any` types without justification
- **Structured Modules**: Logical grouping by responsibility (calendar/, config/, webhook/, state/, utils/)
- **Error Types**: Custom error classes for different failure modes
- **Linting**: ESLint with TypeScript rules

### Deployment Process

1. Build: `docker buildx build --platform linux/amd64`
2. Push: Push to Google Container Registry (GCR)
3. Deploy: Cloud Run with environment variables and secrets
4. Verify: Health check + Watch Channel registration logs
5. Monitor: Cloud Logging for sync latency and errors

## Governance

### Constitution Authority

This constitution supersedes ad-hoc decisions. When in doubt:

1. Refer to principles (I-V)
2. Check constraints (Performance, Security, Deployment)
3. Justify deviations with clear reasoning

### Amendments

Constitution changes require:
1. Documentation of rationale (why change is needed)
2. Impact analysis (what breaks, what improves)
3. Migration plan (how to transition existing code)

### Complexity Justification

Adding complexity (external database, microservices, new API dependencies) requires:
- **Scale Evidence**: Current solution cannot meet performance targets
- **Operational Impact**: Analysis of maintenance burden
- **Cost Analysis**: Infrastructure cost increase
- **Alternatives Considered**: Why simpler options won't work

Example: Redis for deduplication only justified if `--max-instances 1` cannot handle load (>1000 events/day).

## Guidance for Runtime Development

When implementing new features:

1. **Start Simple**: In-memory state before external storage
2. **Log Everything**: Structured logs for troubleshooting (SC-008)
3. **Retry Smartly**: Fixed backoff, max 5 attempts
4. **Test with Real APIs**: Mock for unit tests, real APIs for integration tests
5. **Monitor SLAs**: Track p95 latency, error rate, detection rate

**Version**: 1.0.0
**Ratified**: 2025-10-28
**Last Amended**: 2025-10-28
**Based On**: Production deployment experience of `001-calendar-cross-workspace-sync` feature
