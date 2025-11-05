import { getFirestore } from './firestore-client.js';
import { WatchChannelDocument } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Firestore-backed storage for watch channel subscriptions
 * Provides CRUD operations and query capabilities
 */
export class ChannelStore {
  private readonly collectionName = 'watchChannels';

  /**
   * Save channel to Firestore (create or update)
   * Uses transaction for atomic create-or-update
   */
  async saveChannel(channel: WatchChannelDocument): Promise<void> {
    const startTime = Date.now();

    try {
      const db = getFirestore();
      const docRef = db.collection(this.collectionName).doc(channel.channelId);

      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (doc.exists) {
          // Channel exists, update expiration and timestamp
          transaction.update(docRef, {
            expiration: channel.expiration,
            resourceId: channel.resourceId,
            lastUpdatedAt: Date.now(),
            status: 'active',
          });

          logger.info('Watch channel updated in Firestore', {
            operation: 'ChannelStore.saveChannel',
            context: {
              channelId: channel.channelId,
              calendarId: channel.calendarId,
              action: 'update',
              duration: Date.now() - startTime,
            },
          });
        } else {
          // New channel, create document
          const newChannel: WatchChannelDocument = {
            ...channel,
            registeredAt: Date.now(),
            lastUpdatedAt: Date.now(),
            status: 'active',
          };

          transaction.set(docRef, newChannel);

          logger.info('Watch channel created in Firestore', {
            operation: 'ChannelStore.saveChannel',
            context: {
              channelId: channel.channelId,
              calendarId: channel.calendarId,
              action: 'create',
              duration: Date.now() - startTime,
            },
          });
        }
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to save channel to Firestore', {
        operation: 'ChannelStore.saveChannel',
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
   * Load all active channels from Firestore
   * Used during service startup to restore channel registry
   */
  async loadAllChannels(): Promise<WatchChannelDocument[]> {
    const startTime = Date.now();

    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(this.collectionName)
        .where('status', '==', 'active')
        .get();

      const channels = snapshot.docs.map((doc) => doc.data() as WatchChannelDocument);

      const duration = Date.now() - startTime;

      logger.info('Loaded channels from Firestore', {
        operation: 'ChannelStore.loadAllChannels',
        context: {
          count: channels.length,
          duration,
        },
      });

      return channels;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to load channels from Firestore', {
        operation: 'ChannelStore.loadAllChannels',
        context: {
          error: error instanceof Error ? error.message : String(error),
          duration,
        },
      });

      throw error;
    }
  }

  /**
   * Find channels expiring within the threshold
   * Used by renewal job to identify channels needing renewal
   */
  async findExpiringChannels(thresholdMs: number): Promise<WatchChannelDocument[]> {
    const startTime = Date.now();
    const expirationThreshold = Date.now() + thresholdMs;

    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(this.collectionName)
        .where('status', '==', 'active')
        .where('expiration', '<', expirationThreshold)
        .get();

      const channels = snapshot.docs.map((doc) => doc.data() as WatchChannelDocument);

      const duration = Date.now() - startTime;

      logger.info('Found expiring channels', {
        operation: 'ChannelStore.findExpiringChannels',
        context: {
          count: channels.length,
          thresholdMs,
          duration,
        },
      });

      return channels;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to find expiring channels', {
        operation: 'ChannelStore.findExpiringChannels',
        context: {
          error: error instanceof Error ? error.message : String(error),
          thresholdMs,
          duration,
        },
      });

      throw error;
    }
  }

  /**
   * Update channel expiration (for renewal)
   * Simple update without transaction overhead
   */
  async updateExpiration(channelId: string, newExpiration: number): Promise<void> {
    const startTime = Date.now();

    try {
      const db = getFirestore();
      await db
        .collection(this.collectionName)
        .doc(channelId)
        .update({
          expiration: newExpiration,
          lastUpdatedAt: Date.now(),
          status: 'active',
        });

      const duration = Date.now() - startTime;

      logger.info('Channel expiration updated', {
        operation: 'ChannelStore.updateExpiration',
        context: {
          channelId,
          newExpiration: new Date(newExpiration).toISOString(),
          duration,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to update channel expiration', {
        operation: 'ChannelStore.updateExpiration',
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
   * Stop channel and remove from Firestore
   * Used when channel is manually stopped or user removed
   */
  async stopChannel(channelId: string): Promise<void> {
    const startTime = Date.now();

    try {
      const db = getFirestore();
      await db.collection(this.collectionName).doc(channelId).delete();

      const duration = Date.now() - startTime;

      logger.info('Channel stopped and removed from Firestore', {
        operation: 'ChannelStore.stopChannel',
        context: {
          channelId,
          duration,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to stop channel', {
        operation: 'ChannelStore.stopChannel',
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
   * Get channel by ID
   * Used for status lookups and validation
   */
  async getChannel(channelId: string): Promise<WatchChannelDocument | null> {
    const startTime = Date.now();

    try {
      const db = getFirestore();
      const doc = await db.collection(this.collectionName).doc(channelId).get();

      const duration = Date.now() - startTime;

      if (!doc.exists) {
        logger.info('Channel not found in Firestore', {
          operation: 'ChannelStore.getChannel',
          context: {
            channelId,
            duration,
          },
        });

        return null;
      }

      const channel = doc.data() as WatchChannelDocument;

      logger.info('Channel retrieved from Firestore', {
        operation: 'ChannelStore.getChannel',
        context: {
          channelId,
          calendarId: channel.calendarId,
          duration,
        },
      });

      return channel;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to get channel', {
        operation: 'ChannelStore.getChannel',
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
   * Get all channels (for status dashboard)
   * Returns channels ordered by expiration
   */
  async getAllChannels(): Promise<WatchChannelDocument[]> {
    const startTime = Date.now();

    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(this.collectionName)
        .orderBy('expiration', 'asc')
        .get();

      const channels = snapshot.docs.map((doc) => doc.data() as WatchChannelDocument);

      const duration = Date.now() - startTime;

      logger.info('Retrieved all channels from Firestore', {
        operation: 'ChannelStore.getAllChannels',
        context: {
          count: channels.length,
          duration,
        },
      });

      return channels;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to get all channels', {
        operation: 'ChannelStore.getAllChannels',
        context: {
          error: error instanceof Error ? error.message : String(error),
          duration,
        },
      });

      throw error;
    }
  }
}
