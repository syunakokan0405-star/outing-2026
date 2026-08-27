# Outing 2026 — Supabase実接続セットアップ

この手順は、Outing 2026 V1を**新規Supabaseプロジェクトに接続してスマホ実機テストできる状態**にするためのものです。

## 1. Supabaseプロジェクトを作成

Supabaseで新規プロジェクトを作成します。Webアプリでは **Project URL** と **Publishable key (`sb_publishable_...`)** を使います。Secret key / service role keyはブラウザへ絶対に入れません。

## 2. Migrationを実行

Supabase DashboardのSQL Editorで、次を番号順に実行します。

1. `supabase/migrations/001_core_schema.sql`
2. `supabase/migrations/002_security_core.sql`
3. `supabase/migrations/003_storage_and_rankings.sql`
4. `supabase/migrations/004_social_stream_profiles.sql`
5. `supabase/migrations/005_auth_and_participant_lock.sql`

## 3. テストデータを投入

本番名簿がまだないので、開発環境では次を実行します。

`supabase/setup/001_test_data.sql`

15人のテスト参加者と、仮Schedule / Guideが入ります。末尾に表示される `event_id` を控えます。

## 4. Anonymous Sign-Insを有効化

Supabase DashboardのAuthentication設定で **Anonymous Sign-Ins** を有効化します。

参加者は `/join` を開くと匿名Authが作られ、その後名前を1つClaimします。Claimされた名前は別端末から選択できなくなります。

## 5. 運営テストユーザーを作成

Authentication > Usersからメール/パスワードのテスト運営ユーザーを1人作成します。

次に `supabase/setup/002_link_admin_template.sql` の `CHANGE_ME@example.com` をそのメールに変更してSQL Editorで実行します。

## 6. `.env.local` を作成

`.env.example` をコピーして `.env.local` を作ります。

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_EVENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## 7. EventをLiveにする

写真投稿・ハートはイベントが `live` の間だけ動きます。テスト開始時にSQL Editorで実行します。

```sql
update public.events
set status = 'live'
where id = 'YOUR_EVENT_ID';
```

テスト終了後は `draft` に戻して構いません。本番終了時のArchiveは管理画面から手動切替する予定です。

## 8. DBセットアップを検証

`supabase/setup/003_verify_setup.sql` を実行します。

最低限、以下が期待値です。

- participant_count: 15
- admin_count: 1以上
- private_photo_bucket_exists: true
- claim_rpc_exists: true
- submit_rpc_exists: true
- drop_rpc_exists: true

## 9. ローカル起動

```bash
npm install
npm run check:config
npm run typecheck
npm run dev
```

ブラウザで確認します。

- 参加者: `http://localhost:3000/join`
- 運営: `http://localhost:3000/admin/login`

カメラはlocalhostでは利用できます。本番・実機ではHTTPSで公開します。

## 10. 最初の実機テスト

最低2台のスマホを用意すると確認しやすいです。

1. 端末Aで「テスト 01」をClaim
2. 端末Bで「テスト 02」をClaim
3. 管理画面からMission Dropを作成
4. 端末AでMissionを開く
5. カメラ撮影 → テスト02をメンション → 投稿
6. 端末BでStream / Galleryに写真が見えることを確認
7. 端末Bから❤️を押す
8. 端末Aでハート数が更新されることを確認
9. 得点・Connectionが反映されることを確認
10. 投稿削除後、初回Mission得点が取り消されることを確認

## 11. 本番名簿が来たら

テスト用参加者を削除してからCSV等で本名簿を投入します。本番前にClaim状態が全員解除されていることを確認します。

## セキュリティ注意

- ブラウザにはPublishable keyだけを入れます。
- Secret key / service role keyを `NEXT_PUBLIC_` 変数へ置かないでください。
- Storageはprivateのまま使います。
- ポイント・Connection更新はDB RPC経由にします。
