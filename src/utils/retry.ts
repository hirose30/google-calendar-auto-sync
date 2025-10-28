import { logger } from './logger.js';
import { sleep } from './sleep.js';

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Default retry configuration per spec clarification:
 * - 5 attempts
 * - Fixed 30 second intervals
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  delayMs: 30000, // 30 seconds
};

/**
 * Retry an async operation with fixed backoff
 * @param operation The async operation to retry
 * @param config Retry configuration
 * @returns Result of the operation
 * @throws Error after all retries exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === config.maxAttempts) {
        logger.error('Operation failed after all retry attempts', {
          error: {
            message: lastError.message,
            stack: lastError.stack,
          },
          operation: 'withRetry',
          duration: attempt * config.delayMs,
        });
        throw lastError;
      }

      // Log retry attempt
      logger.warn(`Operation failed, retrying in ${config.delayMs}ms`, {
        error: {
          message: lastError.message,
        },
        operation: 'withRetry',
      });

      // Call optional retry callback
      if (config.onRetry) {
        config.onRetry(attempt, lastError);
      }

      // Wait before next attempt
      await sleep(config.delayMs);
    }
  }

  // This should never be reached, but TypeScript requires it
  throw new Error('Retry logic error - should not reach here');
}

/**
 * Determine if an error is transient (should retry) or permanent (should not retry)
 * @param error The error to check
 * @returns true if error is transient and should be retried
 */
export function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // HTTP status codes that indicate transient errors
  const transientStatusCodes = [429, 500, 502, 503, 504];

  // Check for status codes in error message
  for (const code of transientStatusCodes) {
    if (message.includes(String(code))) {
      return true;
    }
  }

  // Network errors
  const networkErrors = ['econnreset', 'etimedout', 'enotfound', 'enetunreach'];
  if (networkErrors.some((err) => message.includes(err))) {
    return true;
  }

  // Rate limit errors
  if (message.includes('rate limit') || message.includes('quota')) {
    return true;
  }

  // Default to non-transient (don't retry)
  return false;
}
