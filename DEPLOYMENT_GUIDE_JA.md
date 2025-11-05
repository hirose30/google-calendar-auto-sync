# デプロイガイド - 運用改善機能

このガイドでは、Firestore統合とminScale=0サポートを含む運用改善機能をデプロイする手順を説明します。

## 前提条件

- ✅ 既存のcalendar-syncサービスがCloud Runにデプロイされている
- ✅ `gcloud` CLIがインストールされ、認証済み
- ✅ Google Cloudプロジェクトで課金が有効化されている
- ✅ サービスアカウントがCalendar API + Sheets APIへのアクセス権を持っている

## デプロイ手順

### ステップ1: Firestoreのセットアップ (5-10分)

#### 1.1 Firestoreが既に有効化されているか確認

```bash
PROJECT_ID="your-project-id"  # 実際のプロジェクトIDに置き換えてください

gcloud firestore databases list --project=${PROJECT_ID}
```

既存のデータベースが表示された場合は、ステップ1.3にスキップしてください。

#### 1.2 Firestore APIを有効化してデータベースを作成

```bash
# APIを有効化
gcloud services enable firestore.googleapis.com --project=${PROJECT_ID}

# Firestoreデータベースを作成（Nativeモード）
gcloud firestore databases create \
  --location=asia-northeast1 \
  --type=firestore-native \
  --project=${PROJECT_ID}
```

#### 1.3 Firestoreインデックスを作成

```bash
# 更新クエリ用のインデックス（expiration + status）
gcloud firestore indexes composite create \
  --collection-group=watchChannels \
  --query-scope=COLLECTION \
  --field-config field-path=status,order=ASCENDING \
  --field-config field-path=expiration,order=ASCENDING \
  --project=${PROJECT_ID}

# 単一フィールドインデックス（expiration）
gcloud firestore indexes fields update expiration \
  --collection-group=watchChannels \
  --enable-indexes \
  --project=${PROJECT_ID}
```

**期待される出力**: "Created index" または "Index already exists"

**確認**:
```bash
gcloud firestore indexes composite list --project=${PROJECT_ID}
```

---

### ステップ2: サービスアカウントへの権限付与 (2分)

#### 2.1 Cloud Runサービスアカウントのメールアドレスを取得

```bash
# デフォルトのcompute service accountを使用している場合
PROJECT_NUM=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")
SA_EMAIL="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

echo "サービスアカウント: ${SA_EMAIL}"
```

#### 2.2 Firestoreアクセス権を付与

```bash
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user"
```

**期待される出力**: "Updated IAM policy for project"

**確認**:
```bash
gcloud projects get-iam-policy ${PROJECT_ID} \
  --flatten="bindings[].members" \
  --filter="bindings.members:${SA_EMAIL}" \
  --format="table(bindings.role)"
```

`roles/datastore.user`が表示されるはずです。

---

### ステップ3: アプリケーションコードの更新とビルド (5分)

#### 3.1 依存関係が既にインストールされていることを確認

```bash
cd /Users/hirose30/Dropbox/dev/private/google-calendar-auto-sync

# package.jsonに@google-cloud/firestoreが含まれているか確認
grep "@google-cloud/firestore" package.json
```

既に含まれている場合（出力がある場合）は、次のステップに進みます。

#### 3.2 アプリケーションをビルド

```bash
npm run build
```

**期待される出力**: TypeScriptのコンパイル成功、エラーなし

---

### ステップ4: Cloud Runへのデプロイ (10分)

#### 4.1 Dockerイメージをビルドしてプッシュ

```bash
# 変数を設定
REGION="asia-northeast1"
SERVICE_NAME="calendar-sync"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Cloud Run用にビルド (linux/amd64)
docker buildx build --platform linux/amd64 -t ${IMAGE_NAME}:latest --push .
```

**期待される出力**: "Successfully built" and "Successfully tagged"

#### 4.2 minScale=1でデプロイ（初回は既存設定を維持）

```bash
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --min-instances 1 \
  --max-instances 1 \
  --set-env-vars "NODE_ENV=production,FIRESTORE_ENABLED=true" \
  --set-secrets "SPREADSHEET_ID=SPREADSHEET_ID:latest" \
  --set-secrets "SERVICE_ACCOUNT_KEY=SERVICE_ACCOUNT_KEY:latest" \
  --project ${PROJECT_ID}
```

**期待される出力**: "Service [calendar-sync] revision [...] has been deployed"

#### 4.3 サービスURLを取得

```bash
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --format='value(status.url)' \
  --project ${PROJECT_ID})

echo "サービスURL: ${SERVICE_URL}"
```

---

### ステップ5: Firestore統合の確認 (5分)

#### 5.1 サービスログでFirestore初期化を確認

```bash
gcloud logging read \
  "resource.type=cloud_run_revision \
   AND resource.labels.service_name=calendar-sync \
   AND jsonPayload.message=~'Firestore'" \
  --limit=10 \
  --format="value(timestamp,jsonPayload.message)" \
  --project ${PROJECT_ID}
```

**期待される出力**: "Firestore client initialized"などのログ

#### 5.2 チャンネル登録を強制してFirestoreにデータを投入

```bash
curl -X POST ${SERVICE_URL}/admin/force-register-channels \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Initial Firestore population"}'
```

**期待される出力**: 登録されたチャンネルを示すJSON

#### 5.3 Firestoreのチャンネルを確認

```bash
gcloud firestore documents list watchChannels \
  --limit=10 \
  --format="table(name,createTime,updateTime)" \
  --project ${PROJECT_ID}
```

**期待される出力**: 9つのwatch channelドキュメントのリスト

---

### ステップ6: 24時間の安定性確認

このステップは**重要**です。すぐにminScale=0に変更せず、まず24時間の安定性を確認してください。

#### 6.1 サービスが正常に動作していることを確認

```bash
# ヘルスチェック
curl ${SERVICE_URL}/health

# チャンネルステータス確認（管理エンドポイント）
curl ${SERVICE_URL}/admin/channel-status \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
```

#### 6.2 ログを監視

```bash
# Firestoreエラーがないか確認
gcloud logging read \
  "resource.type=cloud_run_revision \
   AND resource.labels.service_name=calendar-sync \
   AND severity>=ERROR" \
  --limit=20 \
  --format="value(timestamp,jsonPayload.message)" \
  --project ${PROJECT_ID}
```

エラーがないことを確認してください。

#### 6.3 Webhook通知が正常に機能しているか確認

Googleカレンダーでテストイベントを作成し、Webhook通知が正常に処理されることを確認してください。

---

### ステップ7: minScale=0への変更（コスト最適化） (5分)

**⚠️ 重要**: 24時間の安定稼働を確認した後でのみ実行してください。

#### 7.1 サービスをminScale=0に更新

```bash
gcloud run services update ${SERVICE_NAME} \
  --region=${REGION} \
  --min-instances=0 \
  --project ${PROJECT_ID}
```

**期待される出力**: "Service [calendar-sync] revision [...] has been deployed and is serving 100 percent of traffic"

#### 7.2 15分待ってサービスがスケールダウンするのを確認

```bash
echo "15分待機中（サービスがゼロにスケールするまで）..."
sleep 900  # 15分

# 現在のインスタンス数を確認（0になっているはず）
gcloud run services describe ${SERVICE_NAME} \
  --region=${REGION} \
  --format="value(status.traffic[0].revisionName)" \
  --project ${PROJECT_ID}
```

#### 7.3 コールドスタートをテストするためWebhookをトリガー

```bash
# 手動テスト: Googleカレンダーでテストイベントを作成
# サービスログでコールドスタートのタイミングを確認
gcloud logging read \
  "resource.type=cloud_run_revision \
   AND resource.labels.service_name=calendar-sync \
   AND jsonPayload.operation=start" \
  --limit=5 \
  --format="value(timestamp,jsonPayload.duration,jsonPayload.context.startupPerformance)" \
  --project ${PROJECT_ID}
```

**期待される出力**: コールドスタートを含めて5秒以内にWebhookが処理される

---

### ステップ8: コスト削減の確認（7日間モニタリング）

#### 8.1 デプロイ前後のCloud Runコストを確認

```bash
# 現在の日付
echo "デプロイ日: $(date)"
echo "7日後に請求ダッシュボードでコスト削減を確認してください"
echo "期待値: $25/月 → $3/月 (87%削減)"
```

#### 8.2 請求アラートの設定（オプション）

Cloud Console > Billing > Budgets & Alertsにアクセス
- "Cloud Run"サービスのアラートを作成
- しきい値: $5/月（この値を大幅に下回るはずです）

---

## 確認チェックリスト

デプロイ後、すべてのコンポーネントを確認してください：

- [ ] **Firestore**: データベースが作成され、インデックスが構築されている
- [ ] **権限**: サービスアカウントが`roles/datastore.user`を持っている
- [ ] **デプロイ**: Firestoreクライアントでサービスがデプロイされている
- [ ] **チャンネル登録**: `/admin/force-register-channels`がFirestoreにデータを投入した
- [ ] **Firestoreデータ**: Firestoreに9つのwatch channelドキュメントが存在する
- [ ] **minScale=0**: 15分のアイドル後にサービスがスケールダウンした
- [ ] **コールドスタート**: コールドスタート後にWebhook処理が機能する（<5秒）
- [ ] **ログ**: 構造化JSONログにFirestore操作が表示される

---

## ロールバック手順

問題が発生した場合は、以前の状態に戻します：

### 即座のロールバック（minScale=1に戻す）

```bash
gcloud run services update ${SERVICE_NAME} \
  --region=${REGION} \
  --min-instances=1 \
  --project ${PROJECT_ID}
```

### 完全なロールバック（Firestoreを無効化）

```bash
# Firestoreなしで以前のバージョンを再デプロイ
gcloud run services update ${SERVICE_NAME} \
  --region=${REGION} \
  --set-env-vars "FIRESTORE_ENABLED=false" \
  --min-instances=1 \
  --project ${PROJECT_ID}
```

**サービスは引き続き動作します**: インメモリのChannelRegistryがまだ機能し、Firestoreはオプションです。

---

## モニタリング

**最初の7日間の日次モニタリングタスク**:

### 1. スケジュールジョブが実行されたことを確認

```bash
# まだCloud Schedulerをセットアップしていない場合は、手動で更新をトリガー
curl -X POST ${SERVICE_URL}/admin/renew-expiring-channels \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

### 2. Webhookサブスクリプションがアクティブであることを確認

```bash
curl ${SERVICE_URL}/admin/channel-status \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
```

### 3. エラーがないかサービスログを確認

```bash
gcloud logging read \
  "resource.type=cloud_run_revision \
   AND resource.labels.service_name=calendar-sync \
   AND severity>=ERROR" \
  --limit=10 \
  --format="value(timestamp,jsonPayload.message)" \
  --project ${PROJECT_ID}
```

### 4. 請求トレンドを確認

- Cloud Console > Billing > Cost Tableにアクセス
- フィルター: Service = "Cloud Run"
- 日次コストが減少していることを確認

---

## トラブルシューティング

### 問題: "Firestore database not found"

**解決策**:
```bash
# Firestoreが作成されたことを確認
gcloud firestore databases describe --project=${PROJECT_ID}

# 存在しない場合は、データベースを作成
gcloud firestore databases create \
  --location=asia-northeast1 \
  --project=${PROJECT_ID}
```

### 問題: "Permission denied on Firestore"

**解決策**:
```bash
# 権限を再付与
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user"
```

### 問題: コールドスタートが5秒を超える

**解決策**:
```bash
# Firestore初期化時間を確認
gcloud logging read \
  "jsonPayload.operation=~'Firestore' AND jsonPayload.duration" \
  --limit=10 \
  --project=${PROJECT_ID}

# Firestore が遅い場合は、キャッシング戦略を検討
```

---

## 次のステップ

デプロイが成功した後：

1. **7日間モニタリング**: コスト削減と安定性を確認
2. **Cloud Schedulerのセットアップ**: 自動更新ジョブを設定（別途ドキュメント参照）
3. **アラートの設定**: エラーとジョブ失敗のCloud Monitoringアラート
4. **ランブックの文書化**: 一般的な問題のオペレーター手順

---

## まとめ

**デプロイされたもの**:
- ✅ Webhook subscriptionの永続状態管理用Firestore
- ✅ オンデマンド起動用のminScale=0サポート（87%コスト削減）
- ✅ 手動サブスクリプション管理用の管理エンドポイント
- ✅ 包括的なロギングとエラーハンドリング

**期待される結果**:
- 月額コスト: $25 → $3 (87%削減)
- サブスクリプション可用性: 99.9%+
- コールドスタート: <5秒 (p95)
- ゼロ手動操作（自動更新は別途セットアップが必要）

**問題が発生した場合**:
- すぐにminScale=1にロールバック
- サービスは引き続き機能します（Firestoreはオプション）
- サービスログと共にサポートに連絡
