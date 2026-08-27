# Outing 2026 V1

Outing 2026 (2026-10-25〜26) 用のNext.js + Supabase Web/PWAプロトタイプ。

## 現在入っている機能

- 参加者: 匿名Auth → 名前選択Claim → 端末ロック
- 運営: メール/パスワード → `/admin` 管理画面
- 管理画面: Mission Drop、Stream投稿、参加者ロック解除
- Mission撮影: ブラウザ内カメラ、前後切替、対応端末のtorch、撮り直し
- 画像圧縮: 長辺最大1800px / WebP quality 0.82
- 投稿: 1投稿1枚、メンション、コメント30文字、Stream/Gallery選択
- Private Storage + Signed URL
- Stream / My Gallery / 他人プロフィールGallery
- ハート、自分の投稿は不可
- Point Top 5 / My rank RPC
- Connection / 初回Mission得点 / 削除時得点取消
- Admin Stream
- 90日写真保存を前提としたDB設定

## 1. Install

```bash
npm install
```

この同梱版はバージョンを固定しています。

- Next.js 16.3.3
- React / React DOM 19.2.8
- @supabase/ssr 0.12.4
- @supabase/supabase-js 2.112.3
- TypeScript 5.9.3

## 2. Environment

`.env.example` を `.env.local` にコピー。

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_EVENT_ID=YOUR_OUTING_2026_EVENT_UUID
```

## 3. Supabase migrations

SQL Editorで番号順に実行。

1. `supabase/migrations/001_core_schema.sql`
2. `supabase/migrations/002_security_core.sql`
3. `supabase/migrations/003_storage_and_rankings.sql`
4. `supabase/migrations/004_social_stream_profiles.sql`
5. `supabase/migrations/005_auth_and_participant_lock.sql`

`001` 実行後にOuting 2026のevent UUIDを確認し、`.env.local` の `NEXT_PUBLIC_EVENT_ID` に設定。

```sql
select id, name, starts_at, ends_at, status
from public.events
where name = 'Outing 2026';
```

## 4. Supabase Auth設定

### 参加者

Supabase Dashboard → Authentication → Providers / Sign In settings で **Anonymous Sign-Ins** を有効化。

参加者は `/join` で匿名Authを作成し、名簿から名前を選択する。Claim後はそのAuth userとparticipantが1対1でロックされる。

### 運営

Supabase Authenticationで運営5人程度のメール/パスワードAuth userを作成する。

その後 `auth.users.id` を `public.admin_users.auth_user_id` に登録。

例:

```sql
insert into public.admin_users (
  event_id,
  auth_user_id,
  display_name,
  role,
  can_manage_missions,
  can_manage_stream,
  can_manage_photos,
  can_manage_awards,
  can_manage_guide,
  can_manage_participants
)
values (
  'EVENT_UUID',
  'AUTH_USER_UUID',
  '運営 太郎',
  'admin',
  true,true,true,true,true,true
);
```

運営入口は `/admin/login`。

## 5. 名簿投入

名簿完成後、参加者名を `participants` に投入。

```sql
insert into public.participants (event_id, name)
values
  ('EVENT_UUID', '山田 太郎'),
  ('EVENT_UUID', '佐藤 花子');
```

本番はCSV importでもOK。

## 6. EventをLiveにする

投稿・ハートは `events.status = 'live'` のときだけ動く。

```sql
update public.events
set status = 'live'
where id = 'EVENT_UUID';
```

終了後は管理画面からArchive切替を実装予定。現状DBでは次で切替可能。

```sql
update public.events
set status = 'archive'
where id = 'EVENT_UUID';
```

## 7. Run

```bash
npm run dev
```

カメラは `localhost` またはHTTPS環境で利用可能。本番はVercel等のHTTPSへデプロイする。

## 8. Verify

```bash
npm run typecheck
npm run build
```

## Important

- `outing-photos` はprivate bucket。
- Service Role keyはブラウザへ置かない。
- 写真投稿のポイント/Connection処理はRPC内で行う。
- 投稿削除はsoft delete + point transaction revoke。
- Connectionは写真削除後も残す（交流した事実は維持）。
- 写真ファイルの90日後の実削除ジョブはまだ未実装。Archive管理と合わせて次フェーズで追加する。

## Supabase実接続セットアップ

実環境への接続手順は [`SETUP_SUPABASE.md`](./SETUP_SUPABASE.md) を参照。

テスト用SQL:

- `supabase/setup/001_test_data.sql` — 仮参加者15人＋仮Guide/Schedule
- `supabase/setup/002_link_admin_template.sql` — 既存AuthユーザーをAdminへ紐付け
- `supabase/setup/003_verify_setup.sql` — DB/RPC/Storageの検証

環境変数チェック:

```bash
npm run check:config
```

## Migration 006 — hardening
Run `supabase/migrations/006_hardening.sql` after 001–005.

It adds:
- old-session revocation when an admin unlocks a participant name;
- a configurable per-event mention cap (`max_mentions_per_post`, default 12);
- explicit no-auto-promotion behavior when the first CLEAR photo is deleted;
- per-photo 90-day retention timestamps;
- a scheduled Edge Function template at `supabase/functions/retention-cleanup/index.ts` for deleting expired Storage files and their DB rows.

The retention Edge Function requires a server-side service-role secret and must never expose that key to participant/admin browser code.

## Reliability update (Migration 007)
- First-use photo/privacy consent is required before participant Claim completes.
- Camera posts are persisted to IndexedDB before network I/O. Offline/network-failed posts retry automatically when the browser comes online.
- Every post uses a UUID `client_request_id`; retries return the same DB post instead of awarding points twice.
- Delete operations write immutable reason/audit records. The first-CLEAR post can be deleted, but older posts are never auto-promoted; only a later new post can earn the mission again.
- Point ties share the same rank; within a tie the earlier score-change time is displayed first. Heart Top10 uses the same-rank rule.

- Run `008_security_storage_cleanup.sql` after 007. It closes ranking RPC access and lets authorized deletions remove the private Storage object.
