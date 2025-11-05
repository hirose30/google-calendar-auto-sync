import { CalendarClient } from './client.js';
import { ChannelRegistry, WatchChannel } from '../state/channel-registry.js';
import { UserMappingStore } from '../state/mapping-store.js';
import { ChannelSync } from '../state/channel-sync.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

/**
 * Manages Google Calendar watch channels for push notifications
 */
export class WatchChannelManager {
  private calendarClient: CalendarClient;
  private channelRegistry: ChannelRegistry;
  private mappingStore: UserMappingStore;
  private channelSync: ChannelSync | null;
  private webhookUrl: string;
  private renewalThresholdMs: number;

  constructor(
    calendarClient: CalendarClient,
    channelRegistry: ChannelRegistry,
    mappingStore: UserMappingStore,
    webhookUrl: string,
    renewalThresholdMs: number,
    channelSync: ChannelSync | null = null
  ) {
    this.calendarClient = calendarClient;
    this.channelRegistry = channelRegistry;
    this.mappingStore = mappingStore;
    this.channelSync = channelSync;
    this.webhookUrl = webhookUrl;
    this.renewalThresholdMs = renewalThresholdMs;
  }

  /**
   * Register watch channels for all primary users with mappings
   */
  async registerAllChannels(): Promise<void> {
    const startTime = Date.now();
    const primaryUsers = this.mappingStore.getAllPrimaries();

    logger.info('Registering watch channels for all primary users', {
      operation: 'registerAllChannels',
      context: {
        userCount: primaryUsers.length,
        users: primaryUsers,
      },
    });

    const results = await Promise.allSettled(
      primaryUsers.map((userEmail) => this.registerChannel(userEmail))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    const duration = Date.now() - startTime;

    logger.info('Watch channel registration complete', {
      operation: 'registerAllChannels',
      duration,
      context: {
        total: primaryUsers.length,
        succeeded,
        failed,
      },
    });

    if (failed > 0) {
      logger.warn('Some watch channels failed to register', {
        operation: 'registerAllChannels',
        context: {
          failed,
          total: primaryUsers.length,
        },
      });
    }
  }

  /**
   * Register a watch channel for a specific calendar
   */
  async registerChannel(calendarId: string): Promise<WatchChannel> {
    const startTime = Date.now();
    // Channel ID must match [A-Za-z0-9\-_\+/=]+ - remove @ and . from email
    const sanitizedCalendarId = calendarId.replace(/[@.]/g, '-');
    const channelId = `calendar-sync-${sanitizedCalendarId}-${Date.now()}`;

    try {
      logger.info('Registering watch channel', {
        operation: 'registerChannel',
        context: {
          calendarId,
          channelId,
          webhookUrl: this.webhookUrl,
        },
      });

      const response = await withRetry(() =>
        this.calendarClient.registerWatchChannel(
          calendarId,
          channelId,
          this.webhookUrl
        )
      );

      if (!response.id || !response.resourceId || !response.expiration) {
        throw new Error('Invalid watch channel response from Google Calendar API');
      }

      const channel: WatchChannel = {
        channelId: response.id,
        resourceId: response.resourceId,
        calendarId,
        expiration: parseInt(response.expiration, 10),
      };

      // Save to both Firestore and registry (if ChannelSync available)
      if (this.channelSync) {
        try {
          await this.channelSync.saveToAll(channel);
        } catch (error) {
          // Log Firestore save failure but don't fail registration
          // Channel is still in memory and can be used
          logger.warn('Failed to save channel to Firestore - channel only in memory', {
            operation: 'registerChannel',
            context: {
              channelId: channel.channelId,
              calendarId,
              error: error instanceof Error ? error.message : String(error),
            },
          });

          // Fallback: at least save to registry
          this.channelRegistry.register(channel);
        }
      } else {
        // No ChannelSync available, use registry only (backward compatibility)
        this.channelRegistry.register(channel);
      }

      const duration = Date.now() - startTime;

      logger.info('Watch channel registered successfully', {
        operation: 'registerChannel',
        duration,
        context: {
          calendarId,
          channelId: channel.channelId,
          resourceId: channel.resourceId,
          expiration: new Date(channel.expiration).toISOString(),
          persisted: this.channelSync !== null,
        },
      });

      return channel;
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      logger.error('Failed to register watch channel', {
        operation: 'registerChannel',
        duration,
        error: {
          message: err.message,
          stack: err.stack,
        },
        context: {
          calendarId,
          channelId,
        },
      });

      throw error;
    }
  }

  /**
   * Stop a watch channel
   */
  async stopChannel(channelId: string): Promise<void> {
    const channel = this.channelRegistry.get(channelId);

    if (!channel) {
      logger.warn('Attempted to stop unknown channel', {
        operation: 'stopChannel',
        context: { channelId },
      });
      return;
    }

    try {
      await withRetry(() =>
        this.calendarClient.stopWatchChannel(channel.channelId, channel.resourceId)
      );

      this.channelRegistry.unregister(channelId);

      logger.info('Watch channel stopped', {
        operation: 'stopChannel',
        context: {
          channelId,
          calendarId: channel.calendarId,
        },
      });
    } catch (error) {
      const err = error as Error;

      logger.error('Failed to stop watch channel', {
        operation: 'stopChannel',
        error: {
          message: err.message,
          stack: err.stack,
        },
        context: {
          channelId,
          calendarId: channel.calendarId,
        },
      });

      throw error;
    }
  }

  /**
   * Stop all registered watch channels
   */
  async stopAllChannels(): Promise<void> {
    const channels = this.channelRegistry.getAll();

    logger.info('Stopping all watch channels', {
      operation: 'stopAllChannels',
      context: {
        channelCount: channels.length,
      },
    });

    await Promise.allSettled(
      channels.map((channel) => this.stopChannel(channel.channelId))
    );
  }

  /**
   * Renew channels that are expiring soon
   */
  async renewExpiringChannels(): Promise<void> {
    const startTime = Date.now();
    const expiring = this.channelRegistry.getExpiringSoon(this.renewalThresholdMs);

    if (expiring.length === 0) {
      logger.debug('No expiring channels to renew', {
        operation: 'renewExpiringChannels',
      });
      return;
    }

    logger.info('Renewing expiring watch channels', {
      operation: 'renewExpiringChannels',
      context: {
        expiringCount: expiring.length,
        channels: expiring.map((ch) => ({
          channelId: ch.channelId,
          calendarId: ch.calendarId,
          expiration: new Date(ch.expiration).toISOString(),
        })),
      },
    });

    for (const channel of expiring) {
      try {
        // Stop old channel
        await this.stopChannel(channel.channelId);

        // Register new channel
        await this.registerChannel(channel.calendarId);

        logger.info('Channel renewed successfully', {
          operation: 'renewExpiringChannels',
          context: {
            oldChannelId: channel.channelId,
            calendarId: channel.calendarId,
          },
        });
      } catch (error) {
        logger.error('Failed to renew channel', {
          operation: 'renewExpiringChannels',
          error: {
            message: (error as Error).message,
          },
          context: {
            channelId: channel.channelId,
            calendarId: channel.calendarId,
          },
        });
        // Continue with other channels
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Channel renewal complete', {
      operation: 'renewExpiringChannels',
      duration,
      context: {
        processedCount: expiring.length,
      },
    });
  }
}
