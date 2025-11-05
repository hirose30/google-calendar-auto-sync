import { Request, Response } from 'express';
import { CalendarSyncService } from '../calendar/sync.js';
import { ChannelRegistry } from '../state/channel-registry.js';
import { UserMappingStore } from '../state/mapping-store.js';
import { DeduplicationCache } from '../state/dedup-cache.js';
import { parseWebhookHeaders, isSyncMessage, isChangeNotification } from './validator.js';
import { logger } from '../utils/logger.js';

/**
 * Check if event ID represents a recurring event instance
 * Format: baseEventId_instanceDateTime (e.g., "abc123_20251115T100000Z")
 */
function isRecurringInstance(eventId: string): boolean {
  return eventId.includes('_');
}

/**
 * Extract base event ID from recurring instance ID
 * Input: "abc123_20251115T100000Z"
 * Output: "abc123"
 */
function extractBaseEventId(instanceId: string): string {
  return instanceId.split('_')[0];
}

/**
 * Handle Google Calendar webhook notifications
 */
export class WebhookHandler {
  private syncService: CalendarSyncService;
  private channelRegistry: ChannelRegistry;
  private mappingStore: UserMappingStore;
  private dedupCache: DeduplicationCache;

  constructor(
    syncService: CalendarSyncService,
    channelRegistry: ChannelRegistry,
    mappingStore: UserMappingStore,
    dedupCache: DeduplicationCache
  ) {
    this.syncService = syncService;
    this.channelRegistry = channelRegistry;
    this.mappingStore = mappingStore;
    this.dedupCache = dedupCache;
  }

  /**
   * Handle incoming webhook notification
   */
  async handle(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // Parse webhook headers
      const headers = parseWebhookHeaders(req);

      if (!headers) {
        logger.warn('Invalid webhook request - missing headers', {
          operation: 'WebhookHandler.handle',
        });
        res.status(400).json({ error: 'Missing required headers' });
        return;
      }

      logger.info('Webhook notification received', {
        operation: 'WebhookHandler.handle',
        context: {
          channelId: headers.channelId,
          resourceState: headers.resourceState,
          resourceId: headers.resourceId,
          messageNumber: headers.messageNumber,
        },
      });

      // Verify channel is registered
      const channel = this.channelRegistry.get(headers.channelId);

      if (!channel) {
        logger.warn('Webhook for unknown channel', {
          operation: 'WebhookHandler.handle',
          context: {
            channelId: headers.channelId,
          },
        });
        res.status(404).json({ error: 'Unknown channel' });
        return;
      }

      // Handle sync message (immediate response after watch registration)
      if (isSyncMessage(headers.resourceState)) {
        logger.debug('Sync message received, acknowledging', {
          operation: 'WebhookHandler.handle',
          context: {
            channelId: headers.channelId,
          },
        });
        res.status(200).json({ status: 'ok', message: 'Sync acknowledged' });
        return;
      }

      // Handle change notification
      if (isChangeNotification(headers.resourceState)) {
        // Acknowledge immediately (Google expects quick response)
        res.status(200).json({ status: 'ok', message: 'Processing' });

        // Process changes asynchronously
        this.processCalendarChanges(channel.calendarId, headers.channelId).catch(
          (error) => {
            logger.error('Failed to process calendar changes', {
              operation: 'WebhookHandler.handle',
              error: {
                message: (error as Error).message,
                stack: (error as Error).stack,
              },
              context: {
                calendarId: channel.calendarId,
                channelId: headers.channelId,
              },
            });
          }
        );

        const duration = Date.now() - startTime;
        logger.info('Webhook acknowledged, processing in background', {
          operation: 'WebhookHandler.handle',
          duration,
          context: {
            channelId: headers.channelId,
            calendarId: channel.calendarId,
          },
        });
        return;
      }

      // Unknown resource state
      logger.warn('Unknown resource state', {
        operation: 'WebhookHandler.handle',
        context: {
          resourceState: headers.resourceState,
          channelId: headers.channelId,
        },
      });
      res.status(200).json({ status: 'ok', message: 'Ignored' });
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      logger.error('Webhook handling failed', {
        operation: 'WebhookHandler.handle',
        duration,
        error: {
          message: err.message,
          stack: err.stack,
        },
      });

      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Process calendar changes by fetching recent events and syncing
   */
  private async processCalendarChanges(
    calendarId: string,
    channelId: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if this calendar owner has mappings
      if (!this.mappingStore.hasPrimaryUser(calendarId)) {
        logger.debug('Calendar owner has no mappings, skipping', {
          operation: 'processCalendarChanges',
          context: {
            calendarId,
          },
        });
        return;
      }

      // Fetch recent events (last 1 hour)
      const updatedMin = new Date(Date.now() - 3600000).toISOString();
      const events = await this.syncService['calendarClient'].listRecentEvents(
        calendarId,
        updatedMin,
        200
      );

      logger.info('Fetched recent events for processing', {
        operation: 'processCalendarChanges',
        context: {
          calendarId,
          eventCount: events.length,
        },
      });

      // Sync each event
      for (const event of events) {
        if (!event.id) continue;

        // Detect if this is a recurring event instance
        if (isRecurringInstance(event.id)) {
          // Recurring instance → sync parent event instead
          const baseId = extractBaseEventId(event.id);

          logger.info('Recurring instance detected', {
            operation: 'detectRecurringInstance',
            instanceId: event.id,
            baseEventId: baseId,
            calendarId,
          });

          // Check deduplication with base ID (not instance ID)
          if (this.dedupCache.isDuplicate(calendarId, baseId)) {
            logger.debug('Parent event already processing, skipping', {
              operation: 'processCalendarChanges',
              baseEventId: baseId,
              instanceId: event.id,
              calendarId,
            });
            continue;
          }

          // Mark base ID as processing
          this.dedupCache.markProcessing(calendarId, baseId);

          try {
            await this.syncService.syncRecurringParentEvent(calendarId, baseId);
          } catch (error) {
            logger.error('Failed to sync recurring parent event', {
              operation: 'processCalendarChanges',
              error: {
                message: (error as Error).message,
              },
              context: {
                calendarId,
                baseEventId: baseId,
                instanceId: event.id,
              },
            });
            // Continue processing other events
          }
        } else {
          // Single event → existing flow (unchanged)
          // Check deduplication cache to prevent concurrent processing
          if (this.dedupCache.isDuplicate(calendarId, event.id)) {
            logger.debug('Skipping duplicate event sync (already in progress)', {
              operation: 'processCalendarChanges',
              context: {
                calendarId,
                eventId: event.id,
              },
            });
            continue; // Skip this event
          }

          // Mark as processing BEFORE starting sync
          this.dedupCache.markProcessing(calendarId, event.id);

          try {
            await this.syncService.syncEvent(calendarId, event.id);
          } catch (error) {
            logger.error('Failed to sync event', {
              operation: 'processCalendarChanges',
              error: {
                message: (error as Error).message,
              },
              context: {
                calendarId,
                eventId: event.id,
              },
            });
            // Continue processing other events
          }
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Calendar changes processed', {
        operation: 'processCalendarChanges',
        duration,
        context: {
          calendarId,
          channelId,
          eventsProcessed: events.length,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      logger.error('Failed to process calendar changes', {
        operation: 'processCalendarChanges',
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
}
