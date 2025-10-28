import { UserMapping } from '../config/types.js';
import { logger } from '../utils/logger.js';

/**
 * Metadata about the current state of the mapping cache
 */
export interface MappingCacheMetadata {
  lastLoadedAt: number | null; // Timestamp when mappings were last successfully loaded
  loadErrors: number; // Count of consecutive load failures
  mappingCount: number; // Number of active mappings in the store
}

/**
 * In-memory store for user mappings from primary to secondary workspace users
 * Loaded from Google Spreadsheet and periodically refreshed
 */
export class UserMappingStore {
  private mappings: Map<string, string[]>; // Primary email → Secondary emails
  private metadata: MappingCacheMetadata;

  constructor() {
    this.mappings = new Map();
    this.metadata = {
      lastLoadedAt: null,
      loadErrors: 0,
      mappingCount: 0,
    };
  }

  /**
   * Load mappings into the store from an array of UserMapping objects
   * Replaces existing mappings entirely (full refresh)
   * @param userMappings Array of user mappings to load
   */
  load(userMappings: UserMapping[]): void {
    const startTime = Date.now();

    // Clear existing mappings
    this.mappings.clear();

    // Load new mappings
    for (const mapping of userMappings) {
      this.mappings.set(mapping.primary, mapping.secondaries);
    }

    // Update metadata
    this.metadata.lastLoadedAt = startTime;
    this.metadata.loadErrors = 0; // Reset error count on success
    this.metadata.mappingCount = this.mappings.size;

    const duration = Date.now() - startTime;

    logger.info('User mappings loaded into store', {
      operation: 'UserMappingStore.load',
      duration,
      context: {
        mappingCount: this.metadata.mappingCount,
        primaryUsers: Array.from(this.mappings.keys()),
      },
    });
  }

  /**
   * Record a load failure (increment error count)
   * Used when Spreadsheet loading fails to track reliability
   */
  recordLoadFailure(): void {
    this.metadata.loadErrors++;

    logger.warn('User mapping load failure recorded', {
      operation: 'UserMappingStore.recordLoadFailure',
      context: {
        consecutiveErrors: this.metadata.loadErrors,
      },
    });
  }

  /**
   * Get secondary workspace emails for a primary workspace user
   * @param primaryEmail Primary workspace email address
   * @returns Array of secondary emails, or undefined if no mapping exists
   */
  getSecondaries(primaryEmail: string): string[] | undefined {
    return this.mappings.get(primaryEmail);
  }

  /**
   * Check if a user has a primary workspace mapping
   * @param email Email address to check
   * @returns True if email exists as a primary user in mappings
   */
  hasPrimaryUser(email: string): boolean {
    return this.mappings.has(email);
  }

  /**
   * Get all primary workspace user emails
   * @returns Array of all primary user emails
   */
  getAllPrimaries(): string[] {
    return Array.from(this.mappings.keys());
  }

  /**
   * Get cache metadata (for monitoring and health checks)
   * @returns Current cache metadata
   */
  getMetadata(): Readonly<MappingCacheMetadata> {
    return { ...this.metadata };
  }

  /**
   * Get total number of mappings
   * @returns Count of primary users with mappings
   */
  size(): number {
    return this.mappings.size;
  }

  /**
   * Check if store is empty (no mappings loaded)
   * @returns True if no mappings are loaded
   */
  isEmpty(): boolean {
    return this.mappings.size === 0;
  }
}
