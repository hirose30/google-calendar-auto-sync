# 手動テスト手順書

Google Calendar Cross-Workspace Synchronization システムの手動テスト手順です。

## 前提条件

以下の準備が完了していることを確認してください：

1. ✅ Node.js 20 LTS以上がインストール済み
2. ✅ Google Workspaceの管理者権限を持っている
3. ✅ Google Cloudプロジェクトが作成済み
4. ✅ サービスアカウントが作成済み

## ステップ1: Google Cloud プロジェクトのセットアップ

### 1.1 APIの有効化

Google Cloud Console で以下のAPIを有効化します：

```bash
# Google Cloud Console にアクセス
# https://console.cloud.google.com/apis/library

# 以下のAPIを有効化：
# - Google Calendar API
# - Google Sheets API
```

### 1.2 サービスアカウントの作成

1. Google Cloud Console → **IAM と管理** → **サービスアカウント**
2. **サービスアカウントを作成** をクリック
3. 名前を入力（例: `calendar-sync-service`）
4. **作成して続行**
5. ロールは不要（スキップ可能）
6. **完了** をクリック

### 1.3 サービスアカウントキーのダウンロード

1. 作成したサービスアカウントをクリック
2. **キー** タブに移動
3. **鍵を追加** → **新しい鍵を作成**
4. **JSON** を選択して **作成**
5. ダウンロードされたJSONファイルを保存

```bash
# ダウンロードしたファイルをプロジェクトのconfigディレクトリに配置
cp ~/Downloads/your-service-account-key-*.json ./config/service-account-key.json
```

### 1.4 ドメイン全体の委任を有効化

1. サービスアカウントの詳細画面で **詳細設定を表示**
2. **クライアントID** をコピー（後で使用）
3. Google Workspace Admin Console にアクセス
   - https://admin.google.com
4. **セキュリティ** → **アクセスとデータ管理** → **APIの制御**
5. **ドメイン全体の委任** セクションで **ドメイン全体の委任を管理**
6. **新しく追加** をクリック
7. クライアントIDを入力
8. 以下のスコープを追加：
   ```
   https://www.googleapis.com/auth/calendar
   https://www.googleapis.com/auth/spreadsheets.readonly
   ```
9. **承認** をクリック

**重要**: 設定が反映されるまで10〜15分かかる場合があります。

## ステップ2: Google Spreadsheetの準備

### 2.1 Spreadsheetの作成

1. Google Spreadsheets で新しいスプレッドシートを作成
2. シート名を **User Mappings** に変更
3. 以下の形式でヘッダーと データを入力：

| Primary Email | Secondary Emails | Status |
|---------------|------------------|--------|
| hirose30@hoge.jp | hirose30@fuga.jp | active |
| user2@hoge.jp | user2@fuga.jp, user2@baz.jp | active |

**列の説明:**
- **A列 (Primary Email)**: プライマリワークスペースのメールアドレス
- **B列 (Secondary Emails)**: セカンダリワークスペースのメールアドレス（カンマ区切りで複数指定可能）
- **C列 (Status)**: `active` または `inactive`（空白の場合は `active` として扱われます）

### 2.2 サービスアカウントに共有

1. Spreadsheet の **共有** ボタンをクリック
2. サービスアカウントのメールアドレスを入力
   - 例: `calendar-sync-service@your-project.iam.gserviceaccount.com`
   - サービスアカウントキーのJSONファイル内の `client_email` フィールドを確認
3. 権限を **閲覧者** に設定
4. **送信** をクリック

### 2.3 Spreadsheet IDの取得

SpreadsheetのURLから IDを取得します：

```
https://docs.google.com/spreadsheets/d/1ABC...XYZ/edit
                                      ^^^^^^^^
                                      この部分がSpreadsheet ID
```

## ステップ3: アプリケーションの設定

### 3.1 環境変数の設定

```bash
# .env ファイルを作成
cp .env.example .env

# .env ファイルを編集
nano .env
```

`.env` ファイルの内容を以下のように編集：

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Google Calendar Configuration
SPREADSHEET_ID=あなたのSpreadsheet IDを貼り付け
WEBHOOK_URL=http://localhost:3000/webhook

# Configuration Directory
CONFIG_DIR=./config

# Logging
LOG_LEVEL=debug  # テスト時は debug に設定すると詳細ログが見られます

# Cache Settings
DEDUP_CACHE_TTL_MS=300000
MAPPING_REFRESH_INTERVAL_MS=300000
CHANNEL_RENEWAL_THRESHOLD_MS=86400000
```

### 3.2 依存関係のインストール

```bash
npm install
```

### 3.3 ビルド

```bash
npm run build
```

## ステップ4: アプリケーションの起動

### 4.1 開発モードで起動

```bash
npm run dev
```

### 4.2 起動ログの確認

以下のようなログが表示されれば成功です：

```json
{
  "timestamp": "2025-10-28T...",
  "level": "INFO",
  "message": "Starting Google Calendar Auto-Sync service",
  "operation": "start",
  "context": {
    "nodeEnv": "development",
    "port": 3000,
    "spreadsheetId": "1ABC...XYZ",
    "mappingRefreshIntervalMs": 300000
  }
}
```

```json
{
  "timestamp": "2025-10-28T...",
  "level": "INFO",
  "message": "User mappings refreshed successfully",
  "operation": "refreshUserMappings",
  "duration": 1234,
  "context": {
    "mappingCount": 2,
    "primaryUsers": ["hirose30@hoge.jp", "user2@hoge.jp"]
  }
}
```

```json
{
  "timestamp": "2025-10-28T...",
  "level": "INFO",
  "message": "Express server started",
  "operation": "start",
  "context": {
    "port": 3000,
    "health": "http://localhost:3000/health"
  }
}
```

## ステップ5: 動作確認テスト

### 5.1 ヘルスチェック

別のターミナルを開いて実行：

```bash
curl http://localhost:3000/health | jq
```

期待される出力：

```json
{
  "status": "ok",
  "timestamp": "2025-10-28T12:34:56.789Z",
  "cache": {
    "mappingCount": 2,
    "lastLoadedAt": "2025-10-28T12:30:00.000Z",
    "loadErrors": 0
  }
}
```

**確認項目:**
- ✅ `status` が `"ok"` である
- ✅ `mappingCount` がSpreadsheetの行数と一致する
- ✅ `lastLoadedAt` が最近の時刻である
- ✅ `loadErrors` が `0` である

### 5.2 マッピング手動リロードテスト

Spreadsheet の内容を変更して、手動リロードをテスト：

1. Spreadsheet に新しいマッピングを追加
2. 以下のコマンドを実行：

```bash
curl -X POST http://localhost:3000/admin/reload-mappings | jq
```

期待される出力：

```json
{
  "status": "ok",
  "message": "Mappings reloaded successfully",
  "mappingCount": 3
}
```

3. もう一度ヘルスチェックで確認：

```bash
curl http://localhost:3000/health | jq
```

**確認項目:**
- ✅ `mappingCount` が更新されている
- ✅ アプリケーションログに "User mappings refreshed successfully" が表示される

### 5.3 同期ロジックの単体テスト（将来実装予定）

現在のMVPでは、同期ロジックのテストは手動で行う必要があります。

## ステップ6: トラブルシューティング

### エラー: "Service account key not found"

**原因**: サービスアカウントキーファイルが正しい場所に配置されていない

**解決方法:**
```bash
# ファイルの存在確認
ls -la ./config/service-account-key.json

# 存在しない場合は配置
cp ~/Downloads/your-key.json ./config/service-account-key.json
```

### エラー: "SPREADSHEET_ID environment variable is required"

**原因**: `.env` ファイルに SPREADSHEET_ID が設定されていない

**解決方法:**
```bash
# .env ファイルを確認・編集
nano .env

# SPREADSHEET_ID=... の行に正しいIDを設定
```

### エラー: "Failed to load user mappings from Spreadsheet"

**原因1**: Spreadsheetがサービスアカウントに共有されていない

**解決方法:**
1. Spreadsheet を開く
2. 共有ボタンをクリック
3. サービスアカウントのメールアドレス（`client_email`）を追加
4. 権限を「閲覧者」に設定

**原因2**: Sheets API が有効化されていない

**解決方法:**
1. Google Cloud Console → API とサービス → ライブラリ
2. "Google Sheets API" を検索して有効化

**原因3**: ドメイン全体の委任が反映されていない

**解決方法:**
- 10〜15分待ってから再試行
- Google Workspace Admin Console で設定を再確認

### エラー: "Insufficient permissions"

**原因**: ドメイン全体の委任が正しく設定されていない

**解決方法:**
1. Google Workspace Admin Console にアクセス
2. セキュリティ → API の制御 → ドメイン全体の委任
3. サービスアカウントのクライアントIDが登録されているか確認
4. スコープが正しいか確認：
   ```
   https://www.googleapis.com/auth/calendar
   https://www.googleapis.com/auth/spreadsheets.readonly
   ```

### ログレベルの変更

詳細なデバッグ情報が必要な場合：

```bash
# .env ファイルを編集
LOG_LEVEL=debug

# アプリケーションを再起動
npm run dev
```

## ステップ7: ngrok でローカル環境を公開（ローカルテスト用）

Google Calendar の Push Notification は **HTTPS** が必須です。ローカル開発環境でテストするには、ngrok を使用します。

### 7.1 ngrok のインストール

```bash
# Homebrew でインストール（macOS）
brew install ngrok

# または公式サイトからダウンロード
# https://ngrok.com/download
```

### 7.2 ngrok でトンネルを作成

別のターミナルウィンドウで実行：

```bash
ngrok http 3000
```

以下のような出力が表示されます：

```
ngrok

Session Status                online
Account                       Your Account (Plan: Free)
Version                       3.x.x
Region                        Japan (jp)
Latency                       -
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://abcd1234.ngrok.io -> http://localhost:3000

Connections                   ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00
```

### 7.3 WEBHOOK_URL を更新

ngrok の HTTPS URL をコピーして `.env` ファイルを更新：

```bash
# .env ファイルを編集
nano .env

# WEBHOOK_URL を ngrok の URL に変更
WEBHOOK_URL=https://abcd1234.ngrok.io/webhook
```

**重要**: ngrok を再起動するたびに URL が変わります（無料プランの場合）

### 7.4 アプリケーションを再起動

```bash
# Ctrl+C で停止してから再起動
npm run dev
```

起動ログを確認：

```json
{
  "message": "Watch channel registered successfully",
  "context": {
    "calendarId": "hirose30@storegeek.jp",
    "channelId": "calendar-sync-...",
    "resourceId": "...",
    "expiration": "2025-10-29T..."
  }
}
```

✅ **"Watch channel registered successfully"** が表示されれば成功です！

## ステップ8: 実際のカレンダーイベントでのテスト

### 8.1 イベント作成テスト

1. **Google Calendar を開く**
   - プライマリユーザー（例: `hirose30@storegeek.jp`）でログイン

2. **新しいイベントを作成**
   - タイトル: "同期テスト"
   - 時間: 任意
   - **重要**: ゲストにプライマリユーザー自身（`hirose30@storegeek.jp`）を追加

3. **保存してログを確認**

期待されるログ：

```json
{"message": "Webhook notification received", "context": {"channelId": "...", "resourceState": "exists"}}
{"message": "Fetched recent events for processing", "context": {"eventCount": 1}}
{"message": "Starting event sync", "context": {"eventId": "..."}}
{"message": "Event synced successfully", "context": {"addedAttendees": ["hirose30@fuga.jp"]}}
```

4. **カレンダーで確認**
   - イベントを開く
   - ゲスト一覧に **セカンダリユーザー**（例: `hirose30@fuga.jp`）が追加されていることを確認

### 8.2 イベント更新テスト

1. **既存のイベントを編集**
   - 別のプライマリユーザーをゲストに追加（Spreadsheet にマッピングがある場合）

2. **保存してログを確認**

3. **カレンダーで確認**
   - 新しく追加されたプライマリユーザーに対応するセカンダリユーザーが追加されていることを確認

### 8.3 One-to-Many マッピングテスト

Spreadsheet で1つのプライマリユーザーに複数のセカンダリアカウントをマッピング：

| Primary Email | Secondary Emails | Status |
|---------------|------------------|--------|
| user@hoge.jp | user@fuga.jp, user@baz.jp, user@qux.jp | active |

1. **マッピングをリロード**
   ```bash
   node -e "fetch('http://localhost:3000/admin/reload-mappings', {method: 'POST'}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))"
   ```

2. **イベントを作成**してプライマリユーザーを追加

3. **確認**: すべてのセカンダリアカウントが追加されていることを確認

### 8.4 トラブルシューティング

**Webhook通知が届かない場合:**

1. ngrok のWebインターフェースを確認
   ```
   http://127.0.0.1:4040
   ```
   - リクエストが届いているか確認

2. Watch Channel が登録されているか確認
   - アプリケーションログで "Watch channel registered successfully" を検索

3. ngrok のURLが正しいか確認
   - `.env` ファイルの `WEBHOOK_URL` を再確認
   - アプリケーションを再起動

**セカンダリユーザーが追加されない場合:**

1. ログを確認
   - "No mapped primary attendees found" → Spreadsheet のマッピングを確認
   - "All secondary attendees already present" → すでに追加済み

2. Spreadsheet のマッピングを確認
   - プライマリメールアドレスが正確か
   - Status が "active" か

3. マッピングを手動リロード
   ```bash
   node -e "fetch('http://localhost:3000/admin/reload-mappings', {method: 'POST'}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))"
   ```

## 次のステップ

現在のMVPステータス：

- ✅ **Phase 1-2**: セットアップ＆基盤（完了）
- ✅ **Phase 3 (US5)**: ユーザーマッピング設定管理（完了）
- ✅ **Phase 4 (US1)**: コア同期ロジック（完了）
- ✅ **Phase 5 (US3)**: Push Notification（完了）
- ⏳ **Phase 6 (US2)**: 更新同期（一部実装済み - syncEvent() がカバー）
- ⏳ **Phase 7 (US4)**: 重複排除（一部実装済み - uniqueness check がカバー）
- ⏳ **Phase 8**: プロダクション対応（未実装）

**🎉 コア機能は完成しました！**

現在の実装で以下が動作します：
- ✅ Spreadsheet からのマッピング読み込み
- ✅ Google Calendar Push Notification の受信
- ✅ イベント作成・更新時の自動同期
- ✅ One-to-Many マッピング対応
- ✅ 重複排除（同じユーザーを複数回追加しない）
- ✅ エラーハンドリングとリトライ
- ✅ 構造化ログ出力

**実際のカレンダーイベントでテスト可能です！**

## サポート

問題が発生した場合は、以下を確認してください：

1. アプリケーションログ（JSON形式で出力されます）
2. [README.md](README.md) のトラブルシューティングセクション
3. [quickstart.md](specs/001-calendar-cross-workspace-sync/quickstart.md) の詳細な設定手順

---

**最終更新**: 2025-10-28
