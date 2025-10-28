# Quickstart Guide: Cross-Workspace Calendar Synchronization

**Purpose**: Get the calendar sync service running locally in under 30 minutes

## Prerequisites

- Node.js 20 LTS or later ([download](https://nodejs.org/))
- Google Workspace admin access for both primary (hoge.jp) and secondary (fuga.jp) domains
- Google Cloud project with Calendar API enabled
- Service account with domain-wide delegation configured

## Overview

This minimal setup runs a single Node.js process that:
1. Loads user mappings from a local JSON file
2. Registers push notification channels with Google Calendar
3. Listens for webhook notifications on `http://localhost:3000/webhook`
4. Syncs attendees across workspace domains in real-time

## Step 1: Google Cloud Setup (15 min)

### 1.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project (e.g., "calendar-sync")
3. Note the Project ID

### 1.2 Enable Required APIs

1. In Cloud Console, navigate to **APIs & Services > Library**
2. Search for and enable the following APIs:
   - **Google Calendar API** (for calendar event synchronization)
   - **Google Sheets API** (for loading user mappings from Spreadsheet)

### 1.3 Create Service Account

1. Navigate to **IAM & Admin > Service Accounts**
2. Click **Create Service Account**
3. Enter name: `calendar-sync-service`
4. Description: `Service account for cross-workspace calendar synchronization`
5. Click **Create and Continue**
6. Skip role assignment (not needed for domain-wide delegation)
7. Click **Done**

### 1.4 Generate Service Account Key

1. Click on the newly created service account
2. Go to **Keys** tab
3. Click **Add Key > Create New Key**
4. Choose **JSON** format
5. Click **Create** - a JSON file will download
6. **Important**: Save this file securely - you'll place it in `config/service-account-key.json` later

### 1.5 Note Service Account Email

From the service account details page, copy the email address (format: `calendar-sync-service@PROJECT_ID.iam.gserviceaccount.com`). You'll need this for:
1. Domain-wide delegation setup
2. Sharing the user mappings Spreadsheet

## Step 2: Google Workspace Admin Setup (10 min)

### 2.1 Enable Domain-Wide Delegation (Primary Workspace)

1. Go to [Google Admin Console](https://admin.google.com/)
2. Navigate to **Security > Access and data control > API Controls**
3. Click **Manage Domain-Wide Delegation**
4. Click **Add new**
5. Enter the Service Account **Client ID** (found in Cloud Console under service account details, or in the downloaded JSON file as `client_id`)
6. **OAuth Scopes**: Enter:
   ```
   https://www.googleapis.com/auth/calendar
   ```
7. Click **Authorize**

### 2.2 Verify Calendar Access

Test that the service account can access a user's calendar:

```bash
# Using gcloud CLI (install from https://cloud.google.com/sdk/docs/install)
gcloud auth activate-service-account \
  --key-file=config/service-account-key.json

gcloud calendar events list \
  --calendar=hirose30@hoge.jp \
  --impersonate-service-account=calendar-sync-service@PROJECT_ID.iam.gserviceaccount.com
```

Expected: List of calendar events (or empty list). If you get a permission error, review domain-wide delegation setup.

### 2.3 Enable API Access for Secondary Workspace (if different organization)

If secondary workspace (fuga.jp) is a separate Google Workspace organization:
1. Repeat Step 2.1 in the secondary workspace's Admin Console
2. Use the **same service account Client ID** and scopes

## Step 3: Application Setup (5 min)

### 3.1 Clone Repository

```bash
git clone <repository-url>
cd google-calendar-auto-sync
```

### 3.2 Install Dependencies

```bash
npm install
```

Expected packages:
- `googleapis` - Google Calendar API client
- `express` - HTTP server for webhook endpoint
- `typescript` - TypeScript compiler
- `@types/node`, `@types/express` - Type definitions

### 3.3 Configure Service Account

1. Create config directory:
   ```bash
   mkdir -p config
   ```

2. Copy the service account key JSON file downloaded in Step 1.4:
   ```bash
   cp ~/Downloads/PROJECT_ID-xxxxx.json config/service-account-key.json
   ```

3. Secure the file (Unix/macOS):
   ```bash
   chmod 600 config/service-account-key.json
   ```

### 3.4 Create User Mappings Spreadsheet

1. **Create new Google Spreadsheet**:
   - Go to [Google Sheets](https://sheets.google.com/)
   - Create new spreadsheet
   - Name it "Calendar Sync - User Mappings"

2. **Set up sheet structure**:
   - Rename Sheet1 to `User Mappings`
   - Add header row (Row 1):
     | A | B | C |
     |---|---|---|
     | Primary Email | Secondary Emails | Status |

3. **Add your user mappings** (starting from Row 2):
   | Primary Email | Secondary Emails | Status |
   |---------------|------------------|--------|
   | hirose30@hoge.jp | hirose30@fuga.jp | active |
   | user1@hoge.jp | user1@fuga.jp, user1@baz.jp | active |

   **Notes**:
   - Column B: Comma-separated list for multiple secondary emails
   - Column C: `active` or `inactive` (leave empty = active)
   - Only include users you want to monitor

4. **Share with service account**:
   - Click **Share** button
   - Add service account email (from Step 1.5)
   - Grant **Viewer** permission
   - Click **Done**

5. **Copy Spreadsheet ID**:
   - From browser URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
   - Copy the {SPREADSHEET_ID} part
   - Save for next step

6. **Set environment variable**:
   ```bash
   export SPREADSHEET_ID="your-spreadsheet-id-here"
   ```

   Or add to `.env` file:
   ```bash
   echo "SPREADSHEET_ID=your-spreadsheet-id-here" >> .env
   ```

### 3.5 Build TypeScript

```bash
npm run build
```

This compiles `src/**/*.ts` → `dist/**/*.js`

## Step 4: Run the Service

### 4.1 Start in Development Mode

```bash
npm run dev
```

Expected output:
```
[INFO] Loading user mappings from config/user-mappings.json
[INFO] Loaded 2 user mappings
[INFO] Registering watch channels for 2 calendars...
[INFO] Registered channel for hirose30@hoge.jp (expires 2025-11-04)
[INFO] Registered channel for user1@hoge.jp (expires 2025-11-04)
[INFO] Webhook server listening on http://localhost:3000
[INFO] Service ready
```

### 4.2 Verify Setup

**Test 1: Check webhook endpoint**
```bash
curl http://localhost:3000/health
```

Expected: `{"status": "ok", "activeChannels": 2}`

**Test 2: Trigger sync manually**

1. Open Google Calendar for `hirose30@hoge.jp` in browser
2. Create a new event with yourself as an attendee
3. Within 1-2 minutes, check service logs for:
   ```
   [INFO] Webhook received (channelId: xxx, state: exists)
   [INFO] Fetched 1 events updated in last 5 minutes
   [INFO] Event synced successfully (eventId: evt_xxx, addedAttendees: ["hirose30@fuga.jp"])
   ```
4. Open the event in Google Calendar - verify `hirose30@fuga.jp` was added as attendee

## Step 5: Expose Webhook to Internet (for Production)

**Important**: Google Calendar push notifications require a publicly accessible HTTPS endpoint. For local development testing, use a tunneling service.

### Option A: ngrok (Quick Testing)

1. Install ngrok: https://ngrok.com/download
2. Start tunnel:
   ```bash
   ngrok http 3000
   ```
3. Note the HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. Update `WEBHOOK_URL` environment variable:
   ```bash
   export WEBHOOK_URL=https://abc123.ngrok.io/webhook
   npm run dev
   ```
5. Service will re-register watch channels with the ngrok URL

### Option B: Cloud Run (Production Deployment)

1. Create `Dockerfile`:
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --production
   COPY dist/ ./dist/
   COPY config/ ./config/
   CMD ["node", "dist/index.js"]
   ```

2. Build and deploy:
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/calendar-sync
   gcloud run deploy calendar-sync \
     --image gcr.io/PROJECT_ID/calendar-sync \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars WEBHOOK_URL=https://calendar-sync-xxx.run.app/webhook
   ```

3. Note the Cloud Run URL and update `WEBHOOK_URL` environment variable

## Common Issues

### Issue 1: "Insufficient permissions" when registering watch channels

**Cause**: Domain-wide delegation not configured or incorrect scopes

**Solution**:
1. Verify service account Client ID is correct in Admin Console
2. Ensure scope `https://www.googleapis.com/auth/calendar` is authorized
3. Wait 10-15 minutes for changes to propagate

### Issue 2: Webhook notifications not received

**Cause**: Webhook URL not publicly accessible or not HTTPS

**Solution**:
1. For local testing, use ngrok to expose localhost
2. For production, deploy to Cloud Run or another HTTPS-enabled platform
3. Verify URL is accessible: `curl https://your-webhook-url.com/health`

### Issue 3: "Calendar not found" error

**Cause**: Service account lacks access to calendar

**Solution**:
1. Verify user email is correct in `user-mappings.json`
2. Ensure user exists in Google Workspace
3. Check domain-wide delegation is enabled for the correct domain

### Issue 4: Secondary attendees not added

**Cause**: Secondary user doesn't exist or permissions issue

**Solution**:
1. Verify secondary email addresses are correct in `user-mappings.json`
2. Check service logs for specific error messages
3. Ensure secondary users have Google Calendar enabled

### Issue 5: High API quota usage

**Cause**: Too many webhook notifications or inefficient event fetching

**Solution**:
1. Check deduplication cache is working (events should not be processed multiple times)
2. Reduce `updatedMin` time window for event listing (currently 5 minutes)
3. Review logs for repeated processing of the same event ID

## Monitoring

### View Logs

Development mode logs to stdout:
```bash
npm run dev | bunyan  # If using bunyan for pretty-printing JSON logs
```

Production logs (Cloud Run):
```bash
gcloud run logs read calendar-sync --region us-central1
```

### Key Metrics to Watch

- **Webhook notifications received per hour**: Should correlate with calendar activity
- **Events processed per hour**: Subset of webhooks (only those with mapped primary attendees)
- **API errors**: Should be < 1% (mostly transient rate limits)
- **Sync latency**: Time from webhook received to attendees added (target: <2 minutes)

### Manual Intervention Required

Check logs daily for:
- `[ERROR]` entries: Failed sync operations after retries
- `[WARN] Unknown channel`: Expired channels not renewed (investigate why)
- `[WARN] Invalid mapping entry`: Fix `user-mappings.json` and restart

## Next Steps

1. **Test with multiple users**: Add more mappings to `config/user-mappings.json`
2. **Monitor for 1 week**: Verify channels auto-renew before expiration
3. **Review logs**: Ensure no persistent errors
4. **Document runbook**: Create procedures for common operational tasks
5. **Plan production deployment**: Move from local/ngrok to Cloud Run with proper monitoring

## Security Checklist

- [ ] Service account key file has `0600` permissions (read/write owner only)
- [ ] `config/service-account-key.json` is in `.gitignore`
- [ ] `config/user-mappings.json` is in `.gitignore` (contains email addresses)
- [ ] Webhook endpoint uses HTTPS in production
- [ ] Service account has minimal necessary scopes (only Calendar API)
- [ ] Domain-wide delegation reviewed by security team
- [ ] Logs do not contain sensitive data (no email contents, only metadata)

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port for webhook endpoint |
| `WEBHOOK_URL` | Yes (prod) | `http://localhost:3000/webhook` | Public HTTPS URL for Google Calendar notifications |
| `SPREADSHEET_ID` | **Yes** | - | Google Spreadsheet ID containing user mappings |
| `CONFIG_DIR` | No | `./config` | Directory containing service account key file |
| `LOG_LEVEL` | No | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `DEDUP_CACHE_TTL_MS` | No | `300000` (5 min) | Deduplication cache TTL in milliseconds |
| `MAPPING_REFRESH_INTERVAL_MS` | No | `300000` (5 min) | How often to refresh user mappings from Spreadsheet |
| `CHANNEL_RENEWAL_THRESHOLD_MS` | No | `86400000` (1 day) | Renew channels expiring within this time |

### Example .env File

```bash
# .env (for local development)
PORT=3000
WEBHOOK_URL=https://abc123.ngrok.io/webhook
SPREADSHEET_ID=1abc123xyz456_your_spreadsheet_id
CONFIG_DIR=./config
LOG_LEVEL=debug
MAPPING_REFRESH_INTERVAL_MS=300000
```

## Support

For issues:
1. Check logs for specific error messages
2. Review Google Calendar API quotas in Cloud Console
3. Verify domain-wide delegation is active
4. Consult [Google Calendar API documentation](https://developers.google.com/calendar/api)

## Appendix: Manual Watch Channel Registration

If you need to manually register a watch channel (e.g., for debugging):

```bash
# Using curl with service account token
ACCESS_TOKEN=$(gcloud auth application-default print-access-token)

curl -X POST \
  "https://www.googleapis.com/calendar/v3/calendars/hirose30@hoge.jp/events/watch" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-channel-'$(uuidgen)'",
    "type": "web_hook",
    "address": "https://your-webhook-url.com/webhook"
  }'
```

To stop a channel:
```bash
curl -X POST \
  "https://www.googleapis.com/calendar/v3/channels/stop" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "channel-id-from-watch-response",
    "resourceId": "resource-id-from-watch-response"
  }'
```
