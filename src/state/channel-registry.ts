import { logger } from '../utils/logger.js';

/**
 * Watch channel metadata
 */
export interface WatchChannel {
  channelId: string;
  resourceId: string;
  calendarId: string;
  expiration: number; // Unix timestamp in milliseconds
}

/**
 * Registry for tracking active Google Calendar watch channels
 * Manages channel lifecycle and renewal
 */
export class ChannelRegistry {
  private channels: Map<string, WatchChannel>; // channelId -> WatchChannel

  constructor() {
    this.channels = new Map();
  }

  /**
   * Register a new watch channel
   */
  register(channel: WatchChannel): void {
    this.channels.set(channel.channelId, channel);

    logger.info('Watch channel registered', {
      operation: 'ChannelRegistry.register',
      context: {
        channelId: channel.channelId,
        calendarId: channel.calendarId,
        resourceId: channel.resourceId,
        expiration: new Date(channel.expiration).toISOString(),
      },
    });
  }

  /**
   * Unregister a watch channel
   */
  unregister(channelId: string): void {
    const removed = this.channels.delete(channelId);

    if (removed) {
      logger.info('Watch channel unregistered', {
        operation: 'ChannelRegistry.unregister',
        context: { channelId },
      });
    }
  }

  /**
   * Get channel by ID
   */
  get(channelId: string): WatchChannel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get all channels for a specific calendar
   */
  getByCalendar(calendarId: string): WatchChannel[] {
    return Array.from(this.channels.values()).filter(
      (ch) => ch.calendarId === calendarId
    );
  }

  /**
   * Get all registered channels
   */
  getAll(): WatchChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get channels expiring within the threshold
   */
  getExpiringSoon(thresholdMs: number): WatchChannel[] {
    const now = Date.now();
    const threshold = now + thresholdMs;

    return this.getAll().filter((ch) => ch.expiration <= threshold);
  }

  /**
   * Check if channel exists
   */
  has(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  /**
   * Get total number of registered channels
   */
  size(): number {
    return this.channels.size;
  }
}
