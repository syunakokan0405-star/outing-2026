# UI調整の統合

適用元: fd16ab4（共有キャッシュとエグレス削減の適用後）。以前のouting-ui-fixes.zipは53a8e19を元にしているため、その全ファイルを最新版へ上書きせず、UI差分だけを3-way mergeして統合した。

含まれる変更：

1. 背景をfixedの独立した描画レイヤーへ移し、モバイルのアドレスバー開閉で高さを変更しにくい100lvhを使用。コンテンツ、通知、モーダルの既存の重なり順を保持する。
2. Home・Guide・Missions・Stream・My Page・公開ProfileのOUTING 2026を、Guide基準の共有ヘッダーへ統一する。
3. My PageのConnectionsダイアログを画面中央へ移す。
4. HomeのMissionカード内の文字を上側へ配置する。CTAは下側を維持する。
5. 数字だけローカルWOFFフォントを使い、参加者ページの数字を統一する。英語・日本語のフォントは保持する。フォントのライセンスを同梱する。
6. Missionフィルターの表示をINCOMPLETE / COMPLETEへ変更する。内部のfilter値・URLは維持する。

データ取得、画像キャッシュ、Realtime処理、通知差分更新、投稿RPC、SQLはこの追加パッチで変更しない。SQL実行・追加パッケージ導入は不要。

検証：TypeScript、既存28テスト、ダミー接続設定でのNext.js本番ビルドを確認。実サービスのログイン済み動作は未検証。ブラウザ本体のダウンロードが失敗したため、スクリーンショットによる視覚検証は未実施。実端末で背景スクロール、見出し、Connections、HomeのMissionカード、フィルター表示を確認すること。

Windows CMDで、パッチをDownloadsへ保存して適用する：

```bat
cd /d C:\Users\syuna\Downloads\outing-2026
git apply --check ..\outing-ui-latest.patch
git apply ..\outing-ui-latest.patch
npm run typecheck
```

エラーがなければ、以下のファイルだけを追加してコミット・pushする。生成されるtsconfig.tsbuildinfoは追加しない。

```bat
git add app components/ParticipantHeader.tsx public/fonts docs/ui-integration.md
git commit -m "Apply UI adjustments while preserving egress optimizations"
git push
```

この作業からGitHubへのpush・Vercelへの本番反映は行っていない。
