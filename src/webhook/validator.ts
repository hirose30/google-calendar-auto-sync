import { Request } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Google Calendar webhook notification headers
 */
export interface WebhookHeaders {
  channelId: string;
  resourceState: string;
  resourceId: string;
  resourceUri?: string;
  messageNumber?: string;
}

/**
 * Parse and validate Google Calendar webhook headers
 */
export function parseWebhookHeaders(req: Request): WebhookHeaders | null {
  const channelId = req.headers['x-goog-channel-id'] as string;
  const resourceState = req.headers['x-goog-resource-state'] as string;
  const resourceId = req.headers['x-goog-resource-id'] as string;
  const resourceUri = req.headers['x-goog-resource-uri'] as string;
  const messageNumber = req.headers['x-goog-message-number'] as string;

  // Required headers
  if (!channelId || !resourceState || !resourceId) {
    logger.warn('Missing required webhook headers', {
      operation: 'parseWebhookHeaders',
      context: {
        hasChannelId: !!channelId,
        hasResourceState: !!resourceState,
        hasResourceId: !!resourceId,
      },
    });
    return null;
  }

  return {
    channelId,
    resourceState,
    resourceId,
    resourceUri,
    messageNumber,
  };
}

/**
 * Check if webhook notification is a sync message
 * Google sends a sync message immediately after watch registration
 */
export function isSyncMessage(resourceState: string): boolean {
  return resourceState === 'sync';
}

/**
 * Check if webhook notification indicates a resource change
 */
export function isChangeNotification(resourceState: string): boolean {
  return resourceState === 'exists' || resourceState === 'update';
}
