import { ChannelStore } from '../state/channel-store.js';
import { ChannelRegistry, WatchChannel } from '../state/channel-registry.js';
import { CalendarClient } from '../calendar/client.js';
import { RenewalSummary, RenewalResult, RenewalFailure, RenewalSkipped } from '../state/types.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

/**
 * Service for automated webhook subscription renewal
 */
export class RenewalService {
  constructor(
    private readonly channelStore: ChannelStore,
    private readonly channelRegistry: ChannelRegistry,
    private readonly calendarClient: CalendarClient,
    private readonly webhookUrl: string
  ) {}

  /**
   * Find channels expiring within threshold
   * @param thresholdMs - Milliseconds from now to consider "expiring soon"
   * @returns List of channels needing renewal
   */
  async findExpiringChannels(thresholdMs: number): Promise<WatchChannel[]> {
    try {
      // Query Firestore for channels expiring within threshold
      const channels = await this.channelStore.findExpiringChannels(thresholdMs);

      logger.info('Found expiring channels', {
        operation: 'RenewalService.findExpiringChannels',
        context: {
          count: channels.length,
          thresholdMs,
          threshold: new Date(Date.now() + thresholdMs).toISOString(),
        },
      });

      // Convert Firestore documents to WatchChannel format
      return channels.map((doc) => ({
        channelId: doc.channelId,
        resourceId: doc.resourceId,
        calendarId: doc.calendarId,
        expiration: doc.expiration,
      }));
    } catch (error) {
      logger.error('Failed to find expiring channels', {
        operation: 'RenewalService.findExpiringChannels',
        error: { message: error instanceof Error ? error.message : String(error) },
      });

      throw error;
    }
  }

  /**
   * Renew a single watch channel
   * Stops the old channel and registers a new one
   *
   * @param channel - Channel to renew
   * @returns Renewal result with timing information
   */
  async renewChannel(channel: WatchChannel): Promise<RenewalResult> {
    const startTime = Date.now();

    try {
      logger.info('Renewing watch channel', {
        operation: 'RenewalService.renewChannel',
        context: {
          channelId: channel.channelId,
          calendarId: channel.calendarId,
          oldExpiration: new Date(channel.expiration).toISOString(),
        },
      });

      // Step 1: Stop old channel
      try {
        await withRetry(() =>
          this.calendarClient.stopWatchChannel(channel.channelId, channel.resourceId)
        );

        logger.info('Old channel stopped', {
          operation: 'RenewalService.renewChannel',
          context: {
            channelId: channel.channelId,
            calendarId: channel.calendarId,
          },
        });
      } catch (error) {
        // Log warning but continue - channel may already be expired/stopped
        logger.warn('Failed to stop old channel (may already be expired)', {
          operation: 'RenewalService.renewChannel',
          context: {
            channelId: channel.channelId,
            calendarId: channel.calendarId,
            error: { message: error instanceof Error ? error.message : String(error) },
          },
        });
      }

      // Step 2: Register new channel
      const sanitizedCalendarId = channel.calendarId.replace(/[@.]/g, '-');
      const newChannelId = `calendar-sync-${sanitizedCalendarId}-${Date.now()}`;

      const response = await withRetry(() =>
        this.calendarClient.registerWatchChannel(
          channel.calendarId,
          newChannelId,
          this.webhookUrl
        )
      );

      if (!response.id || !response.resourceId || !response.expiration) {
        throw new Error('Invalid watch channel response from Google Calendar API');
      }

      const newChannel: WatchChannel = {
        channelId: response.id,
        resourceId: response.resourceId,
        calendarId: channel.calendarId,
        expiration: parseInt(response.expiration, 10),
      };

      // Step 3: Update Firestore with new channel info
      await this.channelStore.saveChannel({
        channelId: newChannel.channelId,
        resourceId: newChannel.resourceId,
        calendarId: newChannel.calendarId,
        expiration: newChannel.expiration,
        registeredAt: Date.now(),
        lastUpdatedAt: Date.now(),
        status: 'active',
      });

      // Step 4: Update in-memory registry
      this.channelRegistry.unregister(channel.channelId); // Remove old
      this.channelRegistry.register(newChannel); // Add new

      // Step 5: Delete old channel from Firestore
      try {
        await this.channelStore.stopChannel(channel.channelId);
      } catch (error) {
        // Log warning but don't fail renewal
        logger.warn('Failed to delete old channel from Firestore', {
          operation: 'RenewalService.renewChannel',
          context: {
            channelId: channel.channelId,
            error: { message: error instanceof Error ? error.message : String(error) },
          },
        });
      }

      const duration = Date.now() - startTime;

      const result: RenewalResult = {
        channelId: newChannel.channelId,
        calendarId: channel.calendarId,
        oldExpiration: channel.expiration,
        newExpiration: newChannel.expiration,
        duration,
      };

      logger.info('Channel renewed successfully', {
        operation: 'RenewalService.renewChannel',
        duration,
        context: {
          oldChannelId: channel.channelId,
          newChannelId: newChannel.channelId,
          calendarId: channel.calendarId,
          newExpiration: new Date(newChannel.expiration).toISOString(),
        },
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to renew channel', {
        operation: 'RenewalService.renewChannel',
        duration,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        context: {
          channelId: channel.channelId,
          calendarId: channel.calendarId,
        },
      });

      throw error;
    }
  }

  /**
   * Renew all channels expiring within threshold
   *
   * @param thresholdMs - Milliseconds from now (default 24 hours)
   * @param dryRun - If true, return channels that would be renewed without taking action
   * @returns Summary of renewal operation
   */
  async renewExpiringChannels(
    thresholdMs: number = 86400000, // 24 hours
    dryRun: boolean = false
  ): Promise<RenewalSummary> {
    const startTime = Date.now();

    logger.info('Starting channel renewal job', {
      operation: 'RenewalService.renewExpiringChannels',
      context: {
        thresholdMs,
        dryRun,
        threshold: new Date(Date.now() + thresholdMs).toISOString(),
      },
    });

    const renewed: RenewalResult[] = [];
    const skipped: RenewalSkipped[] = [];
    const failed: RenewalFailure[] = [];

    try {
      // Find channels expiring soon
      const expiring = await this.findExpiringChannels(thresholdMs);

      if (expiring.length === 0) {
        logger.info('No channels need renewal', {
          operation: 'RenewalService.renewExpiringChannels',
          context: { thresholdMs },
        });

        return {
          renewed: [],
          skipped: [],
          failed: [],
          summary: {
            total: 0,
            renewed: 0,
            skipped: 0,
            failed: 0,
            duration: Date.now() - startTime,
          },
        };
      }

      if (dryRun) {
        logger.info('Dry run - channels would be renewed', {
          operation: 'RenewalService.renewExpiringChannels',
          context: {
            count: expiring.length,
            channels: expiring.map((ch) => ({
              channelId: ch.channelId,
              calendarId: ch.calendarId,
              expiration: new Date(ch.expiration).toISOString(),
            })),
          },
        });

        return {
          renewed: [],
          skipped: expiring.map((ch) => ({
            channelId: ch.channelId,
            calendarId: ch.calendarId,
            expiration: ch.expiration,
            reason: 'Dry run - no action taken',
          })),
          failed: [],
          summary: {
            total: expiring.length,
            renewed: 0,
            skipped: expiring.length,
            failed: 0,
            duration: Date.now() - startTime,
          },
        };
      }

      // Renew each channel
      for (const channel of expiring) {
        // Idempotency check: verify channel still needs renewal
        const now = Date.now();
        if (channel.expiration >= now + thresholdMs) {
          skipped.push({
            channelId: channel.channelId,
            calendarId: channel.calendarId,
            expiration: channel.expiration,
            reason: `Expiration > threshold (still ${Math.round((channel.expiration - now) / 1000 / 3600)} hours away)`,
          });
          continue;
        }

        try {
          const result = await this.renewChannel(channel);
          renewed.push(result);
        } catch (error) {
          const err = error as Error;

          // Check if rate limited
          const retryAfter = err.message.includes('rate limit') ? 30 : undefined;

          failed.push({
            channelId: channel.channelId,
            calendarId: channel.calendarId,
            error: err.message,
            retryAfter,
          });
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Channel renewal job complete', {
        operation: 'RenewalService.renewExpiringChannels',
        duration,
        context: {
          total: expiring.length,
          renewed: renewed.length,
          skipped: skipped.length,
          failed: failed.length,
        },
      });

      return {
        renewed,
        skipped,
        failed,
        summary: {
          total: expiring.length,
          renewed: renewed.length,
          skipped: skipped.length,
          failed: failed.length,
          duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Channel renewal job failed', {
        operation: 'RenewalService.renewExpiringChannels',
        duration,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

      throw error;
    }
  }
}
