import { ChannelRegistry, WatchChannel } from './channel-registry.js';
import { ChannelStore } from './channel-store.js';
import { WatchChannelDocument } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Synchronizes ChannelRegistry (in-memory) with ChannelStore (Firestore)
 * Ensures consistent state between memory and persistent storage
 */
export class ChannelSync {
  constructor(
    private readonly registry: ChannelRegistry,
    private readonly store: ChannelStore
  ) {}

  /**
   * Load channels from Firestore into in-memory registry
   * Called during service startup to restore state
   *
   * @param detectExpired - If true, detect and log expired channels
   * @returns Object with loaded and expired channel counts
   */
  async loadFromFirestore(detectExpired = true): Promise<{
    loaded: number;
    expired: number;
    needsRenewal: string[];
  }> {
    const startTime = Date.now();

    try {
      // Load all active channels from Firestore
      const channels = await this.store.loadAllChannels();

      const now = Date.now();
      let loadedCount = 0;
      let expiredCount = 0;
      const needsRenewal: string[] = [];

      for (const doc of channels) {
        // Check if channel is expired
        if (detectExpired && doc.expiration < now) {
          expiredCount++;
          needsRenewal.push(doc.channelId);

          logger.warn('Expired channel detected during load', {
            operation: 'ChannelSync.loadFromFirestore',
            context: {
              channelId: doc.channelId,
              calendarId: doc.calendarId,
              expiration: new Date(doc.expiration).toISOString(),
              expiredMs: now - doc.expiration,
            },
          });

          continue; // Don't load expired channels into registry
        }

        // Convert Firestore document to ChannelRegistry format
        const channel: WatchChannel = {
          channelId: doc.channelId,
          resourceId: doc.resourceId,
          calendarId: doc.calendarId,
          expiration: doc.expiration,
        };

        this.registry.register(channel);
        loadedCount++;
      }

      const duration = Date.now() - startTime;

      logger.info('Channels loaded from Firestore to registry', {
        operation: 'ChannelSync.loadFromFirestore',
        context: {
          total: channels.length,
          loaded: loadedCount,
          expired: expiredCount,
          needsRenewal: needsRenewal.length,
          duration,
        },
      });

      return {
        loaded: loadedCount,
        expired: expiredCount,
        needsRenewal,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to load channels from Firestore', {
        operation: 'ChannelSync.loadFromFirestore',
        context: {
          error: error instanceof Error ? error.message : String(error),
          duration,
        },
      });

      throw error;
    }
  }

  /**
   * Save channel to both registry and Firestore
   * Ensures consistent state across memory and persistent storage
   *
   * @param channel - Watch channel to save
   */
  async saveToAll(channel: WatchChannel): Promise<void> {
    const startTime = Date.now();

    try {
      // Convert ChannelRegistry format to Firestore document
      const doc: WatchChannelDocument = {
        channelId: channel.channelId,
        resourceId: channel.resourceId,
        calendarId: channel.calendarId,
        expiration: channel.expiration,
        registeredAt: Date.now(),
        lastUpdatedAt: Date.now(),
        status: 'active',
      };

      // Save to Firestore first (source of truth)
      await this.store.saveChannel(doc);

      // Then update in-memory registry
      this.registry.register(channel);

      const duration = Date.now() - startTime;

      logger.info('Channel saved to both Firestore and registry', {
        operation: 'ChannelSync.saveToAll',
        context: {
          channelId: channel.channelId,
          calendarId: channel.calendarId,
          duration,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to save channel to Firestore and registry', {
        operation: 'ChannelSync.saveToAll',
        context: {
          channelId: channel.channelId,
          calendarId: channel.calendarId,
          error: error instanceof Error ? error.message : String(error),
          duration,
        },
      });

      throw error;
    }
  }

  /**
   * Remove channel from both registry and Firestore
   *
   * @param channelId - Channel ID to remove
   */
  async removeFromAll(channelId: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Remove from Firestore first
      await this.store.stopChannel(channelId);

      // Then remove from in-memory registry
      this.registry.unregister(channelId);

      const duration = Date.now() - startTime;

      logger.info('Channel removed from both Firestore and registry', {
        operation: 'ChannelSync.removeFromAll',
        context: {
          channelId,
          duration,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to remove channel from Firestore and registry', {
        operation: 'ChannelSync.removeFromAll',
        context: {
          channelId,
          error: error instanceof Error ? error.message : String(error),
          duration,
        },
      });

      throw error;
    }
  }

  /**
   * Update channel expiration in both registry and Firestore
   * Used during renewal operations
   *
   * @param channelId - Channel ID to update
   * @param newExpiration - New expiration timestamp
   */
  async updateExpiration(channelId: string, newExpiration: number): Promise<void> {
    const startTime = Date.now();

    try {
      // Update in Firestore first
      await this.store.updateExpiration(channelId, newExpiration);

      // Update in-memory registry
      const channel = this.registry.get(channelId);
      if (channel) {
        channel.expiration = newExpiration;
        this.registry.register(channel); // Re-register with updated expiration
      }

      const duration = Date.now() - startTime;

      logger.info('Channel expiration updated in both Firestore and registry', {
        operation: 'ChannelSync.updateExpiration',
        context: {
          channelId,
          newExpiration: new Date(newExpiration).toISOString(),
          duration,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to update channel expiration', {
        operation: 'ChannelSync.updateExpiration',
        context: {
          channelId,
          error: error instanceof Error ? error.message : String(error),
          duration,
        },
      });

      throw error;
    }
  }

  /**
   * Sync registry to Firestore (write all in-memory channels to Firestore)
   * Used during migration or manual sync operations
   */
  async syncToFirestore(): Promise<{ synced: number; failed: number }> {
    const startTime = Date.now();

    try {
      const channels = this.registry.getAll();
      let synced = 0;
      let failed = 0;

      for (const channel of channels) {
        try {
          const doc: WatchChannelDocument = {
            channelId: channel.channelId,
            resourceId: channel.resourceId,
            calendarId: channel.calendarId,
            expiration: channel.expiration,
            registeredAt: Date.now(),
            lastUpdatedAt: Date.now(),
            status: 'active',
          };

          await this.store.saveChannel(doc);
          synced++;
        } catch (error) {
          failed++;

          logger.error('Failed to sync channel to Firestore', {
            operation: 'ChannelSync.syncToFirestore',
            context: {
              channelId: channel.channelId,
              calendarId: channel.calendarId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Registry synced to Firestore', {
        operation: 'ChannelSync.syncToFirestore',
        context: {
          total: channels.length,
          synced,
          failed,
          duration,
        },
      });

      return { synced, failed };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to sync registry to Firestore', {
        operation: 'ChannelSync.syncToFirestore',
        context: {
          error: error instanceof Error ? error.message : String(error),
          duration,
        },
      });

      throw error;
    }
  }
}
