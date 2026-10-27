# HIGHT UIリニューアル（ローカル・未公開）

## 基準と範囲

2026-10-27、GitHub mainを読み取りfetchして `7ad1179bf8c2d6e7b0374eafb8cc84a6dfa7a86d` と一致を確認した上で、ローカルブランチ `feature/futuristic-ui` で実装。参考画像はこの会話の実行コンテキストにはなく、ユーザー指定の配色と「近未来 × アウトドア」を基にデザインした。

GitHub push/merge、Pages公開、Firebase設定・本番ルール・本番データ・Spark/課金の変更は一切なし。測定の中央値・標本採用・精度診断・共有イベントpayloadとFirestore schemaは維持。

## 画面

- ホーム：自分の参考高度を大きく表示。山の線画、進捗、停止/再測定、精度・ばらつき・警告、明示共有と共有停止、診断へのリンク。友達カードはホームに出さない。ログイン前はアカウントへの案内。
- 友達：承認済み1人1カード。ニックネーム、サーバー確認済みの高度、最終共有日時、測定日時、共有中/非公開/確認待ち/確認不可を区別。承認申請、本人招待コード、招待コード入力、解除・表示更新をこの画面に配置。カードを先に見せ、招待コードへはページ内リンクで移動できる。
- 履歴：準備画面のみ。履歴保存、グラフ、仮の履歴は実装しない。
- 設定：ログイン/新規登録、メール確認・再送、プロフィール編集、停止付きログアウト、既存の測定診断とプライバシー説明。
- 下部4項目ナビ：選択状態、キーボード操作、移動先見出しへのフォーカス、セーフエリア余白。画面移動だけでは測定/共有を開始しない。アプリ内タブ移動は測定を中断しないが、OSでの背景移行・pagehide時の監視終了は従来どおり。

## 友達の並べ替えとプライバシー

共有中はupdatedAt降順。同時刻なら日本語の名前順、さらにUIDで安定化。非公開/サーバー未確認/取得不可は下にまとめ日本語名順。非同期の共有/名前取得のたびに順序を更新する。プロフィール・共有の遅延応答は既存generation検証を維持。共有停止・権限エラー・キャッシュのみの通知で高度と精度を消去し、確認できない値は表示しない。

現行の共有schemaには精度フィールドがないため、実際の友達に精度は表示されない。描画処理は共有データに有効なaltitudeAccuracyが存在する場合だけ精度を表示できるが、これを送信する処理やschema/ルールの変更は追加していない。精度の条件表示テストは模擬データのみ。

共有停止失敗の警告は全画面に共通表示し、設定画面でのログアウト失敗時にも見失わない。停止未確認・未完了書き込みのリスク、閉じても最後の共有値が残る説明は維持。診断情報、緯度経度、端末情報を共有データに追加しない。

## 表示・テスト方針

320/390/768/1280pxで4画面の横はみ出しと下部ナビ位置をChromiumで確認。スマホ390pxとPC1280pxで8枚のスクリーンショットを保存。画像は模擬ログイン・模擬友達・模擬測定値であり本番アカウント/データではない。

既存の操作回帰テストには `tests/screen-navigation.cjs` を追加。対象要素の画面へ実際のナビボタンを押して移動してから操作する（hidden属性、認証状態は書き換えない）。画面分離・キーボード操作自体は、ヘルパーを使わない新規 `tests/redesign-ui.cjs` で検証する。

最終テストは以下のとおり全成功（各終了0）。Firebase関連テストはすべてdemo-hightエミュレーターのみ。

| コマンド/対象 | 成功数 |
| --- | --- |
| `HIGHT_TEST_URL=http://127.0.0.1:8016 npm run test:browser` | 測定・診断42シナリオ |
| `npm run test:ui` | SNS画面7グループ |
| `node tests/redesign-ui.cjs`（`npm run test:redesign`でも実行可） | 新UI6グループ |
| `node --test tests/firestore.test.cjs` | ルール21件、失敗/skip 0 |
| `node tests/firebase-browser.cjs` | 実SDK統合13グループ |
| `node tests/auth-browser.cjs` | Auth6グループ |
| `npm run check`、`git diff --check` | HTML/SDK/CSP同期・差分形式OK |

エミュレーター実行コマンド：`XDG_CONFIG_HOME=/tmp/hight-diagnostic-config FIREBASE_EMULATORS_PATH=/tmp/hight-diagnostic-emulators CI=1 npx firebase emulators:exec --project demo-hight --only firestore,auth 'node --test tests/firestore.test.cjs && node tests/firebase-browser.cjs && node tests/auth-browser.cjs'`。

最終ログ：`/tmp/hight-redesign-final-geo.log`、`/tmp/hight-redesign-final-social.log`、`/tmp/hight-redesign-final-emulators.log`、`/tmp/hight-redesign-new.log`。
スクリーンショット：`/workspace/hight-review/ui-redesign/{home,friends,history,settings}-{390,1280}.png`。初回確認後、測定ボタンと友達カードを先に見せるレイアウト調整を行い、その最終状態で上記回帰テストを再実施済み。

ルール、Firebase設定、クライアントの送受信処理はmainとの差分なし。本番用ビルドにテストfixtureを含めていない。

## 実機で残る確認

- iPhone Safari/Chrome、Android Chromeの実際のセーフエリア・ソフトキーボード・文字拡大・画面回転。
- 実GPS測定、背景移行と再測定、診断の精度・欠測表示。約27m差を補正する変更はない。
- 少人数テストで実メール確認、友達申請、手動共有、共有停止/解除、オフライン時の警告と復帰。
- ブラウザー/OSの高度基準や端末精度の違いはこのUI変更では解決しない。
- 表示切り替えはページ内UIのみで、ログイン持続・共有継続の仕組みは従来どおり。新しい履歴/ナビ状態の永続保存はない。
