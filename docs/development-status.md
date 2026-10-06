# Outing 2026 開発現在地

更新日: 2026-10-06（JST）
調査元: GitHub syunakokan0405-star/outing-2026、HEAD f76874d8b9b14d3f02d535ab6c9b9ddc4b862289。

## 今回の修正（ローカル実装済み、未公開）

- Homeランキング・Stream・公開プロフィールの画像取得をR2へ対応。従来のSupabase JPGアバターは旧方式で読込。
- R2保存先を更新ごとのUUIDキーに変更。Meの端末キャッシュは参加者ID＋画像キーで管理。
- プロフィール変更時に再取得。Stream・公開プロフィールはparticipantsのRealtime更新も購読。
- DB保存は所有者と画像キーを検証するset_my_avatarに統一。RPC失敗時の直接UPDATEは廃止。
- 隠しポイントRPCの失敗を画面に表示。50点を維持し、event_id保存と参加者行ロックによる二重付与防止を追加。

## 原因

保存先はR2だがHome・Stream・公開プロフィールはSupabase Storageの署名URLを生成していた。Streamはparticipants更新を購読せず、MeのキャッシュとR2保存先は参加者ごとに固定されていた。

## 検証

アバター取得テスト3件（新旧画像の混在、R2障害、150件上限での分割）と型チェック成功。本番ビルドのコンパイルと型チェックは成功。ページデータ収集はR2環境変数不足で停止。本番DB・R2資格情報・ログイン済みセッションがないため、実際の保存とポイント付与は未検証。

## 2026-10-06 DB定義確認と追加修正

ユーザーが提示した本番RPC定義を確認した。

- set_my_avatarはavatars/{参加者ID}/avatar.jpgだけを許可していた。R2の固定WebP・UUIDごとのWebPと旧JPGを許可するSQLを追加。
- claim_profile_photo_bonusの点数は50。event_idがINSERTに含まれていない。リポジトリのpoint_transactionsはevent_id必須で、ランキングのイベント別集計にも必要。
- ON CONFLICT DO NOTHINGだけでは重複防止を保証できないため、参加者行をロックし、既存profile_photo_bonusがあれば0を返す。非アクティブ化された付与も再付与しない。
- reasonの単一列CHECKは既存許可値を維持してprofile_photo_bonusを許可する。本番の全制約は未確認。
- 過去の付与や重複データを自動修正しない。
- 現行フロントと同じく写真保存後に申請する。カメラ限定条件は追加していない。

追加SQL: supabase/migrations/012_profile_avatar_bonus.sql

PostgreSQL（PGlite）の再現用スキーマで、保存キー検証・初回50点・再申請0点・無効化済み付与の再申請0点・event_id保存・認証/非アクティブ参加者拒否・関数権限・既存reason維持・SQL再実行を検証して成功。これは本番データでの検証ではない。

## 適用手順

1. 012_profile_avatar_bonus.sqlの全文をSupabase SQL Editorで実行。
2. 更新版docs/profile-photo-fix.patchを既存コードへ適用し、GitHub/Vercelへ反映。
3. ログイン済み環境で写真保存→Home→Stream→公開プロフィール、別端末表示を確認。
4. 未付与参加者で50点、写真再設定時は加点なしを確認。

本番DB・GitHub・Vercelにはこの作業から変更していない。

## 保留

新しい画像キー方式では過去のR2オブジェクトが残るため、不要画像の削除・保持期間は別途検討する。
