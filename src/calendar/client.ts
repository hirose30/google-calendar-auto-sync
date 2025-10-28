import { google, calendar_v3 } from 'googleapis';
import { ServiceAccountConfig } from '../config/types.js';
import { createJWTClient } from '../config/loader.js';
import { logger } from '../utils/logger.js';

/**
 * Google Calendar API client wrapper
 * Handles authentication via service account with domain-wide delegation
 */
export class CalendarClient {
  private serviceAccount: ServiceAccountConfig;

  constructor(serviceAccount: ServiceAccountConfig) {
    this.serviceAccount = serviceAccount;
  }

  /**
   * Get Calendar API client for a specific user
   * Uses domain-wide delegation to impersonate the user
   * @param userEmail Email of user to impersonate
   * @returns Calendar API client
   */
  getClientForUser(userEmail: string): calendar_v3.Calendar {
    const auth = createJWTClient(
      this.serviceAccount,
      userEmail,
      ['https://www.googleapis.com/auth/calendar']
    );

    return google.calendar({ version: 'v3', auth });
  }

  /**
   * Register a push notification watch channel for a calendar
   * @param calendarId Calendar ID (usually user's email)
   * @param channelId Unique ID for this watch channel
   * @param webhookUrl HTTPS URL to receive notifications
   * @param token Optional verification token
   * @returns Watch channel response
   */
  async registerWatchChannel(
    calendarId: string,
    channelId: string,
    webhookUrl: string,
    token?: string
  ): Promise<calendar_v3.Schema$Channel> {
    const calendar = this.getClientForUser(calendarId);

    try {
      const response = await calendar.events.watch({
        calendarId,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: webhookUrl,
          ...(token && { token }),
        },
      });

      logger.info('Watch channel registered', {
        operation: 'registerWatchChannel',
        calendarId,
        context: {
          channelId,
          resourceId: response.data.resourceId,
          expiration: response.data.expiration,
        },
      });

      return response.data;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to register watch channel', {
        operation: 'registerWatchChannel',
        calendarId,
        error: {
          message: err.message,
          stack: err.stack,
        },
      });
      throw error;
    }
  }

  /**
   * Stop a push notification watch channel
   * @param channelId Channel ID
   * @param resourceId Resource ID from watch registration
   */
  async stopWatchChannel(channelId: string, resourceId: string): Promise<void> {
    // Note: channels.stop() doesn't require user impersonation
    const auth = createJWTClient(
      this.serviceAccount,
      undefined,
      ['https://www.googleapis.com/auth/calendar']
    );
    const calendar = google.calendar({ version: 'v3', auth });

    try {
      await calendar.channels.stop({
        requestBody: {
          id: channelId,
          resourceId,
        },
      });

      logger.info('Watch channel stopped', {
        operation: 'stopWatchChannel',
        context: {
          channelId,
          resourceId,
        },
      });
    } catch (error) {
      const err = error as Error;
      logger.warn('Failed to stop watch channel (may have already expired)', {
        operation: 'stopWatchChannel',
        error: {
          message: err.message,
        },
        context: {
          channelId,
          resourceId,
        },
      });
      // Don't throw - channel may have already expired
    }
  }

  /**
   * List events updated since a given timestamp
   * @param calendarId Calendar ID
   * @param updatedMin RFC 3339 timestamp (events updated after this time)
   * @param maxResults Maximum number of events to return
   * @returns List of events
   */
  async listRecentEvents(
    calendarId: string,
    updatedMin: string,
    maxResults: number = 100
  ): Promise<calendar_v3.Schema$Event[]> {
    const calendar = this.getClientForUser(calendarId);

    try {
      const response = await calendar.events.list({
        calendarId,
        updatedMin,
        singleEvents: true,
        maxResults,
      });

      logger.debug('Listed recent events', {
        operation: 'listRecentEvents',
        calendarId,
        context: {
          eventCount: response.data.items?.length || 0,
          updatedMin,
        },
      });

      return response.data.items || [];
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to list recent events', {
        operation: 'listRecentEvents',
        calendarId,
        error: {
          message: err.message,
          stack: err.stack,
        },
      });
      throw error;
    }
  }

  /**
   * Get a specific event by ID
   * @param calendarId Calendar ID
   * @param eventId Event ID
   * @returns Event details
   */
  async getEvent(
    calendarId: string,
    eventId: string
  ): Promise<calendar_v3.Schema$Event> {
    const calendar = this.getClientForUser(calendarId);

    try {
      const response = await calendar.events.get({
        calendarId,
        eventId,
      });

      logger.debug('Retrieved event', {
        operation: 'getEvent',
        calendarId,
        eventId,
      });

      return response.data;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to get event', {
        operation: 'getEvent',
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
   * Update event attendees
   * @param calendarId Calendar ID
   * @param eventId Event ID
   * @param attendees Updated list of attendees
   * @param sendUpdates Whether to send email notifications ('all' | 'externalOnly' | 'none')
   * @returns Updated event
   */
  async updateEventAttendees(
    calendarId: string,
    eventId: string,
    attendees: calendar_v3.Schema$EventAttendee[],
    sendUpdates: 'all' | 'externalOnly' | 'none' = 'all'
  ): Promise<calendar_v3.Schema$Event> {
    const calendar = this.getClientForUser(calendarId);

    try {
      const response = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: {
          attendees,
        },
        sendUpdates,
      });

      logger.info('Updated event attendees', {
        operation: 'updateEventAttendees',
        calendarId,
        eventId,
        context: {
          attendeeCount: attendees.length,
          sendUpdates,
        },
      });

      return response.data;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update event attendees', {
        operation: 'updateEventAttendees',
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
}
