import 'dotenv/config';
import express from 'express';
import { loadAppConfig, validateAppConfig } from './config/types.js';
import { loadServiceAccountKey, loadUserMappingsFromSheet } from './config/loader.js';
import { UserMappingStore } from './state/mapping-store.js';
import { ChannelRegistry } from './state/channel-registry.js';
import { DeduplicationCache } from './state/dedup-cache.js';
import { CalendarClient } from './calendar/client.js';
import { CalendarSyncService } from './calendar/sync.js';
import { WatchChannelManager } from './calendar/watcher.js';
import { WebhookHandler } from './webhook/handler.js';
import { logger } from './utils/logger.js';

/**
 * Main application entry point
 * Starts Express server, loads configuration, and sets up periodic mapping refresh
 */

// Load and validate configuration
const config = loadAppConfig();
validateAppConfig(config);

// Load service account key
const serviceAccount = loadServiceAccountKey(config.configDir);

// Initialize stores
const userMappingStore = new UserMappingStore();
const channelRegistry = new ChannelRegistry();
const dedupCache = new DeduplicationCache(config.dedupCacheTtlMs);

// Initialize services
const calendarClient = new CalendarClient(serviceAccount);
const syncService = new CalendarSyncService(calendarClient, userMappingStore);
const watchManager = new WatchChannelManager(
  calendarClient,
  channelRegistry,
  userMappingStore,
  config.webhookUrl,
  config.channelRenewalThresholdMs
);
const webhookHandler = new WebhookHandler(
  syncService,
  channelRegistry,
  userMappingStore,
  dedupCache
);

// Express app
const app = express();
app.use(express.json());

/**
 * Load user mappings from Spreadsheet
 * Handles errors gracefully and records failures in store metadata
 */
async function refreshUserMappings(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Refreshing user mappings from Spreadsheet', {
      operation: 'refreshUserMappings',
      context: {
        spreadsheetId: config.spreadsheetId,
      },
    });

    const mappings = await loadUserMappingsFromSheet(
      config.spreadsheetId,
      serviceAccount
    );

    userMappingStore.load(mappings);

    const duration = Date.now() - startTime;

    logger.info('User mappings refreshed successfully', {
      operation: 'refreshUserMappings',
      duration,
      context: {
        mappingCount: userMappingStore.size(),
        primaryUsers: userMappingStore.getAllPrimaries(),
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as Error;

    userMappingStore.recordLoadFailure();

    logger.error('Failed to refresh user mappings', {
      operation: 'refreshUserMappings',
      duration,
      error: {
        message: err.message,
        stack: err.stack,
      },
      context: {
        spreadsheetId: config.spreadsheetId,
        consecutiveErrors: userMappingStore.getMetadata().loadErrors,
      },
    });

    // Don't throw - allow app to continue with existing mappings
  }
}

/**
 * Health check endpoint
 * Returns service status and mapping cache metadata
 */
app.get('/health', (_req, res) => {
  const metadata = userMappingStore.getMetadata();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache: {
      mappingCount: metadata.mappingCount,
      lastLoadedAt: metadata.lastLoadedAt
        ? new Date(metadata.lastLoadedAt).toISOString()
        : null,
      loadErrors: metadata.loadErrors,
    },
  });
});

/**
 * Manual mapping reload endpoint
 * Triggers an immediate refresh of user mappings
 */
app.post('/admin/reload-mappings', async (_req, res) => {
  try {
    logger.info('Manual mapping reload triggered', {
      operation: '/admin/reload-mappings',
    });

    await refreshUserMappings();

    res.json({
      status: 'ok',
      message: 'Mappings reloaded successfully',
      mappingCount: userMappingStore.size(),
    });
  } catch (error) {
    const err = error as Error;

    logger.error('Manual mapping reload failed', {
      operation: '/admin/reload-mappings',
      error: {
        message: err.message,
        stack: err.stack,
      },
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to reload mappings',
      details: err.message,
    });
  }
});

/**
 * Webhook endpoint for Google Calendar push notifications
 */
app.post('/webhook', async (req, res) => {
  await webhookHandler.handle(req, res);
});

/**
 * Start application
 * 1. Load initial mappings
 * 2. Register watch channels
 * 3. Set up periodic refresh and renewal
 * 4. Start Express server
 */
async function start(): Promise<void> {
  try {
    logger.info('Starting Google Calendar Auto-Sync service', {
      operation: 'start',
      context: {
        nodeEnv: config.nodeEnv,
        port: config.port,
        spreadsheetId: config.spreadsheetId,
        webhookUrl: config.webhookUrl,
        mappingRefreshIntervalMs: config.mappingRefreshIntervalMs,
      },
    });

    // Load initial mappings
    await refreshUserMappings();

    if (userMappingStore.isEmpty()) {
      logger.warn(
        'No user mappings loaded - service will not process any events until mappings are available',
        {
          operation: 'start',
        }
      );
    } else {
      // Register watch channels for all primary users
      await watchManager.registerAllChannels();
    }

    // Set up periodic mapping refresh (every 5 minutes by default)
    const refreshInterval = setInterval(() => {
      refreshUserMappings().catch((error) => {
        logger.error('Periodic mapping refresh failed', {
          operation: 'periodicRefresh',
          error: {
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
      });
    }, config.mappingRefreshIntervalMs);

    // Set up periodic channel renewal (every hour)
    const renewalInterval = setInterval(() => {
      watchManager.renewExpiringChannels().catch((error) => {
        logger.error('Periodic channel renewal failed', {
          operation: 'periodicRenewal',
          error: {
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
      });
    }, 3600000); // Every hour

    // Cleanup on shutdown
    const shutdown = async () => {
      logger.info('Shutting down service', {
        operation: 'shutdown',
      });

      clearInterval(refreshInterval);
      clearInterval(renewalInterval);

      // Stop all watch channels
      await watchManager.stopAllChannels();

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start Express server
    app.listen(config.port, () => {
      logger.info('Express server started', {
        operation: 'start',
        context: {
          port: config.port,
          health: `http://localhost:${config.port}/health`,
          webhook: `${config.webhookUrl}`,
        },
      });
    });
  } catch (error) {
    const err = error as Error;

    logger.error('Failed to start service', {
      operation: 'start',
      error: {
        message: err.message,
        stack: err.stack,
      },
    });

    process.exit(1);
  }
}

// Start the application
start();

// Export for testing
export { app, userMappingStore };
