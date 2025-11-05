import { Firestore } from '@google-cloud/firestore';
import { logger } from '../utils/logger.js';

/**
 * Singleton Firestore client with lazy initialization
 * Optimized for Cloud Run cold start performance
 */
class FirestoreClient {
  private static instance: Firestore | null = null;
  private static initStartTime: number | null = null;

  /**
   * Get Firestore instance (lazy initialization)
   * First call initializes connection, subsequent calls return cached instance
   */
  static getInstance(): Firestore {
    if (!FirestoreClient.instance) {
      FirestoreClient.initStartTime = Date.now();

      try {
        // Initialize Firestore with default settings
        // - Project ID: auto-detected from Cloud Run metadata
        // - Credentials: Application Default Credentials (ADC)
        // - Connection pooling: enabled by default
        FirestoreClient.instance = new Firestore({
          // Firestore settings can be configured here if needed
          // For now, rely on defaults which are optimal for Cloud Run
        });

        const initDuration = Date.now() - FirestoreClient.initStartTime;

        logger.info('Firestore client initialized', {
          operation: 'FirestoreClient.getInstance',
          context: {
            initDuration,
            projectId: process.env.GOOGLE_CLOUD_PROJECT || '(auto-detected)',
          },
        });
      } catch (error) {
        const initDuration = Date.now() - FirestoreClient.initStartTime;

        logger.error('Failed to initialize Firestore client', {
          operation: 'FirestoreClient.getInstance',
          context: {
            error: error instanceof Error ? error.message : String(error),
            initDuration,
          },
        });

        throw error;
      }
    }

    return FirestoreClient.instance;
  }

  /**
   * Reset instance (for testing purposes only)
   */
  static resetInstance(): void {
    if (FirestoreClient.instance) {
      // Firestore client doesn't need explicit cleanup
      // GCP SDK handles connection pooling and cleanup automatically
      FirestoreClient.instance = null;
      FirestoreClient.initStartTime = null;

      logger.info('Firestore client instance reset', {
        operation: 'FirestoreClient.resetInstance',
      });
    }
  }

  /**
   * Check if Firestore is initialized
   */
  static isInitialized(): boolean {
    return FirestoreClient.instance !== null;
  }
}

/**
 * Get Firestore instance
 * Convenience function that delegates to singleton
 */
export function getFirestore(): Firestore {
  return FirestoreClient.getInstance();
}

/**
 * Check if Firestore is initialized
 */
export function isFirestoreInitialized(): boolean {
  return FirestoreClient.isInitialized();
}

/**
 * Reset Firestore instance (testing only)
 */
export function resetFirestoreInstance(): void {
  FirestoreClient.resetInstance();
}
