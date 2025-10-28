import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { ServiceAccountConfig, UserMapping } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Load service account key from file or environment variable
 * @param configDir Configuration directory path (optional if SERVICE_ACCOUNT_KEY env var is set)
 * @returns Service account configuration
 * @throws Error if neither file nor env var is available or is invalid JSON
 */
export function loadServiceAccountKey(configDir: string): ServiceAccountConfig {
  // First, try to load from SERVICE_ACCOUNT_KEY environment variable
  const envKey = process.env.SERVICE_ACCOUNT_KEY;
  if (envKey) {
    try {
      const config = JSON.parse(envKey) as ServiceAccountConfig;

      // Validate basic structure
      if (
        config.type !== 'service_account' ||
        !config.private_key ||
        !config.client_email
      ) {
        throw new Error('Invalid service account key format in environment variable');
      }

      logger.info('Service account key loaded from environment variable', {
        operation: 'loadServiceAccountKey',
      });

      return config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in SERVICE_ACCOUNT_KEY environment variable: ${error.message}`);
      }
      throw error;
    }
  }

  // Fall back to loading from file
  const keyPath = path.join(configDir, 'service-account-key.json');

  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Service account key not found at ${keyPath} and SERVICE_ACCOUNT_KEY environment variable is not set. ` +
        'Please either set SERVICE_ACCOUNT_KEY environment variable or place your service-account-key.json in the config directory.'
    );
  }

  try {
    const keyContent = fs.readFileSync(keyPath, 'utf-8');
    const config = JSON.parse(keyContent) as ServiceAccountConfig;

    // Validate basic structure
    if (
      config.type !== 'service_account' ||
      !config.private_key ||
      !config.client_email
    ) {
      throw new Error('Invalid service account key format');
    }

    logger.info('Service account key loaded successfully from file', {
      operation: 'loadServiceAccountKey',
    });

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in service account key file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create authenticated JWT client for Google APIs
 * @param serviceAccount Service account configuration
 * @param userEmail Email to impersonate via domain-wide delegation
 * @param scopes API scopes to request
 * @returns Authenticated JWT client
 */
export function createJWTClient(
  serviceAccount: ServiceAccountConfig,
  userEmail?: string,
  scopes: string[] = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]
): JWT {
  return new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes,
    ...(userEmail && { subject: userEmail }), // Domain-wide delegation
  });
}

/**
 * Load user mappings from Google Spreadsheet
 * @param spreadsheetId Google Spreadsheet ID
 * @param serviceAccount Service account configuration
 * @param sheetName Name of the sheet containing mappings (default: 'User Mappings')
 * @returns Array of user mappings
 * @throws Error if Spreadsheet cannot be accessed or is invalid
 */
export async function loadUserMappingsFromSheet(
  spreadsheetId: string,
  serviceAccount: ServiceAccountConfig,
  sheetName: string = 'User Mappings'
): Promise<UserMapping[]> {
  const startTime = Date.now();

  try {
    // Create JWT client (no user impersonation needed for Spreadsheet access)
    const auth = createJWTClient(serviceAccount, undefined, [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ]);

    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch data from Spreadsheet (skip header row)
    const range = `${sheetName}!A2:C`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values || [];
    const mappings: UserMapping[] = [];

    for (const row of rows) {
      // Parse row: [primary, secondariesStr, status]
      const [primary, secondariesStr, status] = row as [string, string, string?];

      // Skip rows without primary email
      if (!primary || !secondariesStr) continue;

      // Parse status (default to 'active' if empty)
      const mappingStatus = (status?.toLowerCase() || 'active') as
        | 'active'
        | 'inactive';

      // Skip inactive mappings
      if (mappingStatus === 'inactive') {
        logger.debug('Skipping inactive mapping', {
          operation: 'loadUserMappingsFromSheet',
          primaryUser: primary,
        });
        continue;
      }

      // Parse comma-separated secondary emails
      const secondaries = secondariesStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.includes('@'));

      if (secondaries.length > 0) {
        mappings.push({
          primary,
          secondaries,
          status: mappingStatus,
        });
      } else {
        logger.warn('Mapping has no valid secondary emails, skipping', {
          operation: 'loadUserMappingsFromSheet',
          primaryUser: primary,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('User mappings loaded from Spreadsheet', {
      operation: 'loadUserMappingsFromSheet',
      duration,
      context: {
        mappingCount: mappings.length,
        spreadsheetId,
      },
    });

    return mappings;
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as Error;

    logger.error('Failed to load user mappings from Spreadsheet', {
      operation: 'loadUserMappingsFromSheet',
      duration,
      error: {
        message: err.message,
        stack: err.stack,
      },
      context: {
        spreadsheetId,
      },
    });

    throw new Error(
      `Failed to load user mappings from Spreadsheet: ${err.message}`
    );
  }
}
