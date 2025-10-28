import { logger } from '../utils/logger.js';

/**
 * Cache entry for deduplication
 */
interface DedupEntry {
  timestamp: number;
  eventId: string;
  calendarId: string;
}

/**
 * In-memory deduplication cache to prevent concurrent processing
 * of the same event from multiple webhook notifications
 */
export class DeduplicationCache {
  private cache: Map<string, DedupEntry>;
  private ttlMs: number;

  constructor(ttlMs: number = 300000) {
    // Default 5 minutes TTL
    this.cache = new Map();
    this.ttlMs = ttlMs;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Generate cache key for an event sync operation
   */
  private getCacheKey(calendarId: string, eventId: string): string {
    return `${calendarId}:${eventId}`;
  }

  /**
   * Check if event sync is already in progress or recently completed
   * Returns true if should skip (duplicate), false if should proceed
   */
  isDuplicate(calendarId: string, eventId: string): boolean {
    const key = this.getCacheKey(calendarId, eventId);
    const entry = this.cache.get(key);

    if (!entry) {
      return false; // Not in cache, not a duplicate
    }

    const age = Date.now() - entry.timestamp;

    if (age > this.ttlMs) {
      // Expired, remove and allow processing
      this.cache.delete(key);
      return false;
    }

    // Still valid, this is a duplicate
    logger.debug('Duplicate event sync detected, skipping', {
      operation: 'DeduplicationCache.isDuplicate',
      context: {
        calendarId,
        eventId,
        cacheAge: age,
        ttlMs: this.ttlMs,
      },
    });

    return true;
  }

  /**
   * Mark an event as being processed
   * Should be called before starting sync
   */
  markProcessing(calendarId: string, eventId: string): void {
    const key = this.getCacheKey(calendarId, eventId);

    this.cache.set(key, {
      timestamp: Date.now(),
      eventId,
      calendarId,
    });

    logger.debug('Event marked as processing in dedup cache', {
      operation: 'DeduplicationCache.markProcessing',
      context: {
        calendarId,
        eventId,
        cacheSize: this.cache.size,
      },
    });
  }

  /**
   * Remove expired cache entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Dedup cache cleanup completed', {
        operation: 'DeduplicationCache.cleanup',
        context: {
          removedEntries: removed,
          remainingEntries: this.cache.size,
        },
      });
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * Clear all cache entries (for testing)
   */
  clear(): void {
    this.cache.clear();
    logger.info('Dedup cache cleared', {
      operation: 'DeduplicationCache.clear',
    });
  }
}
