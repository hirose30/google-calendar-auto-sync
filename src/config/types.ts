/**
 * Configuration type definitions
 */

/**
 * Google Service Account configuration
 * Standard format from Google Cloud Console
 */
export interface ServiceAccountConfig {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

/**
 * User mapping from primary workspace to secondary workspace(s)
 */
export interface UserMapping {
  primary: string; // Primary workspace email (e.g., hirose30@hoge.jp)
  secondaries: string[]; // List of secondary emails (e.g., [hirose30@fuga.jp, hirose30@baz.jp])
  status: 'active' | 'inactive'; // Defaults to 'active' if empty
}

/**
 * User mapping row as read from Spreadsheet
 */
export interface UserMappingRow {
  primary: string; // Column A
  secondariesStr: string; // Column B: comma-separated
  status: string; // Column C: 'active' | 'inactive' | ''
}

/**
 * User mapping configuration container
 */
export interface UserMappingConfig {
  mappings: UserMapping[];
}

/**
 * Application configuration from environment variables
 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  spreadsheetId: string;
  webhookUrl: string;
  configDir: string;
  logLevel: string;
  dedupCacheTtlMs: number;
  mappingRefreshIntervalMs: number;
  channelRenewalThresholdMs: number;
}

/**
 * Load application configuration from environment variables
 */
export function loadAppConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    spreadsheetId: process.env.SPREADSHEET_ID || '',
    webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3000/webhook',
    configDir: process.env.CONFIG_DIR || './config',
    logLevel: process.env.LOG_LEVEL || 'info',
    dedupCacheTtlMs: parseInt(process.env.DEDUP_CACHE_TTL_MS || '300000', 10),
    mappingRefreshIntervalMs: parseInt(
      process.env.MAPPING_REFRESH_INTERVAL_MS || '300000',
      10
    ),
    channelRenewalThresholdMs: parseInt(
      process.env.CHANNEL_RENEWAL_THRESHOLD_MS || '86400000',
      10
    ),
  };
}

/**
 * Validate required configuration
 * @throws Error if required configuration is missing
 */
export function validateAppConfig(config: AppConfig): void {
  if (!config.spreadsheetId) {
    throw new Error('SPREADSHEET_ID environment variable is required');
  }

  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PORT: ${config.port}. Must be between 1 and 65535`);
  }
}
