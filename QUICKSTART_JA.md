# クイックスタートガイド

Google Calendar Cross-Workspace Synchronization を5分で試す手順です。

## 前提条件

- ✅ Node.js 20以上
- ✅ Google Workspaceアカウント
- ✅ ngrok（ローカルテスト用）

## 1. セットアップ（2分）

```bash
# 依存関係をインストール
npm install

# .env ファイルを作成
cp .env.example .env

# サービスアカウントキーを配置
# config/service-account-key.json に配置してください
```

## 2. Spreadsheet準備（1分）

1. Google Spreadsheet を新規作成
2. シート名を **`User Mappings`** に変更
3. 以下のデータを入力：

```
A列: Primary Email       | B列: Secondary Emails    | C列: Status
hirose30@hoge.jp        | hirose30@fuga.jp         | active
```

4. サービスアカウント（`xxx@xxx.iam.gserviceaccount.com`）に**閲覧者権限**で共有
5. Spreadsheet ID をコピー（URLの `/d/` と `/edit` の間）

## 3. 環境変数設定

`.env` ファイルを編集：

```bash
SPREADSHEET_ID=あなたのSpreadsheet ID
WEBHOOK_URL=http://localhost:3000/webhook  # ngrok で後で変更
```

## 4. 起動（1分）

```bash
# ビルド
npm run build

# 起動
npm run dev
```

以下のログが表示されればOK：

```json
{"message": "User mappings refreshed successfully", "context": {"mappingCount": 1}}
{"message": "Express server started", "context": {"port": 3000}}
```

## 5. ngrok でHTTPS化（1分）

別ターミナルで：

```bash
# ngrok インストール（初回のみ）
brew install ngrok

# トンネル作成
ngrok http 3000
```

表示されたHTTPS URL（例: `https://abcd1234.ngrok.io`）をコピーして、`.env` を更新：

```bash
WEBHOOK_URL=https://abcd1234.ngrok.io/webhook
```

アプリケーションを再起動（Ctrl+C → `npm run dev`）

## 6. テスト！

1. **Google Calendar を開く**（プライマリユーザーでログイン）
2. **新しいイベントを作成**
   - ゲストにプライマリユーザー自身を追加
   - 保存
3. **ログを確認**：

```json
{"message": "Webhook notification received"}
{"message": "Event synced successfully", "context": {"addedAttendees": ["hirose30@fuga.jp"]}}
```

4. **カレンダーで確認**
   - イベントを開く
   - セカンダリユーザーが追加されていることを確認 ✅

## トラブルシューティング

### エラー: "SPREADSHEET_ID environment variable is required"
→ `.env` ファイルに `SPREADSHEET_ID` を設定してください

### エラー: "Unable to parse range: User Mappings!A2:C"
→ シート名が `User Mappings` (大文字小文字正確に) か確認してください

### エラー: "WebHook callback must be HTTPS"
→ ngrok を起動して、HTTPS URLを `.env` に設定してください

### Webhook通知が届かない
→ ngrok のWeb UI (`http://127.0.0.1:4040`) でリクエストが届いているか確認

### セカンダリユーザーが追加されない
1. Spreadsheet のマッピングが正しいか確認
2. マッピングを手動リロード：
   ```bash
   node -e "fetch('http://localhost:3000/admin/reload-mappings', {method: 'POST'}).then(r => r.json()).then(console.log)"
   ```

## 詳細ドキュメント

- 完全なテスト手順: [TESTING.md](TESTING.md)
- アーキテクチャ詳細: [README.md](README.md)
- 仕様書: [specs/001-calendar-cross-workspace-sync/](specs/001-calendar-cross-workspace-sync/)

---

**🎉 以上でセットアップ完了です！カレンダーイベントで自動同期をお試しください。**
