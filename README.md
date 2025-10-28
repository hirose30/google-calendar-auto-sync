# Google Calendar Cross-Workspace Synchronization

Automated system to synchronize calendar event attendees across Google Workspace domains.

## Overview

When calendar events are created or updated in a primary Google Workspace (e.g., hoge.jp) with mapped users as attendees, this system automatically adds corresponding secondary workspace identities (e.g., fuga.jp) as attendees to the same event.

## Features

- **Automatic Attendee Sync**: Add secondary workspace users when primary users are invited to events
- **Real-Time Detection**: Uses Google Calendar Push Notifications for near real-time synchronization
- **Update Propagation**: Synchronizes attendee additions, removals, and event detail changes
- **Deduplication**: Prevents duplicate processing and handles rapid event updates gracefully
- **Spreadsheet Configuration**: User mappings managed via Google Spreadsheet (no code deployment needed)

## Quick Start

**日本語**: [クイックスタートガイド（日本語）](QUICKSTART_JA.md) で5分でセットアップ！

For detailed setup instructions, see [TESTING.md](TESTING.md) or [quickstart.md](specs/001-calendar-cross-workspace-sync/quickstart.md)

### Prerequisites

- Node.js 20 LTS or later
- Google Workspace admin access
- Google Cloud project with Calendar API and Sheets API enabled
- Service account with domain-wide delegation

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# - Set SPREADSHEET_ID
# - Set WEBHOOK_URL (for production)
# - Configure CONFIG_DIR if needed

# Build TypeScript
npm run build

# Start the service
npm start
```

### Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm test:coverage

# Lint code
npm run lint

# Format code
npm run format
```

## Architecture

- **TypeScript + Node.js 20 LTS**: Type-safe implementation with modern JavaScript runtime
- **Express**: Webhook endpoint for Google Calendar Push Notifications
- **googleapis**: Google Calendar API and Google Sheets API client
- **In-Memory State**: User mappings cached from Spreadsheet, sync state managed in memory
- **Serverless-Ready**: Designed to run as a single process on Cloud Run or similar platforms

## Project Structure

```
src/
├── index.ts              # Entry point: Express server + startup logic
├── calendar/
│   ├── client.ts         # Google Calendar API client wrapper
│   ├── watcher.ts        # Push notification channel management
│   └── sync.ts           # Core sync logic
├── config/
│   ├── loader.ts         # Configuration loading (Spreadsheet + service account)
│   └── types.ts          # Configuration type definitions
├── webhook/
│   ├── handler.ts        # Webhook request handler
│   └── validator.ts      # Webhook header validation
├── state/
│   ├── mapping-store.ts  # In-memory user mapping store
│   ├── sync-cache.ts     # Deduplication cache
│   └── channel-registry.ts # Watch channel tracking
└── utils/
    ├── logger.ts         # Structured JSON logging
    ├── retry.ts          # Retry logic with backoff
    └── sleep.ts          # Promise-based delay utility

tests/
├── unit/                 # Unit tests
└── integration/          # Integration tests

config/
├── service-account-key.json       # Google service account credentials (gitignored)
├── service-account-key.example.json # Template
└── user-mappings.example.json      # Example mapping format (deprecated - use Spreadsheet)
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `WEBHOOK_URL` | Yes (prod) | `http://localhost:3000/webhook` | Public HTTPS URL for webhooks |
| `SPREADSHEET_ID` | **Yes** | - | Google Spreadsheet ID with user mappings |
| `CONFIG_DIR` | No | `./config` | Directory containing service account key |
| `LOG_LEVEL` | No | `info` | Logging level (debug/info/warn/error) |
| `DEDUP_CACHE_TTL_MS` | No | `300000` (5 min) | Deduplication cache TTL |
| `MAPPING_REFRESH_INTERVAL_MS` | No | `300000` (5 min) | Mapping refresh interval |
| `CHANNEL_RENEWAL_THRESHOLD_MS` | No | `86400000` (1 day) | Channel renewal threshold |

### User Mappings Spreadsheet

Create a Google Spreadsheet with the following structure:

**Sheet Name**: `User Mappings`

| Primary Email | Secondary Emails | Status |
|---------------|------------------|--------|
| user1@hoge.jp | user1@fuga.jp | active |
| user2@hoge.jp | user2@fuga.jp, user2@baz.jp | active |

- **Primary Email**: User in the primary workspace
- **Secondary Emails**: Comma-separated list of corresponding secondary workspace identities
- **Status**: `active` or `inactive` (empty = active)

Share the Spreadsheet with your service account email (Viewer permission).

## Success Criteria

本システムは以下の成功基準（Success Criteria）を満たすように設計されています：

| ID | 基準 | 目標値 | 測定方法 |
|----|------|--------|----------|
| **SC-001** | イベント作成時の同期レイテンシ | 95%のケースで2分以内 | Cloud Logging クエリで p95 測定 |
| **SC-002** | イベント更新時の同期レイテンシ | 95%のケースで2分以内 | Cloud Logging クエリで p95 測定 |
| **SC-003** | イベント検知率 | 99.9%以上 | Watch Channel登録状態を監視 |
| **SC-004** | 重複処理の防止 | 0件 | DeduplicationCache ログを確認 |
| **SC-005** | 並行処理性能 | 100件の同時イベント変更を処理 | 負荷テスト（オプション） |
| **SC-006** | 管理工数削減 | 90%削減（手動管理比） | 主観的評価 |
| **SC-007** | ユーザ満足度 | 85%以上 | ユーザアンケート（本番運用後） |
| **SC-008** | トラブルシューティング時間 | 10分以内で原因特定 | ログの充実度で担保 |

詳細は [DEPLOYMENT.md](DEPLOYMENT.md) のモニタリングセクションを参照してください。

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-28T17:15:54.990Z",
  "cache": {
    "mappingCount": 1,
    "lastLoadedAt": "2025-10-28T17:13:21.179Z",
    "loadErrors": 0
  }
}
```

### Manual Mapping Reload

```bash
curl -X POST http://localhost:3000/admin/reload-mappings
```

### Logs

Structured JSON logs output to stdout/stderr for container platform integration.

Key log fields:
- `timestamp`: ISO 8601
- `level`: ERROR, WARN, INFO, DEBUG
- `message`: Human-readable message
- `context`: Contextual data (eventId, calendarId, operation, duration, error)

**重要なログメッセージ:**
- `Service account key loaded from environment variable` - 起動成功
- `User mappings loaded from Spreadsheet` - マッピング読み込み成功
- `Watch channel registered successfully` - Webhook登録成功
- `Event synced successfully` - 同期成功

## Deployment

### Google Cloud Run（推奨）

**簡単デプロイ：**

```bash
# 1. deploy-cloudrun.sh を編集してPROJECT_IDを設定
nano deploy-cloudrun.sh

# 2. デプロイ実行
./deploy-cloudrun.sh
```

**メリット：**
- ✅ 固定HTTPS URL（Webhook URL変更不要）
- ✅ 無料枠あり（月100万リクエストまで）
- ✅ 自動SSL証明書
- ✅ ログ統合
- ✅ 排他制御（`--max-instances 1` で重複処理を防止）

詳細は [DEPLOYMENT.md](DEPLOYMENT.md) を参照

**スケーリング設定：**
- `--max-instances 1`（推奨、コスト0円）
- 1インスタンスで1日1000イベント程度まで対応可能
- **外部キャッシュ（Redis等）は不要**（メモリ内DeduplicationCacheで十分）

### Docker

```bash
# Build image
docker build -t calendar-sync .

# Run container
docker run -p 3000:3000 \
  -v $(pwd)/config:/app/config \
  -e SPREADSHEET_ID=your_spreadsheet_id \
  -e WEBHOOK_URL=https://your-webhook-url.com/webhook \
  calendar-sync
```

## Troubleshooting

### Common Issues

1. **"Insufficient permissions" error**
   - Verify domain-wide delegation is configured in Google Workspace Admin
   - Check service account Client ID and scopes are correct
   - Wait 10-15 minutes for propagation

2. **Webhook notifications not received**
   - Ensure WEBHOOK_URL is publicly accessible via HTTPS
   - For local testing, use ngrok to expose localhost
   - Verify watch channels are registered (check logs on startup)

3. **Mappings not loading**
   - Verify SPREADSHEET_ID is correct
   - Check Spreadsheet is shared with service account email
   - Ensure Sheets API is enabled in Google Cloud Console

4. **Secondary attendees not added**
   - Check logs for specific error messages
   - Verify secondary user email addresses are correct
   - Ensure service account has Calendar API access

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/sync.test.ts

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Code Quality

```bash
# Lint TypeScript
npm run lint

# Format code with Prettier
npm run format
```

## Terminology

プロジェクト内で使用される主要な用語：

| 用語 | 説明 | 例 |
|------|------|-----|
| **Primary Workspace** | 主要な Google Workspace ドメイン | hoge.jp |
| **Secondary Workspace** | 同期先の Google Workspace ドメイン | fuga.jp, baz.jp |
| **User Mapping** | プライマリユーザとセカンダリユーザの対応関係 | hirose30@hoge.jp → hirose30@fuga.jp |
| **Watch Channel** | Google Calendar Push Notification のチャネル | 7日間有効、自動更新 |
| **Sync Event** | カレンダー同期処理のトリガーとなるイベント | create, update, delete |
| **Deduplication Cache** | 重複処理を防ぐための一時キャッシュ | 5分間 TTL |
| **FR** | Functional Requirement（機能要件） | FR-001, FR-002... |
| **US** | User Story（ユーザーストーリー） | US1, US2... |
| **SC** | Success Criteria（成功基準） | SC-001, SC-002... |
| **P1/P2/P3** | Priority（優先度） | P1=最高、P3=最低 |
| **MVP** | Minimum Viable Product（最小実装） | Phase 1-4（コア同期機能） |
| **TTL** | Time To Live（有効期限） | キャッシュの保持期間 |

### 略語

- **API**: Application Programming Interface
- **JWT**: JSON Web Token
- **OAuth**: Open Authorization
- **GCR**: Google Container Registry
- **SA**: Service Account（サービスアカウント）
- **TTL**: Time To Live
- **SLA**: Service Level Agreement
- **p95**: 95th percentile（95パーセンタイル）

## License

MIT

## Support

For issues and questions, see:
- [Feature Specification](specs/001-calendar-cross-workspace-sync/spec.md)
- [Implementation Plan](specs/001-calendar-cross-workspace-sync/plan.md)
- [Quickstart Guide](specs/001-calendar-cross-workspace-sync/quickstart.md)
- [Deployment Guide](DEPLOYMENT.md)
