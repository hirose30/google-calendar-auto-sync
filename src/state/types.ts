/**
 * Firestore document types for webhook subscription persistence
 */

/**
 * Webhook subscription document stored in Firestore
 * Collection: watchChannels
 * Document ID: channelId
 */
export interface WatchChannelDocument {
  /** Unique identifier for this watch channel (document ID) */
  channelId: string;

  /** Google Calendar API resource identifier for this channel */
  resourceId: string;

  /** Email address of the calendar being monitored */
  calendarId: string;

  /** Unix timestamp in milliseconds when this channel expires */
  expiration: number;

  /** Unix timestamp in milliseconds when this channel was first registered */
  registeredAt: number;

  /** Unix timestamp in milliseconds of last modification */
  lastUpdatedAt: number;

  /** Current channel state */
  status: 'active' | 'expired' | 'stopped';
}

/**
 * Partial update for watch channel renewal
 */
export interface WatchChannelUpdate {
  expiration?: number;
  lastUpdatedAt?: number;
  status?: 'active' | 'expired' | 'stopped';
}

/**
 * Query result for expiring channels
 */
export interface ExpiringChannelsQuery {
  /** Channels expiring within threshold */
  channels: WatchChannelDocument[];

  /** Unix timestamp used as query threshold */
  queryTimestamp: number;
}

/**
 * Renewal operation result
 */
export interface RenewalResult {
  /** Successfully renewed channel */
  channelId: string;

  /** Calendar email */
  calendarId: string;

  /** Previous expiration timestamp */
  oldExpiration: number;

  /** New expiration timestamp after renewal */
  newExpiration: number;

  /** Time taken to renew in milliseconds */
  duration: number;
}

/**
 * Renewal operation failure
 */
export interface RenewalFailure {
  /** Failed channel ID */
  channelId: string;

  /** Calendar email */
  calendarId: string;

  /** Error message */
  error: string;

  /** Retry delay in seconds (if applicable) */
  retryAfter?: number;
}

/**
 * Skipped channel during renewal
 */
export interface RenewalSkipped {
  /** Skipped channel ID */
  channelId: string;

  /** Calendar email */
  calendarId: string;

  /** Expiration timestamp */
  expiration: number;

  /** Reason for skipping */
  reason: string;
}

/**
 * Complete renewal job summary
 */
export interface RenewalSummary {
  /** Successfully renewed channels */
  renewed: RenewalResult[];

  /** Skipped channels (not expiring soon) */
  skipped: RenewalSkipped[];

  /** Failed renewal attempts */
  failed: RenewalFailure[];

  /** Summary statistics */
  summary: {
    total: number;
    renewed: number;
    skipped: number;
    failed: number;
    duration: number;
  };
}

/**
 * Channel status for admin endpoint
 */
export interface ChannelStatus {
  /** Channel metadata */
  channelId: string;
  calendarId: string;
  expiration: string; // ISO 8601 format
  expiresIn: string; // Human-readable duration

  /** Status indicator */
  status: 'active' | 'expired' | 'stopped';

  /** Timestamps */
  registeredAt: string; // ISO 8601 format
  lastUpdatedAt: string; // ISO 8601 format

  /** Warnings (if any) */
  warning?: string;
}

/**
 * Health check result
 */
export interface HealthStatus {
  /** Firestore connection status */
  firestoreConnected: boolean;

  /** Google Calendar API connection status */
  calendarApiConnected: boolean;

  /** Last successful renewal job execution */
  lastRenewal?: string; // ISO 8601 format

  /** Next scheduled renewal */
  nextRenewal?: string; // ISO 8601 format
}
