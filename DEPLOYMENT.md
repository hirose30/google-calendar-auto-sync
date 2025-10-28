# 本番環境デプロイガイド

Google Calendar Cross-Workspace Synchronization を本番環境にデプロイする手順です。

## 📋 前提条件

- Google Cloud Platform アカウント
- gcloud CLI がインストール済み
- Docker がインストール済み（Docker Buildx サポート必須）
- サービスアカウントキーとSpreadsheet IDの準備
- **重要**: ARM64 (Apple Silicon) マシンからデプロイする場合は、マルチアーキテクチャビルドが必要

## 🚀 Google Cloud Run へのデプロイ（推奨）

### メリット

- ✅ **固定HTTPS URL**（変更不要）
- ✅ 自動スケーリング（0〜N）
- ✅ 無料枠あり（月100万リクエストまで無料）
- ✅ シークレット管理
- ✅ ログ統合（Cloud Logging）

### ステップ1: Google Cloud Project の準備

```bash
# プロジェクトIDを設定
export PROJECT_ID="your-project-id"

# gcloud にログイン
gcloud auth login

# プロジェクトを設定
gcloud config set project ${PROJECT_ID}

# 必要なAPIを有効化
gcloud services enable \
  run.googleapis.com \
  containerregistry.googleapis.com \
  secretmanager.googleapis.com
```

### ステップ2: シークレットの登録

```bash
# Spreadsheet ID をシークレットに登録
echo -n "your-spreadsheet-id" | \
  gcloud secrets create SPREADSHEET_ID --data-file=-

# サービスアカウントキーをシークレットに登録
gcloud secrets create SERVICE_ACCOUNT_KEY \
  --data-file=./config/service-account-key.json

# Cloud Run サービスアカウントにSecret Managerアクセス権限を付与
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding SPREADSHEET_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding SERVICE_ACCOUNT_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**注意**: Secret Manager のアクセス権限設定を忘れると、デプロイ時に `Permission denied on secret` エラーが発生します。

### ステップ3: Docker Buildx のセットアップ（ARM64マシンの場合）

ARM64 (Apple Silicon) マシンからデプロイする場合、Cloud Run (amd64) 向けのマルチアーキテクチャビルドが必要です：

```bash
# Buildx ビルダーを作成
docker buildx create --name multiarch --use

# アーキテクチャを確認
uname -m  # arm64 の場合は要対応
```

### ステップ4: デプロイ

```bash
# deploy-cloudrun.sh を編集してPROJECT_IDを設定
nano deploy-cloudrun.sh

# デプロイ実行（自動的に linux/amd64 向けにビルドされます）
./deploy-cloudrun.sh
```

`deploy-cloudrun.sh` は自動的に以下を実行します：
- `docker buildx build --platform linux/amd64` で amd64 向けにビルド
- GCR にプッシュ
- Cloud Run にデプロイ

デプロイが完了すると、以下のような出力が表示されます：

```
Deployment successful!
Service URL: https://calendar-sync-xxxxx-an.a.run.app
Webhook URL: https://calendar-sync-xxxxx-an.a.run.app/webhook
Health check: https://calendar-sync-xxxxx-an.a.run.app/health
```

### ステップ5: WEBHOOK_URL 環境変数の設定

デプロイ完了後、Cloud Run のサービス URL を使って WEBHOOK_URL を設定します：

```bash
# デプロイ時に表示されたサービスURLを使用
SERVICE_URL="https://calendar-sync-xxxxx.asia-northeast1.run.app"

# WEBHOOK_URL 環境変数を設定
gcloud run services update calendar-sync \
  --region asia-northeast1 \
  --update-env-vars WEBHOOK_URL=${SERVICE_URL}/webhook
```

これにより、Watch Channels が正しいWebhook URLで登録されます。

### ステップ6: サービスアカウントキーの配置方法

**現在の実装: 環境変数から直接読み込み（推奨）**

`src/config/loader.ts` は環境変数 `SERVICE_ACCOUNT_KEY` から直接JSONを読み込みます。
Secret Manager から環境変数として注入されるため、追加の設定は不要です。

**代替案: Workload Identity（より安全・高度）**

サービスアカウントキーファイルを使わず、Cloud Run のサービスアカウントに直接権限を付与：

1. Cloud Run のサービスアカウントに Calendar API と Sheets API の権限を付与
2. アプリケーションコードを修正してADC（Application Default Credentials）を使用

### ステップ7: 動作確認

```bash
# ヘルスチェック
curl https://your-service-url.a.run.app/health

# 期待される出力:
# {
#   "status": "ok",
#   "cache": {
#     "mappingCount": 1,
#     "lastLoadedAt": "2025-10-28T...",
#     "loadErrors": 0
#   }
# }
```

### ステップ8: ログ確認

```bash
# ログをストリーミング表示
gcloud run services logs read calendar-sync \
  --region asia-northeast1 \
  --limit 50

# アプリケーションログのみ表示
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=calendar-sync" \
  --limit=50 \
  --format=json | jq -r '.[] | select(.jsonPayload.message) | "\(.timestamp) [\(.jsonPayload.level)] \(.jsonPayload.message)"'

# または Cloud Console でログ確認
# https://console.cloud.google.com/logs
```

**確認すべきログメッセージ:**
- ✅ `Service account key loaded from environment variable`
- ✅ `User mappings loaded from Spreadsheet`
- ✅ `Watch channel registered successfully`
- ✅ `Express server started`

## 🔒 複数インスタンスでの排他制御

### 問題

Cloud Run は複数のインスタンスを起動できるため、**同じイベントが複数のインスタンスで同時処理される可能性**があります。

### 解決策：2つのオプション

#### オプション1: インスタンス数を1に制限（推奨・簡単）

**メリット：**
- ✅ 追加コスト0円
- ✅ 実装変更不要
- ✅ 確実に排他制御

**デメリット：**
- ⚠️ スケーラビリティが低下（ただし、カレンダー同期程度の負荷なら問題なし）

**設定：**

```bash
gcloud run deploy calendar-sync \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 80
```

`deploy-cloudrun.sh` にはすでに設定済みです。

**想定負荷での十分性：**
- 1日1000イベント = 1分あたり0.7イベント
- Webhook処理時間 = 1-2秒/イベント
- 1インスタンスで十分対応可能 ✅

#### オプション2: Redis（Memorystore）で分散キャッシュ（高負荷向け）

大規模環境（1日10,000イベント以上）の場合：

**1. Memorystore（Redis）のセットアップ**

```bash
# Memorystore インスタンスを作成
gcloud redis instances create calendar-sync-cache \
  --size=1 \
  --region=asia-northeast1 \
  --redis-version=redis_6_x

# 接続情報を取得
gcloud redis instances describe calendar-sync-cache \
  --region=asia-northeast1 \
  --format="value(host,port)"
```

**2. VPC Connector を作成**

```bash
gcloud compute networks vpc-access connectors create calendar-sync-connector \
  --network=default \
  --region=asia-northeast1 \
  --range=10.8.0.0/28
```

**3. Redis クライアントをインストール**

```bash
npm install redis
```

**4. 環境変数を設定**

```bash
REDIS_URL=redis://10.x.x.x:6379
USE_REDIS_CACHE=true
```

**5. Cloud Run デプロイ時に VPC Connector を指定**

```bash
gcloud run deploy calendar-sync \
  --vpc-connector calendar-sync-connector \
  --set-env-vars REDIS_URL=redis://10.x.x.x:6379 \
  --set-env-vars USE_REDIS_CACHE=true \
  --min-instances 1 \
  --max-instances 10
```

**コスト見積もり：**
- Memorystore（1GB）: 月額約$30
- VPC Connector: 月額$10

### 推奨事項

**小〜中規模（1日 < 1000イベント）:**
- ✅ **オプション1を推奨**（`--max-instances 1`）
- コスト0円、設定簡単

**大規模（1日 > 10,000イベント）:**
- ✅ **オプション2を推奨**（Redis + 複数インスタンス）
- スケーラブル、高可用性

## 🔄 Webhook URL 変更時の対応

### 問題ない理由

1. **起動時に自動で新しいWatch Channelを登録**
   - 新しいWebhook URLで登録される

2. **古いチャンネルは7日で自動削除**
   - Google Calendarが自動的にクリーンアップ

3. **Unknown channelの警告は無害**
   - 古いチャンネルからの通知は自動的に無視される

### URL変更時の手順

```bash
# 1. 新しいURLで再デプロイ
./deploy-cloudrun.sh

# 2. 環境変数 WEBHOOK_URL を更新（Cloud Runコンソールで）

# 3. サービスを再起動（自動的に新しいWatch Channelを登録）
gcloud run services update calendar-sync \
  --region asia-northeast1 \
  --update-env-vars WEBHOOK_URL=https://new-url.a.run.app/webhook

# 完了！古いWatch Channelは7日後に自動削除される
```

## 📊 監視とアラート

### Cloud Logging フィルター

エラーログのみ表示：
```
resource.type="cloud_run_revision"
resource.labels.service_name="calendar-sync"
jsonPayload.level="ERROR"
```

同期成功ログ：
```
jsonPayload.message="Event synced successfully"
```

### アラート設定（推奨）

Cloud Monitoring でアラートを設定：

1. **エラー率が高い**
   ```
   jsonPayload.level="ERROR"
   AND resource.labels.service_name="calendar-sync"
   ```
   閾値: 5分間に10件以上

2. **マッピング読み込み失敗**
   ```
   jsonPayload.message="Failed to refresh user mappings"
   ```

3. **Health check 失敗**
   ```
   resource.type="cloud_run_revision"
   httpRequest.status >= 500
   ```

## 💰 コスト見積もり

**無料枠内で運用可能**

- リクエスト数: 月100万リクエストまで無料
- CPU時間: 月18万秒まで無料
- メモリ: 月360,000 GiB-秒まで無料

**想定コスト（無料枠超過後）：**
- 1日100イベント → 月3000イベント
- Webhook通知 × 2回/イベント = 月6000リクエスト
- **月額: ほぼ0円**（無料枠内）

## 🔒 セキュリティ

### 推奨設定

1. **認証なしアクセスを許可**（Webhookのため必要）
   ```bash
   --allow-unauthenticated
   ```

2. **Secret Managerでシークレット管理**
   - サービスアカウントキー
   - Spreadsheet ID

3. **最小権限の原則**
   - Cloud Run のサービスアカウントに必要な権限のみ付与

4. **VPC接続（オプション）**
   - 内部ネットワークからのみアクセス可能にする

## 🔧 トラブルシューティング

### エラー: "Permission denied on secret"

```bash
# 原因: Cloud Run サービスアカウントに Secret Manager アクセス権限がない

# 解決策: IAM ポリシーを追加
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding SPREADSHEET_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding SERVICE_ACCOUNT_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### エラー: "failed to load /usr/local/bin/node: exec format error"

```bash
# 原因: ARM64 (Apple Silicon) でビルドされたイメージを amd64 (Cloud Run) で実行しようとした

# 解決策: マルチアーキテクチャビルドを使用
docker buildx create --name multiarch --use
docker buildx build --platform linux/amd64 -t gcr.io/${PROJECT_ID}/calendar-sync:latest --push .
```

### エラー: "Service account key not found"

```bash
# シークレットが正しく設定されているか確認
gcloud secrets versions access latest --secret=SERVICE_ACCOUNT_KEY | jq .

# Cloud Run の環境変数を確認
gcloud run services describe calendar-sync \
  --region asia-northeast1 \
  --format="value(spec.template.spec.containers[0].env)"
```

### エラー: "SPREADSHEET_ID environment variable is required"

```bash
# Cloud Run の環境変数を確認
gcloud run services describe calendar-sync \
  --region asia-northeast1 \
  --format yaml

# 環境変数を設定
gcloud run services update calendar-sync \
  --region asia-northeast1 \
  --set-secrets SPREADSHEET_ID=SPREADSHEET_ID:latest
```

### Watch Channels が登録されない

```bash
# 原因: WEBHOOK_URL が設定されていない

# 解決策: WEBHOOK_URL を設定
gcloud run services update calendar-sync \
  --region asia-northeast1 \
  --update-env-vars WEBHOOK_URL=https://your-service-url.asia-northeast1.run.app/webhook

# サービスを再起動（新しい Watch Channels を登録）
gcloud run services update calendar-sync \
  --region asia-northeast1 \
  --update-env-vars FORCE_RESTART=$(date +%s)
```

### ログが表示されない

```bash
# ログストリーミングを有効化
gcloud run services update calendar-sync \
  --region asia-northeast1 \
  --no-cpu-throttling
```

## ✅ デプロイ完了チェックリスト

デプロイが正常に完了したことを確認してください：

- [ ] Health check が `{"status": "ok"}` を返す
- [ ] ログに `Service account key loaded from environment variable` が表示される
- [ ] ログに `User mappings loaded from Spreadsheet` が表示される
- [ ] ログに `Watch channel registered successfully` が表示される
- [ ] ログに `Express server started` が表示される
- [ ] 実際のカレンダーイベントで同期が動作する

## 🎯 本番運用の推奨事項

### 1. モニタリング

#### レイテンシ監視（成功基準: SC-001, SC-002）

**目標**: イベント作成/更新から同期完了まで2分以内（95%のケース）

**Cloud Logging クエリ - 同期レイテンシ測定:**
```bash
# Webhook受信から同期完了までの時間を測定
resource.type="cloud_run_revision"
resource.labels.service_name="calendar-sync"
jsonPayload.message="Event synced successfully"
jsonPayload.duration>120000
```

**ダッシュボード作成:**
```bash
# Cloud Monitoring ダッシュボードで以下メトリクスを可視化
# - p50, p95, p99 レイテンシ
# - 同期成功率
# - エラー率
```

**アラート設定:**
```bash
# レイテンシアラート（p95 > 2分）
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Calendar Sync Latency SLA Breach" \
  --condition-display-name="P95 latency > 2 minutes" \
  --condition-threshold-value=120000 \
  --condition-threshold-duration=300s

# エラー率アラート
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Calendar Sync Errors" \
  --condition-display-name="High error rate" \
  --condition-threshold-value=5 \
  --condition-threshold-duration=300s
```

**レイテンシ測定方法:**
1. Cloud Logging でイベントのタイムスタンプを追跡
2. Webhook受信時刻: `jsonPayload.message="Webhook notification received"`
3. 同期完了時刻: `jsonPayload.message="Event synced successfully"`
4. 24時間ウィンドウで p95 を計算

### 2. バックアップ

**User Mappings スプレッドシートのバックアップ:**
- 定期的に Google Drive でコピーを作成
- または Google Apps Script で自動バックアップを設定

### 3. パフォーマンス検証（成功基準: SC-005）

**目標**: 100件の同時イベント変更を遅延なく処理

**負荷テストの実施（オプション）:**

```bash
# k6 または Artillery を使用した負荷テスト
# 1. 100件のカレンダーイベントを短時間で作成
# 2. Cloud Logging でレイテンシ劣化を確認
# 3. エラー率が増加しないことを検証

# 期待される結果:
# - p95 レイテンシが 2分以内を維持
# - エラー率 < 1%
# - すべてのイベントが処理される（99.9%検出率）
```

**単一インスタンス設定での性能:**
- 現在の設定: `--max-instances 1`
- 想定処理能力: 1日1000イベント（1分あたり0.7イベント）
- 並行処理: Cloud Run の concurrency=80 で十分対応可能

**負荷が増加した場合:**
1. `--max-instances` を増やす（例: 3）
2. Redis（Memorystore）で分散キャッシュを導入（DEPLOYMENT.md 参照）
3. Cloud Monitoring で CPU/メモリ使用率を監視

### 4. アーキテクチャ検証

今回のデプロイで解決した主要な問題：

| 問題 | 原因 | 解決策 |
|------|------|--------|
| `Permission denied on secret` | Secret Manager IAM 権限不足 | compute SA に `secretmanager.secretAccessor` ロールを付与 |
| `exec format error` | ARM64 → amd64 実行 | `docker buildx --platform linux/amd64` でビルド |
| Watch Channels 未登録 | WEBHOOK_URL 未設定 | 環境変数 WEBHOOK_URL を設定 |

## 📚 参考リンク

- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)
- [Cloud Logging](https://cloud.google.com/logging/docs)
- [Docker Buildx](https://docs.docker.com/build/building/multi-platform/)

---

**次のステップ**: [TESTING.md](TESTING.md) で動作確認
