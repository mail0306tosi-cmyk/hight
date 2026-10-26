# HIGHT

スマートフォン向けの標高測定・友達共有Webアプリです。HTML/CSS/JavaScriptとFirebase Authentication・Cloud Firestoreを使います。Analytics、Storage、Cloud Functions、課金サービスは利用しません。

**2026年10月26日：本番Firestoreルールは別担当が公開後の全文SHA一致を確認済みです。Firebase連携版コードのGitHub反映・Pages公開は未実施で、承認待ちです。** 詳しい変更内容と確認状況は [REVIEW.md](REVIEW.md) を参照してください。

## 開発

Node.js 24とJava 21（Firestoreエミュレーター用）を使います。

```sh
npm ci
npm run build
npm run check
python3 -m http.server 8000 --bind 127.0.0.1
```

`app.js` は位置情報による標高測定、`sns.js` は画面の状態管理、`firebase-client.js` はFirebaseの操作です。`firebase-config.js` はFirebase Webアプリの公開用設定です。秘密鍵や管理者資格情報は含めません。

`npm run build` がFirebase SDKも含めて `index.html` に埋め込み、CSPのSHA-256ハッシュを更新します。基準URLのないHTMLプレビューでも外部JS/CSSの参照に依存しません。ソース変更後は必ず再ビルドしてください。設定を含めたHTMLが配信物なので、`main` へ反映すると既存のGitHub Pagesが公開する点に注意してください。

スマートフォンの位置情報にはHTTPSとブラウザー・端末の位置情報許可が必要です。標高は端末の海抜高度の目安で、0m・負の値も扱います。取得できない端末・環境もあります。API無応答は画面側で25秒後に失敗と表示します。アプリは緯度・経度を読み取りません。端末/OSによる測位自体の仕組みはブラウザーの仕様によります。

## Firebase設定と本番適用前の準備

プロジェクトは `hight-502cc`、Firestoreは東京リージョン、Sparkプランを維持します。新しいクラウドサービスやプラン変更は不要です。

- Authenticationのメール・パスワード認証を有効にします（ユーザー確認済み）。
- Authentication → Settings → Authorized domains に `mail0306tosi-cmyk.github.io` があることを確認してください。パス `/hight/` は含めません。
- Authenticationのメールテンプレート（確認メールの送信元/表示名/言語）を確認してください。メールリンクはFirebase標準の確認画面を使い、アプリに戻って確認状態を更新します。
- APIキーにHTTPリファラー制限がある場合は公開サイトが許可されていることを確認してください。APIキーはWeb公開用で、データ保護はAuthenticationとFirestoreルールで行います。
- 本番ルールは別担当が適用後に再読み込みし、現行firestore.rulesのSHA-256一致を確認済みです。この開発環境では本番ルールの再適用や変更を行いません。Pages未公開でも、条件を満たす直接API操作はルールに従い可能になります。

## テスト

本番資格情報を使わない `demo-hight` のエミュレーターを使います。本番のルールやデータは変更しません。

```sh
# ローカルHTTPサーバーがポート8000で起動した状態で、位置情報の20シナリオ
npm run test:browser
# Firestoreルール（AuthエミュレーターとFirestoreエミュレーター）
npm run test:rules
# SNSの画面操作（Firebaseクライアントは模擬）
npm run test:ui
# Authだけのブラウザーテスト（Firestore失敗は意図的に模擬）
npm run test:auth
# 実SDK・実エミュレーターの2ユーザー統合テスト
npm run test:integration
```

`CHROMIUM_PATH` でChromiumの実行ファイル、`HIGHT_TEST_URL` で測定テストのサーバーURLを変更できます。標高はテスト時のみ模擬値を使います。Firestoreエミュレーター初回起動時には `storage.googleapis.com` から公式JARの取得が必要です。

環境内のホームが書き込み不可の場合の例：

```sh
npm ci --cache /tmp/hight-npm-cache
FIREBASE_EMULATORS_PATH=/workspace/hight/.cache/emulators XDG_CONFIG_HOME=/workspace/hight/.cache/config npm run test:rules
```

テスト用ビルドは別ファイル（`.cache/`）に作り、`demo-hight` のlocalhostのエミュレーターにだけ接続します。本番 `index.html` をエミュレーター接続用に上書きすることは防いでいます。

## 共有とプライバシー

メール確認前はFirestoreの読み書きを拒否します。確認済みユーザーがプロフィールを保存すると招待コードを発行します。公開プロフィールはnicknameだけ、招待コードは本人専用のprivateProfiles文書へ保存します。旧形式は本人の保存操作でコードを維持して原子的に移行し、移行前は友達に旧プロフィールを公開しません。申請は受信者だけが承認/拒否でき、承認前に標高を読むことはできません。

新規ユーザーには共有ドキュメントがなく初期状態は非公開です。共有の準備をオンにするだけ・再測定だけ・ログインだけでは標高を送信しません。「標高を共有」で測定済みの高度と測定時刻を送信し、サーバーの更新時刻と一緒に保存します。緯度・経度、メールアドレス、ニックネームなどを共有ドキュメントに追加することはルールでも拒否します。

共有停止は共有ドキュメントを削除し、友達からの読み取りを拒否します。友達解除は関係ドキュメントを削除して双方向のアクセスを拒否します。ログアウトは先に共有削除の完了を待ちます。停止に失敗した場合はログアウトを完了扱いにせずエラーを表示します。画面を閉じただけでは共有中の値は消えません。すでに相手が見た情報は後から取り消せません。

Firestoreはメモリーキャッシュのみで、ブラウザーへの永続キャッシュは有効にしません。友達の標高はサーバー確認済みスナップショットだけを表示し、共有停止やアクセス拒否の通知時に古い値を消去します。関係変更時には一覧を消し、友達の共有リスナーも解除します。キャッシュ由来の値や解除後の遅延通知を再表示しません。停止による権限エラーで終了したリスナーは、相手が共有を再開しても自動復帰しないため、更新ボタンで再購読してください。通信断や通知待ちの間は表示の遅延があり、すでに閲覧された値の取り消しはできません。


共有停止/ログアウトが失敗・未確認の場合、共有値が残って友達に読まれる可能性を赤い警告に表示します。共有/削除の応答が12秒ない場合も操作は取り消されません。後から反映される可能性を案内し、新たな共有を抑止しつつ停止の再試行を可能にします。サーバーで削除が確定した場合だけ停止済みに戻し、遅延成功で自動ログアウトはしません。

24h期限は検討案のみです。`proposals/firestore-24h.rules` は現行ルールとは別で、firebase.jsonから参照しません。採用可否・実装/UI・適用の承認待ちです。APIキー25 API制限とreferrer/CSPの方針は維持し、AuthenticationのPagesドメイン追加も操作準備だけです。
