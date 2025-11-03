import { calendar_v3 } from 'googleapis';
import { CalendarClient } from './client.js';
import { UserMappingStore } from '../state/mapping-store.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

/**
 * Result of syncing secondary attendees to a calendar event
 */
export interface SyncResult {
  eventId: string;
  calendarId: string;
  addedAttendees: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Core synchronization logic for adding secondary workspace attendees
 * to calendar events when primary workspace users are invited
 */
export class CalendarSyncService {
  private calendarClient: CalendarClient;
  private mappingStore: UserMappingStore;

  constructor(calendarClient: CalendarClient, mappingStore: UserMappingStore) {
    this.calendarClient = calendarClient;
    this.mappingStore = mappingStore;
  }

  /**
   * Synchronize secondary attendees for a specific event
   * @param calendarId Calendar ID (primary user's calendar)
   * @param eventId Event ID to sync
   * @returns Sync result with added attendees
   */
  async syncEvent(calendarId: string, eventId: string): Promise<SyncResult> {
    const startTime = Date.now();

    try {
      logger.info('Starting event sync', {
        operation: 'syncEvent',
        calendarId,
        eventId,
      });

      // 1. Fetch event details
      const event = await withRetry(() =>
        this.calendarClient.getEvent(calendarId, eventId)
      );

      // 2. Skip cancelled events
      if (event.status === 'cancelled') {
        const duration = Date.now() - startTime;
        logger.info('Event cancelled, skipping sync', {
          operation: 'syncEvent',
          duration,
          calendarId,
          eventId,
        });

        return {
          eventId,
          calendarId,
          addedAttendees: [],
          skipped: true,
          skipReason: 'Event cancelled',
        };
      }

      // 3. Get current attendees
      const currentAttendees = event.attendees || [];

      // 4. Find primary workspace attendees with mappings
      // Check both: attendees list AND calendar owner (for events without guests)
      const primaryAttendees = currentAttendees.filter(
        (attendee) =>
          attendee.email && this.mappingStore.hasPrimaryUser(attendee.email)
      );

      // If no primary attendees in guest list, check if calendar owner is a primary user
      const isCalendarOwnerPrimary = this.mappingStore.hasPrimaryUser(calendarId);

      if (primaryAttendees.length === 0 && !isCalendarOwnerPrimary) {
        const duration = Date.now() - startTime;
        logger.debug('No mapped primary attendees found, skipping sync', {
          operation: 'syncEvent',
          duration,
          calendarId,
          eventId,
          context: {
            attendeeEmails: currentAttendees.map((a) => a.email),
            calendarOwner: calendarId,
          },
        });

        return {
          eventId,
          calendarId,
          addedAttendees: [],
          skipped: true,
          skipReason: 'No mapped primary attendees',
        };
      }

      // If calendar owner is primary but not in attendees, add them to primaryAttendees list
      if (isCalendarOwnerPrimary && primaryAttendees.length === 0) {
        primaryAttendees.push({ email: calendarId });
        logger.debug('Calendar owner is primary user, will add secondary accounts', {
          operation: 'syncEvent',
          calendarId,
          eventId,
          context: {
            calendarOwner: calendarId,
          },
        });
      }

      // 5. Collect secondary emails to add (one-to-many support)
      const secondariesToAdd = this.resolveSecondariesToAdd(
        primaryAttendees,
        currentAttendees
      );

      if (secondariesToAdd.length === 0) {
        const duration = Date.now() - startTime;
        logger.info('All secondary attendees already present', {
          operation: 'syncEvent',
          duration,
          calendarId,
          eventId,
          context: {
            primaryAttendees: primaryAttendees.map((a) => a.email),
          },
        });

        return {
          eventId,
          calendarId,
          addedAttendees: [],
          skipped: true,
          skipReason: 'All secondaries already present',
        };
      }

      // 6. Add secondary attendees with retry
      const newAttendees = [
        ...currentAttendees,
        ...secondariesToAdd.map((email) => ({
          email,
          responseStatus: 'needsAction' as const,
        })),
      ];

      await withRetry(() =>
        this.calendarClient.updateEventAttendees(
          calendarId,
          eventId,
          newAttendees,
          'all' // Send email notifications to new attendees
        )
      );

      const duration = Date.now() - startTime;

      logger.info('Event synced successfully', {
        operation: 'syncEvent',
        duration,
        calendarId,
        eventId,
        context: {
          addedAttendees: secondariesToAdd,
          primaryAttendees: primaryAttendees.map((a) => a.email),
        },
      });

      return {
        eventId,
        calendarId,
        addedAttendees: secondariesToAdd,
        skipped: false,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      logger.error('Event sync failed', {
        operation: 'syncEvent',
        duration,
        calendarId,
        eventId,
        error: {
          message: err.message,
          stack: err.stack,
        },
      });

      throw error;
    }
  }

  /**
   * Sync recurring parent event by adding secondary workspace attendees
   * This updates ALL instances at once (Google Calendar handles propagation)
   *
   * @param calendarId Calendar ID (primary user's calendar)
   * @param baseEventId Base event ID (without instance suffix)
   * @returns Sync result with added attendees
   */
  async syncRecurringParentEvent(
    calendarId: string,
    baseEventId: string
  ): Promise<SyncResult> {
    const startTime = Date.now();

    try {
      logger.info('Fetching recurring parent event', {
        operation: 'syncRecurringParentEvent',
        baseEventId,
        calendarId,
      });

      // Fetch parent event using base ID
      const parentEvent = await withRetry(() =>
        this.calendarClient.getEvent(calendarId, baseEventId)
      );

      // Check if parent has been cancelled
      if (parentEvent.status === 'cancelled') {
        const duration = Date.now() - startTime;
        logger.info('Parent event cancelled, skipping sync', {
          operation: 'syncRecurringParentEvent',
          baseEventId,
          calendarId,
          duration,
        });

        return {
          eventId: baseEventId,
          calendarId,
          addedAttendees: [],
          skipped: true,
          skipReason: 'Parent event cancelled',
        };
      }

      // Get primary workspace attendees
      const currentAttendees = parentEvent.attendees || [];

      // Find primary workspace attendees with mappings
      const primaryAttendees = currentAttendees.filter(
        (attendee) =>
          attendee.email && this.mappingStore.hasPrimaryUser(attendee.email)
      );

      // If no primary attendees in guest list, check if calendar owner is a primary user
      const isCalendarOwnerPrimary = this.mappingStore.hasPrimaryUser(calendarId);

      if (primaryAttendees.length === 0 && !isCalendarOwnerPrimary) {
        const duration = Date.now() - startTime;
        logger.debug('No mapped primary attendees found, skipping sync', {
          operation: 'syncRecurringParentEvent',
          duration,
          calendarId,
          baseEventId,
          context: {
            attendeeEmails: currentAttendees.map((a) => a.email),
            calendarOwner: calendarId,
          },
        });

        return {
          eventId: baseEventId,
          calendarId,
          addedAttendees: [],
          skipped: true,
          skipReason: 'No mapped primary attendees',
        };
      }

      // If calendar owner is primary but not in attendees, add them to primaryAttendees list
      if (isCalendarOwnerPrimary && primaryAttendees.length === 0) {
        primaryAttendees.push({ email: calendarId });
        logger.debug('Calendar owner is primary user, will add secondary accounts', {
          operation: 'syncRecurringParentEvent',
          calendarId,
          baseEventId,
          context: {
            calendarOwner: calendarId,
          },
        });
      }

      const primaryEmails = primaryAttendees.map((a) => a.email).filter((e): e is string => !!e);

      // Find secondary workspace mappings
      const secondariesToAdd = this.resolveSecondariesToAdd(
        primaryAttendees,
        currentAttendees // Current = all attendees for deduplication check
      );

      if (secondariesToAdd.length === 0) {
        const duration = Date.now() - startTime;
        logger.debug('No secondary workspace attendees to add', {
          operation: 'syncRecurringParentEvent',
          baseEventId,
          calendarId,
          duration,
          context: {
            primaryEmails,
          },
        });

        return {
          eventId: baseEventId,
          calendarId,
          addedAttendees: [],
          skipped: true,
          skipReason: 'All secondaries already present',
        };
      }

      // Merge attendees (add missing secondary emails)
      const mergedAttendees = [
        ...primaryAttendees,
        ...secondariesToAdd.map((email) => ({
          email,
          responseStatus: 'needsAction' as const,
        })),
      ];

      // Update parent event with retry
      await withRetry(() =>
        this.calendarClient.updateEventAttendees(
          calendarId,
          baseEventId,
          mergedAttendees,
          'all' // Send email notifications to new attendees
        )
      );

      const duration = Date.now() - startTime;

      logger.info('Parent event synced successfully', {
        operation: 'syncRecurringParentEvent',
        baseEventId,
        calendarId,
        duration,
        context: {
          addedAttendees: secondariesToAdd,
          primaryAttendees: primaryEmails,
        },
      });

      return {
        eventId: baseEventId,
        calendarId,
        addedAttendees: secondariesToAdd,
        skipped: false,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      logger.error('Failed to sync recurring parent event', {
        operation: 'syncRecurringParentEvent',
        baseEventId,
        calendarId,
        duration,
        error: {
          message: err.message,
          stack: err.stack,
        },
      });

      throw error;
    }
  }

  /**
   * Resolve which secondary emails need to be added to the event
   * Supports one-to-many mappings (one primary → multiple secondaries)
   * Ensures uniqueness (no duplicate attendees)
   *
   * @param primaryAttendees Primary workspace attendees with mappings
   * @param currentAttendees Current event attendees
   * @returns Array of secondary emails to add
   */
  private resolveSecondariesToAdd(
    primaryAttendees: calendar_v3.Schema$EventAttendee[],
    currentAttendees: calendar_v3.Schema$EventAttendee[]
  ): string[] {
    const currentEmails = new Set(currentAttendees.map((a) => a.email));
    const secondariesToAdd = new Set<string>();

    for (const primaryAttendee of primaryAttendees) {
      if (!primaryAttendee.email) continue;

      const secondaries = this.mappingStore.getSecondaries(
        primaryAttendee.email
      );

      if (!secondaries) continue;

      // One-to-many support: Add all mapped secondaries
      for (const secondaryEmail of secondaries) {
        // Skip if already an attendee (prevent duplicates)
        if (!currentEmails.has(secondaryEmail)) {
          secondariesToAdd.add(secondaryEmail);
        }
      }
    }

    return Array.from(secondariesToAdd);
  }

  /**
   * Handle attendee removal synchronization
   * When a primary attendee is removed, remove corresponding secondaries
   *
   * @param calendarId Calendar ID
   * @param eventId Event ID
   * @param removedPrimaryEmail Email of removed primary attendee
   */
  async handleAttendeeRemoval(
    calendarId: string,
    eventId: string,
    removedPrimaryEmail: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('Handling attendee removal', {
        operation: 'handleAttendeeRemoval',
        calendarId,
        eventId,
        context: {
          removedPrimaryEmail,
        },
      });

      // Get secondary emails for removed primary
      const secondaries = this.mappingStore.getSecondaries(removedPrimaryEmail);

      if (!secondaries || secondaries.length === 0) {
        logger.debug('No secondaries to remove', {
          operation: 'handleAttendeeRemoval',
          calendarId,
          eventId,
        });
        return;
      }

      // Fetch current event
      const event = await withRetry(() =>
        this.calendarClient.getEvent(calendarId, eventId)
      );

      const currentAttendees = event.attendees || [];

      // Filter out secondary attendees
      const updatedAttendees = currentAttendees.filter(
        (attendee) => !secondaries.includes(attendee.email!)
      );

      // Update event if any secondaries were removed
      if (updatedAttendees.length < currentAttendees.length) {
        await withRetry(() =>
          this.calendarClient.updateEventAttendees(
            calendarId,
            eventId,
            updatedAttendees,
            'all'
          )
        );

        const removedCount = currentAttendees.length - updatedAttendees.length;
        const duration = Date.now() - startTime;

        logger.info('Secondary attendees removed', {
          operation: 'handleAttendeeRemoval',
          duration,
          calendarId,
          eventId,
          context: {
            removedPrimaryEmail,
            removedSecondaries: secondaries.filter((s) =>
              currentAttendees.some((a) => a.email === s)
            ),
            removedCount,
          },
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error as Error;

      logger.error('Failed to handle attendee removal', {
        operation: 'handleAttendeeRemoval',
        duration,
        calendarId,
        eventId,
        error: {
          message: err.message,
          stack: err.stack,
        },
        context: {
          removedPrimaryEmail,
        },
      });

      throw error;
    }
  }
}
