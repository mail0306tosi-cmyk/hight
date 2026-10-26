<!-- 最新状態：2026-10-26に別担当が本番ルール公開・全文SHA一致確認。過去の全拒否/未適用記録は履歴。コード公開は未実施。 -->
# Firebase連携版のレビュー

現行のコード/ルールは「招待コード保護・停止失敗の再点検」、最新の監査・ドメイン申告は末尾およびRELEASE_AUDIT.mdを参照してください。過去のルール全文・友達に招待コードが見える記述は改訂前の記録です。実設定は「Firebase実設定の読み取り報告」のUI読み取り報告を参照してください。

## 適用範囲と現在の状態

プロジェクトIDは `hight-502cc`。ユーザーから受け取ったFirebase Webアプリの公開用設定を `firebase-config.js` に設定しました。SDKはnpmの固定バージョンで管理し、配信HTMLに埋め込んでいます。

**本番のルール適用・GitHubへのpush・GitHub Pagesの更新は行っていません。** 現行の公開版はデモ版のままです。現在の本番Firestoreの全拒否ルールも維持しています。本番認証・本番データへの書き込みをテストに使っていません。Sparkからのプラン変更や有料サービスの追加もありません。

## 変更内容

- メール・パスワードの新規登録/ログイン、メール確認の送信/再送、確認後のユーザー再読込・IDトークン強制更新。
- 未確認ユーザーは友達・プロフィール・共有機能を利用できないUIとルール。
- 確認済みユーザーのニックネームと128bitのランダム招待コードをFirestoreに登録。既存のローカルデモのデータは移行・送信しない。
- 招待コードによる申請、受信者だけの承認/拒否、承認済み友達の一覧、友達解除。
- 明示的な共有ボタンのみで高度・測定時刻を送信。サーバーが更新時刻を付与。
- 共有停止は共有ドキュメント削除。ログアウトは先に停止の完了を待つ。通信失敗時は停止/ログアウト成功と表示しない。
- 標高測定は未ログインでも利用でき、Firebase初期化に失敗しても維持。
- サーバー読み取りは12秒で画面に失敗を案内。測位API無応答の25秒監視は維持。
- Firebase SDKの接続先だけをCSPで許可。外部スクリプト/画像/任意の外部接続は許可しない。

## データと権限

ルール全文は [firestore.rules](firestore.rules) です。Firebaseの管理者SDK/コンソールはルールを迂回するため、管理者資格情報をフロントに含めてはいけません。

| パス | 保存するフィールド | 読み取り | 書き込み |
| --- | --- | --- | --- |
| `profiles/{uid}` | `nickname`, `inviteCode` | メール確認済みの本人/承認済み友達の個別取得のみ | 本人が招待コードと同時に作成。更新はニックネームのみ |
| `invites/{code}` | `uid` | メール確認済みユーザーのコード指定取得のみ。列挙不可 | 本人のプロフィールに対応するコードだけ作成。変更/削除不可 |
| `connections/{sender}~{recipient}` | `sender`, `recipient`, `participants`, `status`, `createdAt`, `updatedAt` | 確認済みの当事者のみ。クエリも自分を含む条件が必須 | 送信者がpendingで作成。受信者だけがpending→accepted/rejectedに変更。両当事者は削除可能 |
| `shares/{uid}` | `altitude`, `measuredAt`, `updatedAt` | 確認済みの本人。または共有ドキュメントが存在し、承認済みの友達 | 確認済みの本人のみ。許可フィールド以外を拒否 |

全パスで `request.auth.token.email_verified == true` を要求します。承認済みの友達でも確認済みトークンがなければ取得できません。その他のパスは拒否します。

自己宛申請、送信者による自己承認、第三者の承認、pending以外での作成、逆方向の重複申請、参加者や作成日時の変更、拒否後の直接再承認は禁止です。プロフィールや招待コードの横取り・一覧列挙も禁止します。招待コードだけでは標高を読めません。

標高は数値で -12,000〜100,000m。測定日時はサーバーより未来を拒否し、更新日時には `request.time` と一致するserverTimestampを要求します。緯度・経度・メールアドレスなどの追加フィールドを拒否します。ブラウザーが報告する標高の真偽や、実際のボタンクリックそのものをFirestoreが検証することはできません。UIが送信タイミングを制御し、ルールが所有者・公開範囲・フィールドを制限します。

共有停止後は `shares/{uid}` が存在しないため、友達からの読み取りをpermission-deniedにします。解除後は関係ドキュメントがなく、双方の標高・プロフィールの読み取りを拒否します。共有中の値を既に相手が見た場合、表示・記録済みの情報をサーバーから消去することはできません。

## 更新/キャッシュの仕様

標高の自動送信・バックグラウンド測位・永続キャッシュはありません。Firestoreのキャッシュはメモリーのみです。新規アカウントは共有ドキュメントを持たず、初期非公開です。再ログイン時もトグルはオフで自動送信しませんが、以前に共有して画面を閉じた場合のサーバーの共有値は残り、状態を画面に表示します。

関係の変更と友達の共有状態をFirestoreのリスナーで反映します。サーバー確認済みかつ未確定書込のない共有スナップショットだけを表示します。共有停止や権限失効の通知時に標高を消去し、関係変更時・セッション変更時・手動更新時には友達リスナーを解除して一覧を消します。世代番号によって解除後の遅延応答を無視します。本人の共有状態もリスナーで確認し、未確認を停止済みと表示しません。停止/解除の成功後は新しいサーバー取得を拒否します。

共有停止でpermission-deniedとなったリスナーは終了します。共有再開後の表示は更新ボタンで再購読します。通信断や通知遅延の間に即座の消去を保証するものではなく、相手がすでに見た情報を取り消す機能ではありません。

## 検証

| チェック | 結果 |
| --- | --- |
| HTML生成・CSPハッシュ同期・JavaScript構文 | 成功 |
| 標高測定ブラウザーテスト | 20シナリオ成功。GPS結果は模擬 |
| SNS画面操作（クライアントを模擬） | 5グループ成功。初期オフ、手動送信のみ、承認/解除、停止失敗、ログアウト、スマホ3幅 |
| 実SDK + Authエミュレーター | 6グループ成功。登録、未確認制限、再送、リンク適用/トークン更新、誤パスワード拒否/ログイン、スマホ幅。実メール配送は未検証 |
| Firestoreセキュリティルール | 実Firestoreエミュレーターで17件成功・失敗0・スキップ0 |
| 実SDK + Auth/Firestoreの2ユーザー統合 | 最終点検で12グループ成功。古い実JWTの拒否、登録/確認、手動共有、申請/承認/拒否、双方向の実在値、停止時の表示消去、解除後の拒否、再読込/ログアウト/再ログイン |
| 本番プロジェクト・実機GPS・実メール受信・GitHub Pages | 未検証。本番変更なし |

Authのみのテストでは、Firestoreの接続失敗を模擬しています。失敗時にSDKが試みるGoogleの接続診断画像はCSPで遮断され、外部への応答がないことも確認しました。このテストはFirestoreルールの成功を示しません。

Firestoreルールテストは、未認証/未確認の拒否、プロフィール/招待の整合性、招待の列挙拒否、自己申請/自己承認/改ざん拒否、受信者承認/拒否、申請のクエリ制限、承認前後の閲覧、停止/解除後の拒否、緯度経度等の追加項目拒否、標高/時刻の型と範囲を検証します。監査強化後の実エミュレーターで全17件が成功しました。テストに含まれる条件についての検証であり、本番環境やすべての攻撃パターンを保証するものではありません。

## 開発環境のセットアップ確認（2026年10月25日）

ユーザーのネットワーク設定変更は現在の実行環境にも反映されました。公式配布URLはHTTP 200、Firebase CLIによるFirestoreエミュレーターの取得・起動・ルールテスト・統合テストは成功しています。前回のネットワーク障害は解消済みです。

環境設定の下書きには、実行確認済みの依存関係インストール手順（install_script）と、HTTPサーバー起動・各テストの実行方法（start_skill）を保存しました。保存は確認済みですが、環境の公開・新規タスクへの復元は未確認です。

確認済みの環境はNode.js 24、Java 21、Chromiumです。依存関係の再インストール、生成HTMLの同期確認、HTTPサーバーでの起動とブラウザー検証を行いました。共有値に含まれるGPSデータはテスト用の模擬値で、本番Firebaseへの接続はしていません。

クラウド製品の「セットアップ完了」フラグ・公開ジョブの内部状態は、提供されているツールから取得/変更できません。実行環境の正常動作と公開ボタンの解除は別で、ボタンが解除されたことは未確認です。画面を再読み込みしても同じ表示なら、製品側のセットアップ/公開状態の確認が必要です。本番FirestoreルールやGitHub Pagesを変更して解消する問題ではありません。

## 本番公開の順番（まだ実行しない）

1. ルールテスト・統合テストは完了。変更とルールをレビュー。
2. ユーザーの明示承認後だけ本番ルールを適用。
3. Authenticationの許可ドメイン、メール設定、Sparkプランを確認。
4. 別途公開の了承を得てGitHub Pages用のmainにコードを反映。
5. 実機Chrome/HTTPSで測定・メール確認・別アカウント間の申請/共有/停止/解除を検証。


## 追加監査（2026年10月25日）

監査前HEADは `fd42626`、ローカル `origin/main` および `git ls-remote` のmainは `285c544aa7c54138c3ff67097fa43d7abe8cf7ee`。開始時の作業ツリーは変更なし、レビュー用コミットはmainから2件先行していました。今回もローカルのレビュー用ブランチだけを変更し、push/merge/deployはしていません。`firestore.rules` は今回変更していません。

### 発見と修正

1. 以前は相手の共有停止後、サーバーからの再取得は拒否されても、手動更新まで画面に以前の標高が残っていました。友達の共有リスナーと本人の共有状態リスナーを追加し、拒否通知時に表示を消去するよう修正しました。関係/セッション変更時に購読解除し、遅延コールバックで値が復活しないよう世代番号で防ぎます。
2. 以前の解除テストには、逆方向が存在しない共有文書への拒否だけを確認する箇所がありました。両共有文書を作成し、解除前に双方の実在値を正常取得してから、関係削除後に両文書が残ったまま両方向の取得が拒否されることへ強化しました。
3. ルールテストおよび統合テストのドキュメント取得を `getDocFromServer`、クエリを `getDocsFromServer` に変更し、SDKのキャッシュから成功してしまう余地を排除しました。リスナーの正常値も `fromCache === false` と `hasPendingWrites === false` を要求します。
4. 実Authエミュレーターが発行した確認前のJWTで、実在する招待文書の読み取りを拒否することを確認しました。メールリンク適用後も古いJWTは拒否され、画面の確認状態更新（reload + getIdToken(true)）後はプロフィール作成が成功します。
5. 再読込は共有停止ではありません。既存の共有値が残っている再読込では「サーバーで共有中」と正しく表示し、トグルはオフ、測定値はリセット、自動再送なしを確認しました。明示的ログアウトでは削除の完了を待ち、再ログイン後に共有値がなく共有ボタンも無効であることを確認しました。

### エミュレーターの観測限界

関係文書を削除しただけでは、既存の共有ドキュメントリスナーに即時のpermission-denied通知が届かず、追加テストの初回は17件中1件がタイムアウトしました。これを成功として扱っていません。新しいサーバー取得は解除直後に拒否されます。その後、対象共有文書に新しい値を書き込むと既存リスナーもpermission-deniedとなり、新しい値は配信されないことを確認しました。画面は別の関係リスナーで解除を検出し、標高の購読と表示を消去するため、この通知遅延に依存しません。本番環境でも同じタイミングで通知されると検証したわけではありません。

### 再現コマンドと実行結果

実行前に以下をexportしました。すべて `demo-hight` のエミュレーター専用です。

```sh
export FIREBASE_EMULATORS_PATH=/workspace/hight/.cache/emulators
export XDG_CONFIG_HOME=/workspace/hight/.cache/config
```

| 実行コマンド | 今回の終了結果 |
| --- | --- |
| `npm run test:rules` | 17テスト、pass 17 / fail 0 / skipped 0、終了0 |
| `npm run test:integration` | 11 PASSグループ、終了0（2ブラウザー、実Auth/Firestoreエミュレーター） |
| `npm run test:ui` | 5 PASSグループ、終了0（サービスは模擬、購読解除/遅延通知も検証） |
| `npm run check` | HTML・SDK・CSP同期、終了0 |
| `npm run test:auth` | 6 PASSグループ、終了0（実Authエミュレーター、Firestore失敗は模擬） |
| `HIGHT_TEST_URL=http://127.0.0.1:8006 npm run test:browser` | 標高測定20シナリオ、終了0 |

実行ログは `/tmp/hight-audit-rules.log`、`/tmp/hight-audit-integration.log`、`/tmp/hight-audit-ui.log`。Auth単独は `/tmp/hight-audit-auth.log`、標高測定は `/tmp/hight-audit-geolocation.log` に記録しました。すべて監査後のコードで再実行済みです。

未検証は実機GPS、実メール配送、本番のFirebaseドメイン/APIキー設定、本番ルールの反映、GitHub Pages配信、本番での通知タイミングです。Sparkプラン設定は変更しておらず、有料サービスも追加していません。本番のルール内容はこの監査から読み取って確認したものではなく、ユーザーからの全拒否ルールという情報を前提としています。本番への読み書き・ルール適用はしていません。


## 公開前の最終点検（2026年10月25日）

点検対象は `bbc2b7d93419f9fbde19d8b3b6886896b63422e4`。開始時の作業ツリーはクリーンでした。今回のローカル変更は、この節を含む最終点検コミットに保存します。本番操作・push/merge・課金変更は承認待ちで実行していません。`firestore.rules` の内容は `bbc2b7d` から変更していません。

### 最終変更

共有ボタンの直前に色付きの注意文を設置し、ボタンの `aria-describedby` にも関連付けました。共有成功後・サーバーで共有中と判明した状態にも、同じ意味の文を表示します。

> 画面やアプリを閉じても、最後に共有した標高は承認済みの友達に表示され続けます。止めるには「共有停止」を押してください。新しい標高は自動送信されません。

プライバシー見出しも「緯度・経度は、あなたの端末だけに。」とし、手動で標高を送信する仕様と矛盾しない表現にしました。

スイッチのラベルを「次の標高の送信準備」、未チェック時を「準備なし（共有停止ではありません）」へ変更しました。再読込でチェックが外れても、過去の共有値がサーバーに残っている場合は「サーバーで共有中：…」と注意文を表示し、停止済みと誤解させません。初期HTMLも停止中と決めつけず「サーバーの共有状態は未確認です」と表示します。

通信不明時のサーバー確認中表示、取得失敗時の「停止済みとは確認できていません」、停止失敗時にログアウトを完了しない動作を再検証しました。共有停止の成功はサーバーの削除完了後だけです。既存の関係購読/共有購読の解除、遅延応答の世代番号チェックは維持しています。

### 最終実行結果

前節と同じエミュレーター環境変数を使用し、すべて `demo-hight` のlocalhost環境で実行しました。

| コマンド | 最終点検での結果 |
| --- | --- |
| `npm run build` / `npm run check` | 終了0、HTMLとSDK/CSP同期確認 |
| `npm run test:rules` | 17件成功・失敗0・スキップ0、終了0 |
| `npm run test:integration` | 12 PASSグループ、終了0 |
| `npm run test:ui` | 5 PASSグループ、終了0（通信不明・停止失敗・注意文も追加確認） |
| `HIGHT_TEST_URL=http://127.0.0.1:8007 npm run test:browser` | 20シナリオ成功、終了0 |
| `git diff --check` | 終了0 |

最終ログは `/tmp/hight-final-rules.log`、`/tmp/hight-final-integration.log`、`/tmp/hight-final-ui.log`、`/tmp/hight-final-geolocation.log` です。Auth単独6グループの結果は前回監査時のもので、最終点検では登録/確認/トークン更新を実SDK統合テスト内で再実行しました。

統合テストでは実際に共有者のブラウザータブを閉じ、別ブラウザーの友達が最後の123mをサーバーから取得できることを確認しました。その後新しいタブで再ログインし、共有中の状態・注意文・準備なしの表示を確認し、共有ドキュメントの更新時刻が変わらず自動送信されていないことも検証しました。再読込時の共有中表示、停止後の拒否・表示消去、両側に実在するデータの解除後拒否、古いJWT拒否、自己承認拒否、緯度経度拒否を含みます。

### 残リスク・未検証

- 実機GPS、高度精度、実メールの受信/迷惑メール判定、実機でのアプリ終了は未検証です。タブ終了後の継続を検証したもので、OSの終了挙動すべてを試したわけではありません。
- 本番の許可ドメイン、Web APIキー制限、メールテンプレート、Firestoreの実際の索引/ルール反映は未確認です。エミュレーターの検証は本番反映の証明ではありません。
- 画面/アプリを閉じても最後の共有値はサーバーに残ります。新しい標高の自動測定・自動送信はしません。停止には接続とサーバー削除の成功が必要です。
- 通信切断・通知遅延中の表示を即時消去する保証はありません。前節のエミュレーターにおける依存文書の失効通知遅延も残ります。新規サーバー取得の拒否と、画面側の購読解除は検証済みです。
- 既読/スクリーンショットなど相手が保存した値を取り消すことはできません。停止による権限エラーで購読が終了した後、再共有の表示には友達側で更新操作が必要です。
- Sparkの無料枠には上限があります。リスナー/手動更新はFirestoreの読み取りを使います。枠超過時にはエラーや制限があり、無料枠の無制限動作は保証しません。課金プランへ変更する処理はありません。

### 承認後の本番操作と順序（現時点では未実行）

1. この最終点検コミットと `firestore.rules` 全文をレビューし、**本番ルール適用について明示承認**を受ける。GitHub Pages公開の承認も別途確認する。
2. Firebaseコンソールで対象が `hight-502cc`、Sparkプラン、東京リージョンであることを確認する。現行の本番ルール全文を日時付きで退避し、全拒否かどうかも実物で確認する。管理者の秘密鍵をソースやチャットに出さない。
3. Authenticationのメール/パスワード設定、許可ドメイン `mail0306tosi-cmyk.github.io`、日本語の確認メール設定、APIキー制限を確認する。Firestoreの `participants` 配列の単一フィールド索引が無効化されていないことも確認する。有料サービスやプラン変更はしない。
4. 承認されたルールだけを本番へ適用し、適用した全文/時刻を記録する。これはアプリ公開とは別の操作。
5. 公開承認済みのレビューコミットをGitHubのmainへ反映し、GitHub Pagesのデプロイ成功とHTTPS配信の実体を確認する。ローカルの生成HTMLと配信物の一致も確認する。
6. **本番スモークテストはテスト用アカウント/データ作成の許可を別途得てから**行う。実機Chromeの2アカウントで登録→実メール確認→招待→受信者承認→手動共有→停止→再共有→解除→ログアウトを確認する。許可のない本番テスト書込はしない。
7. 共有ボタン前/共有中/再読込後の注意文と、実機で画面を閉じても最後の共有値が残ることを確認する。最後にテスト共有を停止し、許可された範囲でテストデータ/アカウントを片付ける。

### 問題発生時のロールバック手順（未実行）

- 権限漏れが疑われる場合は公開を止め、ユーザーの承認を得て先にFirestoreを全拒否ルールへ戻す。未確認の古い許可ルールへは戻さない。これはアクセス遮断であり、サーバーの共有値を消す操作ではない。
- アプリだけの不具合なら、問題の公開コミットをrevertするレビュー用変更を作り、承認後に以前の動作確認済みPages内容（現行デモ版は `285c544`）へ戻す。force-push/resetで履歴やユーザーデータを消さない。全拒否のままならFirebase共有は使えないことを表示する。
- 全拒否ルール下ではアプリの停止ボタンも削除できない。保管された共有値を再公開してしまわないよう、再度許可ルールを適用する前に、必要な共有データ整理/移行について明示承認を得て実施する。無断の一括削除はしない。
- ロールバック後に新規の匿名/未確認/非友達アクセスが拒否されること、PagesのHTMLが戻っていることを確認する。本番へのテスト書込が必要ならその許可も得る。すでに相手が見た値をロールバックで取り消せるとは案内しない。

## 少人数実機テスト前の設定・アクセス範囲確認（2026年10月25日）

対象アプリコミットは `79e95ef0819b53aa54bdca1a655fe9822f94d2e9`。開始時はレビュー用ブランチがクリーン、ローカルorigin/mainは `285c544aa7c54138c3ff67097fa43d7abe8cf7ee` です。今回確認した範囲で、少人数テスト前に追加修正が必要なアプリコード上の欠陥は見つかりませんでした。今回はこの説明だけを追記し、アプリ・Web設定・CSP・ルール・テストコードは変更していません。本番へのリクエスト、テスト書込、コンソール設定変更、ルール適用、push/merge、Pages公開、課金変更もしていません。

### 公開Web設定・メール・CSP

- `firebase-config.js` はユーザーが提示した公開Web設定と一致しています。projectIdは `hight-502cc`、authDomainは `hight-502cc.firebaseapp.com`、appIdは `1:855213112991:web:bb8708723b48ba8e126caa` です。apiKeyは公開Webキーで、サービスアカウント秘密鍵や管理者資格情報ではありません。storageBucket/messagingSenderIdが設定にあっても、Storage/FCMは初期化・使用していません。
- Authはメール/パスワード方式、browserSessionPersistence、`auth.languageCode = 'ja'`。確認メールは `sendEmailVerification(auth.currentUser)` を使い、独自のActionCodeSettings/continue URL/独自メールサーバーは指定していません。Firebase標準のメールアクション画面を使い、アプリに戻って確認状態を更新する仕様です。送信元・テンプレート・実際のリンク先・到達性はコンソール/実メールで未確認です。
- `reload` と `getIdToken(true)` で確認状態を更新し、ルールはJWTの `email_verified` を検証します。Firebaseの許可ドメイン `mail0306tosi-cmyk.github.io`、APIキーのリファラー/API制限、認証有効化・メールテンプレートの実設定は別途コンソールで読み取り確認が必要です。コードのauthDomain設定だけでは、これらが設定済みとは確認できません。
- CSPは `default-src 'none'`、許可ハッシュのscript/styleのみ、connect-srcは `identitytoolkit.googleapis.com` / `securetoken.googleapis.com` / `firestore.googleapis.com` のHTTPSだけです。object-src/base-uri/form-actionもnone。外部CDNのSDK/画像/任意ドメインへの通信は許可していません。生成HTMLの実CSPとscript/styleのSHA-256は一致しています。CSPは配信ページのブラウザー制限で、Firebaseデータのアクセス制御はFirestoreルールが担います。

### 全拒否から許可されるアクセス

本番が現在全拒否という点はユーザーからの情報であり、この点検で本番の実ルールを読んだものではありません。予定の `firestore.rules` が承認・適用されると、以下を許可します。

| 対象 | 許可されること / 制限 |
| --- | --- |
| 未認証・メール未確認 | Firestoreは引き続き全パスの読み書き拒否。Authの登録/確認メール送信そのものはFirestoreルールの管轄外 |
| 本人のプロフィール | 確認済み本人がニックネーム/招待コードを同時作成、ニックネーム更新、個別取得。削除/招待コード変更は不可 |
| 承認済み友達のプロフィール | 確認済み友達はドキュメント全体を個別取得可能。**ニックネームだけでなくinviteCodeも見える**。現在の画面は友達のコードを表示しないが、API経由の取得は可能 |
| 招待コード | **メール確認済み全ユーザーが既知のコードを個別参照してuidを取得可能**。本人/友達だけの権限ではない。コレクション一覧は拒否。128bit乱数は推測を困難にするが、秘密の認証資格情報ではない |
| 申請 | 確認済みでプロフィールを持つ送信者が、プロフィールのある別uidにpendingを作成。当事者のみ閲覧、受信者のみ承認/拒否。コード検索はUIの手順であり、ルールは招待コード所持を必須にしていないため、相手のuidを知るクライアントは直接申請可能 |
| 申請/関係の削除 | 両当事者がpending/accepted/rejectedのどの状態でも削除可能。**拒否や解除は永久ブロックではなく、文書削除後に再申請可能**。拒否済みのままacceptedへ変更することは拒否 |
| 標高 | 確認済み本人がaltitude/measuredAt/updatedAtだけを書込み/削除可能。確認済みの承認済み友達は共有文書が存在する時だけ個別取得。停止/解除後は新規取得を拒否。緯度経度等の追加フィールドや全体一覧は拒否 |

共有停止はプロフィール/招待コードへのアクセス停止ではありません。友達解除後はプロフィールは読めなくなりますが、相手が保存した招待コードは、確認済みユーザーとして引き続き個別参照できます。プロフィール削除、アカウント削除、コードの失効/ローテーション、ブロック、申請回数制限、テスターのメール/uid許可リストは未実装です。少人数でURL/コードを限定配布しても、バックエンド上の「テスター以外は登録/申請不可」という保証にはなりません。

### 無料枠・乱用・テスト参加者への説明

メール確認は実在人物の本人保証ではなく、確認済みアカウントの作成自体を制限するものでもありません。App Check、招待コード検索/申請/再申請のサーバー側レート制限、日次送信件数制限、通報/ブロック、管理者向け停止画面は実装していません。クライアントのボタン無効化や文字数検証は直接APIを使う相手への防御にはなりません。無料枠消費・申請迷惑行為を完全には防げないため、協力的な少人数テスターでの試験という前提をレビューしてください。

Sparkを変更する操作や有料サービスはありません。Firestoreのリスナー/関係判定/手動更新・Authの確認メールは無料枠や送信制限を消費し、枠到達時は利用が制限され得ます。上限/使用量/プロジェクトの実プランはコンソールで確認が必要です。コードに無料枠を超えて自動課金プランへ移行する処理はありません。

参加者には、標高は手動共有だけ、緯度経度は保存しない、画面を閉じても最後の値が残る、停止にはサーバー削除の成功が必要、既読値は取り消せない、通知遅延や実機の高度未取得があり得る、招待コードを不用意に転送しない、という条件を伝えてください。実メール/実機GPS/本番ドメイン/本番での失効通知タイミングは未検証です。

### 今回の確認結果と承認待ち

`npm run check` と `git diff --check` は終了0。生成HTMLを直接抽出してCSPのscript/styleハッシュを再計算し、一致を確認しました。ルールSHA-256は `af56dd515a3f858598359063a8508d84c2b8f7f0327527fc1fbb86f4e95f71c4` です。アプリ/ルールに変更がないため、前回79e95efのルール17件・統合12グループ・UI5グループ・測定20シナリオのテストは今回は繰り返していません。前回の実行結果と今回の静的確認を区別します。

本番コンソールの別途読み取り確認と、上記アクセス範囲/制約に対するユーザーの内容確認が先です。その後も、ルール適用、GitHub反映/Pages公開、本番テスト書込は、それぞれ対象と範囲の明示承認を受けるまで実施しません。承認後の操作順序とロールバックは前節の手順を使用します。


## Firebase実設定の読み取り報告（2026年10月25日）

本節は、このチャットへ引継ぎ担当者から伝えられた**Firebase/Google Cloud UIでの読み取り確認結果**を記録します。この実行環境から本番へリクエストして検証した結果ではありません。設定変更・本番テスト書込・デプロイ・push/merge・Pages公開・課金変更は行っていません。アプリコードは79e95efのままで、今回も説明だけを更新しました。

### 報告された現行の実設定

| 項目 | UI読み取り確認結果 |
| --- | --- |
| プラン | Spark無料 |
| Authentication | メール/パスワード認証が有効 |
| 承認済みドメイン | `localhost`、`hight-502cc.firebaseapp.com`、`hight-502cc.web.app` のみ |
| Pagesドメイン | 当時は未登録。最新は**ユーザー追加済み申告・コンソール再読取未確認** |
| 確認メールのコンソール既定言語 | 英語 |
| 確認メールの送信者名 | 未指定 |
| 送信元 | `noreply@hight-502cc.firebaseapp.com` |
| 件名 | `Verify your email for %APP_NAME%` |
| メールアクションURL | `https://hight-502cc.firebaseapp.com/__/auth/action` |
| APIキー | Browser keyが唯一1件。アプリケーション制限なし |
| API制限 | 25 API。Identity Toolkit API / Token Service API / Cloud Firestore APIを含む。Generative Language APIは含まない |
| Google Cloud規約 | ユーザーへ確認し、承認後に同意操作を行う。無料トライアル等の申込は行っていない |

コードは `auth.languageCode = 'ja'` で日本語の確認メールを要求します。一方、上表はコンソールの既定テンプレート設定です。これらを同一視せず、**実際に届くメールの言語・件名・送信者・リンク先・配送成否はまだ未検証**とします。確認リンクはFirebase標準画面を使う実装で、Pagesへ自動的に戻る独自continue URLは設定していません。UIに出たアクションURLと実メール内のURLが一致するかは実受信後に確認します。

### 承認待ちの最小化・Web制限案（未適用）

1. Authenticationの承認済みドメインへ `mail0306tosi-cmyk.github.io` を追加する案。パスやスキームは登録しません。これはユーザー許可リストやFirestoreのアクセス制御ではありません。
2. APIキーのAPI制限を、現在アプリが使うIdentity Toolkit API (`identitytoolkit.googleapis.com`)、Token Service API (`securetoken.googleapis.com`)、Cloud Firestore API (`firestore.googleapis.com`) の3 APIへ縮小する候補。25 APIすべての名称や他用途での依存はこの報告では確認できていないため、変更前に他の利用アプリ/設定がないか確認し、現状を退避します。この3つで本番の全フローが動くと実機検証済みではありません。
3. HTTPリファラーによるWebサイト制限の候補は `https://mail0306tosi-cmyk.github.io/*` と `https://hight-502cc.firebaseapp.com/*`。前者はPages、後者は標準のメール確認アクション画面用です。`https://hight-502cc.web.app/*` は実際に使う場合に限って検討し、localhostは本番キーの許可先へ無条件には追加しません。許可パターンの実際の受理形式と挙動も適用前後の確認対象です。
4. **現在のindex.htmlには `<meta name="referrer" content="no-referrer">` があります。そのままHTTPリファラー制限を有効化すると正規の認証/Firestoreリクエストも拒否される可能性があります。** Web制限を採用する場合は、別途承認を得て `strict-origin-when-cross-origin` 等へのコード変更と再ビルドを行い、設定変更とセットで検証します。このポリシーではクロスオリジンのHTTPS要求はorigin単位になるため、`/hight/` だけを許可するパス限定案には依存しません。同じPages originの別リポジトリまで許可され得る点も把握してください。
5. Firebase標準アクション画面が送る実際のReferer、モバイルChrome/プライバシー設定下の動作は未確認です。Pages上の登録・ログイン・トークン更新・再送・メールリンク適用・Firestore読み書きを実機で確認できるまで「制限設定済み・動作確認済み」と扱いません。失敗時は保存した旧APIキー制限へ承認の範囲内で戻す手順も準備します。

APIキーは公開Web設定です。API/リファラー制限は用途の絞り込みであり、個人認証・友達承認・テスター限定の代わりにはなりません。Firestoreルールがデータ権限を守ります。CSPは引き続きアプリのブラウザーに対する制限で、直接APIを呼ぶ第三者を制限する仕組みではありません。

### 「少人数で使う」の範囲

現在のアプリにメール/uid単位のテスター許可リストはありません。少人数での利用は運用上の参加者数であり、バックエンドがその参加者だけに登録・招待コード参照・申請を許可するという意味ではありません。確認済み全ユーザーの既知招待コードの個別参照、友達に見えるプロフィール内のinviteCode、文書削除後の再申請、ブロック/コード失効/レート制限/App Check未実装という前節の制約は変わりません。

### ルール全文と今回の検証範囲

以下はf2f9539時点の旧ルール全文の記録です。現在の適用予定ルールではありません。現行全文は末尾を参照してください。アプリ・ルールに変更がないため今回ルール/統合テストは再実行していません。前回結果（79e95efのルール17件、統合12グループ等）と今回の読み取り報告は別の根拠です。公開設定・APIキー制限・メール本文・実機測位を前回エミュレーターテストで確認したとは扱いません。

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function verified() {
      return request.auth != null && request.auth.token.email_verified == true;
    }
    function own(uid) { return verified() && request.auth.uid == uid; }
    function validUid(uid) { return uid is string && uid.matches('^[A-Za-z0-9_-]{1,128}$'); }
    function approved(a, b) {
      return (exists(/databases/$(database)/documents/connections/$(a + '~' + b)) &&
        get(/databases/$(database)/documents/connections/$(a + '~' + b)).data.status == 'accepted') ||
        (exists(/databases/$(database)/documents/connections/$(b + '~' + a)) &&
        get(/databases/$(database)/documents/connections/$(b + '~' + a)).data.status == 'accepted');
    }
    match /profiles/{uid} {
      allow get: if own(uid) || (verified() && approved(request.auth.uid, uid));
      allow list: if false;
      allow create: if own(uid) && validUid(uid) &&
        request.resource.data.keys().hasOnly(['nickname', 'inviteCode']) &&
        request.resource.data.keys().hasAll(['nickname', 'inviteCode']) &&
        request.resource.data.nickname is string && request.resource.data.nickname.size() >= 1 &&
        request.resource.data.nickname.size() <= 20 &&
        request.resource.data.inviteCode is string && request.resource.data.inviteCode.matches('^[A-F0-9]{32}$') &&
        getAfter(/databases/$(database)/documents/invites/$(request.resource.data.inviteCode)).data.uid == uid;
      allow update: if own(uid) && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['nickname']) &&
        request.resource.data.nickname is string && request.resource.data.nickname.size() >= 1 &&
        request.resource.data.nickname.size() <= 20;
      allow delete: if false;
    }
    match /invites/{code} {
      allow get: if verified();
      allow list: if false;
      allow create: if verified() && code.matches('^[A-F0-9]{32}$') &&
        request.resource.data.keys().hasOnly(['uid']) && request.resource.data.uid == request.auth.uid &&
        getAfter(/databases/$(database)/documents/profiles/$(request.auth.uid)).data.inviteCode == code;
      allow update, delete: if false;
    }
    match /connections/{id} {
      allow read: if verified() && request.auth.uid in resource.data.participants;
      allow create: if verified() &&
        request.resource.data.keys().hasOnly(['sender', 'recipient', 'participants', 'status', 'createdAt', 'updatedAt']) &&
        request.resource.data.keys().hasAll(['sender', 'recipient', 'participants', 'status', 'createdAt', 'updatedAt']) &&
        request.resource.data.sender == request.auth.uid && validUid(request.resource.data.sender) &&
        validUid(request.resource.data.recipient) && request.resource.data.sender != request.resource.data.recipient &&
        id == request.resource.data.sender + '~' + request.resource.data.recipient &&
        request.resource.data.participants == [request.resource.data.sender, request.resource.data.recipient] &&
        request.resource.data.status == 'pending' && request.resource.data.createdAt == request.time &&
        request.resource.data.updatedAt == request.time &&
        exists(/databases/$(database)/documents/profiles/$(request.resource.data.sender)) &&
        exists(/databases/$(database)/documents/profiles/$(request.resource.data.recipient)) &&
        !exists(/databases/$(database)/documents/connections/$(request.resource.data.recipient + '~' + request.resource.data.sender));
      allow update: if verified() && request.auth.uid == resource.data.recipient && resource.data.status == 'pending' &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'updatedAt']) &&
        request.resource.data.status in ['accepted', 'rejected'] && request.resource.data.updatedAt == request.time;
      allow delete: if verified() && request.auth.uid in resource.data.participants;
    }
    match /shares/{uid} {
      allow get: if own(uid) || (verified() && exists(/databases/$(database)/documents/shares/$(uid)) && approved(request.auth.uid, uid));
      allow list: if false;
      allow create, update: if own(uid) &&
        request.resource.data.keys().hasOnly(['altitude', 'measuredAt', 'updatedAt']) &&
        request.resource.data.keys().hasAll(['altitude', 'measuredAt', 'updatedAt']) &&
        request.resource.data.altitude is number && request.resource.data.altitude >= -12000 && request.resource.data.altitude <= 100000 &&
        request.resource.data.measuredAt is timestamp && request.resource.data.measuredAt <= request.time &&
        request.resource.data.updatedAt == request.time;
      allow delete: if own(uid);
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

上記のAPI/ドメイン案、規約同意、本番ルール適用、GitHub反映/Pages公開、本番テスト書込は、内容確認と必要な明示承認を得るまで未実行のままとします。


## 招待コード保護・停止失敗の再点検（2026年10月25日、現行）

開始時HEADは `f2f9539fe9ddf9a11a5f86cdd232087c1efbe5a4`、レビュー用ブランチはクリーンでした。容量エラーによる未保存の途中変更はありませんでした。本節の改訂はローカルの新コミットだけに保存します。現行共有に期限は追加していません。本番ルール適用・本番データ書込・設定変更・push/merge・Pages公開・課金変更は実施していません。

### 方針の更新と認証ドメインの準備

- `mail0306tosi-cmyk.github.io` の追加は準備だけです。承認後に行う操作は、Firebaseコンソール → Authentication → Settings → Authorized domains → Add domain → ホスト名だけを入力 → 追加確認、です。現行のlocalhost/firebaseapp.com/web.appは無断で削除しません。追加後も実機の登録/ログイン/確認メールの一連を試すまでは動作確認済みとしません。
- APIキーの現行25 API制限とアプリケーション制限なしを維持します。Webサイト制限は実機テスト後の検討事項へ戻しました。前節の3 API縮小案・referrer変更案は今回採用せず、コード上のreferrer/CSPの指示内容も変更していません。再ビルドによるscript/styleハッシュ更新だけが発生しています。
- Sparkを維持し、Firebase公開Web設定/認証プロバイダー/メール送信設定も変更していません。f2f9539に記録したコンソール読み取り情報と、コードの日本語メール要求・実メール未検証の区別は維持します。

### 招待コードの分離と互換性

友達がニックネームを取得するために招待コードまで読める必要はないため、最小限の文書分離を行いました。

| パス | 現行の内容と権限 |
| --- | --- |
| `profiles/{uid}` | **nicknameのみ**。確認済み本人と承認済み友達が個別取得。リスト禁止。本人が作成/更新 |
| `privateProfiles/{uid}` | **inviteCodeのみ**。メール確認済み本人だけ個別取得。友達/他人/未確認は拒否。リスト/変更/削除は禁止 |
| `invites/{code}` | uid。既知コードから申請先を見つけるため確認済みユーザーは個別取得可。リスト/変更/削除は禁止 |

新規作成は公開プロフィール・本人専用コード・コード対応表の3文書をバッチで原子的に作成し、ルールのgetAfterで整合性を検証します。nicknameだけの単独新規作成、対応表のないコード文書作成、他人コードの横取りは拒否します。既存プロフィールのニックネーム変更では本人専用コードを変更しません。

旧形式 `profiles/{uid}={nickname,inviteCode}` が残る場合、**友達の読み取りは文書全体を拒否**しコードを漏らしません。本人は取得でき、画面は保存による移行を案内します。本人が保存した時に、旧コードを維持したまま公開文書からinviteCodeを取り除きprivateProfilesを同じバッチで作成します。途中状態を公開せず、失敗時には一式が反映されません。自動バックグラウンド移行や本番データ一括変更は実装/実行していません。

本番が全拒否でSNS未利用という申告でも、本番文書の実在/形式は未調査です。適用前に旧形式や他スキーマの有無を許可された範囲で確認してください。前のルールを承認した場合でも今回の分離ルールは内容が変わっているため、改めて現行全文の確認が必要です。

既知コード→uid参照は残るため、保存/転送済みのコードを取り消す仕組みではありません。友達解除後も既知コードの個別参照は確認済みなら可能です。プロフィール/コード削除、コード失効/ローテーション、ブロック、テスター許可リスト、乱用レート制限は依然未実装です。「少人数で使う」はアクセス対象限定を意味しません。

### 停止失敗と未完了書き込み

停止/ログアウトの意図があると、共有欄のrole=alertに色付きで次を表示します。

> 共有停止はまだ確認できていません。最後の共有値がサーバーに残り、承認済みの友達が読める可能性があります。画面を閉じずに通信を確認し、「共有停止」を再試行してください。未完了の送信・削除は後から反映される場合があります。

navigator.onLineでオフラインと分かる場合は新しい書込を開始せず、この警告を残します。オンライン表示でも実際に通信できる保証はないため、共有/削除のサーバー応答に12秒の画面側監視を付けました。12秒経過は**取消しでも失敗確定でもありません**。UIの操作待ちを解除して停止の再試行を可能にしますが、新しい共有は停止確認まで抑止します。メール確認状態を更新してもこの抑止を消しません。

Firestore SDKには未完了書込の取消APIがありません。現在のstopは同じuidの未完了削除Promiseを再利用し、再試行で同じ削除を大量にキューへ追加しません。削除が後でサーバー確定した場合だけ警告を消し、非公開を表示します。遅延成功で勝手にログアウトはせず、ログアウトは再操作が必要です。遅れた共有成功も「前の共有操作が反映された」と警告し、停止を促します。確定した拒否なら再試行時に改めて削除を送れます。

メモリー上の監視・抑止はタブの再読込/終了を越えて保持されません。終了直前にサーバーへ届いた操作が成立している可能性は残ります。新しい画面ではサーバー状態を読み直し、共有中/不明を表示します。ページを閉じることを共有取消しとは案内しません。通信・認証障害の間に「直ちに非公開」を保証するものではなく、既読値の取消しもできません。

### 再テスト結果

エミュレーター用のFIREBASE_EMULATORS_PATH/XDG_CONFIG_HOMEは前節と同じ値をexport。すべてdemo-hight/localhost専用で本番へ書き込んでいません。

| コマンド | 実行結果 |
| --- | --- |
| `npm run test:rules` | **21件成功、失敗0、スキップ0、終了0**。本人コード参照・他人/友達/未確認拒否、原子的作成、旧形式遮断/移行、既知コード検索、解除後拒否、実SDKオフライン削除キューを追加 |
| `npm run test:integration` | **13 PASSグループ、終了0**。実SDKで三文書作成/友達コード非公開/旧形式移行、従来の申請/共有/停止/解除/再読込も検証 |
| `npm run test:ui` | **7 PASSグループ、終了0**。オフライン、停止失敗、共有/削除タイムアウト、遅延完了、停止再試行可能、抑止維持、従来の購読解除/遅延通知も検証 |
| `npm run test:auth` | **6 PASSグループ、終了0** |
| `HIGHT_TEST_URL=http://127.0.0.1:8008 npm run test:browser` | **20シナリオ成功、終了0** |
| `npm run check` / `git diff --check` | 終了0 |

ログは `/tmp/hight-protect-rules.log`、`/tmp/hight-protect-integration.log`、`/tmp/hight-protect-ui.log`、`/tmp/hight-protect-auth.log`、`/tmp/hight-protect-geolocation.log`。SDK実験ではオフライン中に削除Promiseが未完了のまま友達の新規サーバー取得が成功し、再接続後の削除完了で初めて拒否されることを確認しました。UIタイムアウト/遅延コールバックは模擬クライアントと仮想時計で検証しており、実機のすべての通信障害パターンを再現したわけではありません。

### 24時間の共有期限案（現行へ未導入）

固定24hなら **updatedAt基準案を推奨**します。現行でも書込時 `updatedAt == request.time` を要求しているため、閲覧時に次の条件を追加すれば端末時計で期限を算出する必要がありません。

```text
request.time < resource.data.updatedAt + duration.value(24, 'h')
```

期限切れの友達閲覧を拒否し、本人は停止/再共有のため引き続き読める案です。`proposals/firestore-24h.rules` はこの案の独立ファイルで、firebase.jsonの参照先ではありません。現行のfirestore.rules/共有欄には期限を追加していません。

独立案を次のコマンドでdemo-hightのエミュレーターだけに読み込みました。

```sh
./node_modules/.bin/firebase emulators:exec --project demo-hight --only firestore 'node --test tests/expiry-proposal.test.cjs'
```

**4件成功・失敗0・スキップ0・終了0**。23時間後の許可、25時間後の拒否と文書残存/本人取得、serverTimestampによる再共有で期限更新、updatedAt欠損と未来の更新日時の拒否を検証しました。ログは `/tmp/hight-expiry-proposal.log`。厳密な24h瞬間の実時間経過や時刻だけでのリスナー失効通知はテストしていません。

| 比較 | updatedAt + 固定24h | expiresAtを別フィールドに保存 |
| --- | --- | --- |
| サーバー時刻整合 | 検証済みserverTimestampが基準。追加書込なし | 端末のDate.now()+24hを信用してはいけない。ルールでサーバー基準の整合/上限が必要 |
| スキーマ/互換性 | 現行の正常な共有に追加項目不要。導入すると既に24h超の共有は直ちに読めなくなる | フィールド許可/必須と既存文書の扱いを変更する必要がある |
| 任意期限 | 固定。任意化するなら検証済みttlHours等を別途設計 | 表示/任意期限には分かりやすいが、端末時計ずれと偽装を考慮した追加設計が必要 |
| クライアント実装 | updatedAtを取得して表示期限を計算可能 | serverTimestampへ24hを足して保存する単一のSDK変換はない。厳密一致ならサーバー時刻取得後の二段階書込等が必要になり、小さな変更ではなくなる |

expiresAtを採用する場合、`expiresAt == request.time + 24h` の厳密条件に端末計算値を合わせる実装はできません。許容誤差付きの範囲検証は端末時計ずれで正当な書込を拒否する可能性があり、許容範囲自体も仕様に影響します。二段階方式なら期限確定まで友達に非公開とする原子性/競合処理も設計が必要です。固定24hのためにこの複雑さを導入する必要はありません。

本導入する場合は、期限/残り時間/期限切れとサーバー確認状態を画面に表示し、表示タイマー・タブ復帰時の再確認が必要です。request.timeの経過だけで既存リスナーに失効通知が来る保証はなく、サーバーの新規取得拒否と画面の消去を別々に扱います。端末の表示タイマーがずれてもサーバーのアクセス判断はrequest.timeに従います。再共有だけがupdatedAtと期限を更新し、再測定/単なる再接続は更新しません。

期限切れは**削除ではなく閲覧拒否**で、共有文書は保存されたままです。TTL/Functions/スケジュール処理は使わずSparkを維持できる案ですが、保存容量/読み取りは無料枠を消費します。updatedAtのない旧データはfail-closedとし、本人の明示再共有で正規化する方針が必要です。期限は停止失敗時の影響時間を限定する補助で、即時停止や既読情報取消しの代わりにはなりません。導入判断とUI変更・本番適用の承認は未取得です。

### 現行の適用予定ルール全文（未適用）

SHA-256: `6fcfc9b05d79241e75c3bd3e6ee84dc4d59fe4f34cd2f4345a9f0b5ad18f25e5`。前節に残した旧ルールではなく、以下が今回の承認対象です。

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function verified() {
      return request.auth != null && request.auth.token.email_verified == true;
    }
    function own(uid) { return verified() && request.auth.uid == uid; }
    function validUid(uid) { return uid is string && uid.matches('^[A-Za-z0-9_-]{1,128}$'); }
    function approved(a, b) {
      return (exists(/databases/$(database)/documents/connections/$(a + '~' + b)) &&
        get(/databases/$(database)/documents/connections/$(a + '~' + b)).data.status == 'accepted') ||
        (exists(/databases/$(database)/documents/connections/$(b + '~' + a)) &&
        get(/databases/$(database)/documents/connections/$(b + '~' + a)).data.status == 'accepted');
    }
    function publicProfile(data) {
      return data.keys().hasOnly(['nickname']) && data.keys().hasAll(['nickname']) &&
        data.nickname is string && data.nickname.size() >= 1 && data.nickname.size() <= 20;
    }
    match /profiles/{uid} {
      // 旧形式にコードが残る間は、友達にも文書全体を公開しない。
      allow get: if own(uid) || (verified() && publicProfile(resource.data) && approved(request.auth.uid, uid));
      allow list: if false;
      allow create: if own(uid) && validUid(uid) && publicProfile(request.resource.data) &&
        getAfter(/databases/$(database)/documents/privateProfiles/$(uid)).data.inviteCode is string;
      allow update: if own(uid) && publicProfile(request.resource.data) &&
        (!('inviteCode' in resource.data) ||
          getAfter(/databases/$(database)/documents/privateProfiles/$(uid)).data.inviteCode == resource.data.inviteCode);
      allow delete: if false;
    }
    match /privateProfiles/{uid} {
      allow get: if own(uid);
      allow list: if false;
      allow create: if own(uid) && validUid(uid) &&
        request.resource.data.keys().hasOnly(['inviteCode']) &&
        request.resource.data.inviteCode is string && request.resource.data.inviteCode.matches('^[A-F0-9]{32}$') &&
        publicProfile(getAfter(/databases/$(database)/documents/profiles/$(uid)).data) &&
        (!exists(/databases/$(database)/documents/profiles/$(uid)) ||
          !('inviteCode' in get(/databases/$(database)/documents/profiles/$(uid)).data) ||
          get(/databases/$(database)/documents/profiles/$(uid)).data.inviteCode == request.resource.data.inviteCode) &&
        getAfter(/databases/$(database)/documents/invites/$(request.resource.data.inviteCode)).data.uid == uid;
      allow update, delete: if false;
    }
    match /invites/{code} {
      allow get: if verified();
      allow list: if false;
      allow create: if verified() && code.matches('^[A-F0-9]{32}$') &&
        request.resource.data.keys().hasOnly(['uid']) && request.resource.data.uid == request.auth.uid &&
        getAfter(/databases/$(database)/documents/privateProfiles/$(request.auth.uid)).data.inviteCode == code;
      allow update, delete: if false;
    }
    match /connections/{id} {
      allow read: if verified() && request.auth.uid in resource.data.participants;
      allow create: if verified() &&
        request.resource.data.keys().hasOnly(['sender', 'recipient', 'participants', 'status', 'createdAt', 'updatedAt']) &&
        request.resource.data.keys().hasAll(['sender', 'recipient', 'participants', 'status', 'createdAt', 'updatedAt']) &&
        request.resource.data.sender == request.auth.uid && validUid(request.resource.data.sender) &&
        validUid(request.resource.data.recipient) && request.resource.data.sender != request.resource.data.recipient &&
        id == request.resource.data.sender + '~' + request.resource.data.recipient &&
        request.resource.data.participants == [request.resource.data.sender, request.resource.data.recipient] &&
        request.resource.data.status == 'pending' && request.resource.data.createdAt == request.time &&
        request.resource.data.updatedAt == request.time &&
        exists(/databases/$(database)/documents/profiles/$(request.resource.data.sender)) &&
        exists(/databases/$(database)/documents/profiles/$(request.resource.data.recipient)) &&
        !exists(/databases/$(database)/documents/connections/$(request.resource.data.recipient + '~' + request.resource.data.sender));
      allow update: if verified() && request.auth.uid == resource.data.recipient && resource.data.status == 'pending' &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'updatedAt']) &&
        request.resource.data.status in ['accepted', 'rejected'] && request.resource.data.updatedAt == request.time;
      allow delete: if verified() && request.auth.uid in resource.data.participants;
    }
    match /shares/{uid} {
      allow get: if own(uid) || (verified() && exists(/databases/$(database)/documents/shares/$(uid)) && approved(request.auth.uid, uid));
      allow list: if false;
      allow create, update: if own(uid) &&
        request.resource.data.keys().hasOnly(['altitude', 'measuredAt', 'updatedAt']) &&
        request.resource.data.keys().hasAll(['altitude', 'measuredAt', 'updatedAt']) &&
        request.resource.data.altitude is number && request.resource.data.altitude >= -12000 && request.resource.data.altitude <= 100000 &&
        request.resource.data.measuredAt is timestamp && request.resource.data.measuredAt <= request.time &&
        request.resource.data.updatedAt == request.time;
      allow delete: if own(uid);
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

## 開発環境公開後の継続確認と2台試験準備（2026年10月25日）

ユーザーから開発環境公開完了の報告を受けて再開しました。開始時HEADは `9c7fe6a157cc413f666b1867b470588026f94957`、レビュー用ブランチはクリーンで、依存関係/公式Firestore JARも保持されていました。今回アプリコード・本番ルール・公開Web設定・APIキー制限・referrer/CSP方針は変更していません。Sparkの変更操作もありません。

### ドメイン追加の実行可否

`mail0306tosi-cmyk.github.io` のAuthentication許可ドメイン追加について、ユーザーの実行指示は受領しています。ただし現在のツールにFirebase/GCP管理コネクターとコンソールを操作するブラウザー機能がありません。環境の非秘密OICマニフェストはversion 1ですがGCPのconnectionsエントリーがなく、選択可能な管理用接続を確認できません。継承されたGOOGLE_APPLICATION_CREDENTIALS等の変数名だけでは管理権限が使えるとは判断せず、資格情報ファイルを読み取ったり他の認証へ切り替えたりしていません。environment_statusツールも提供されていないため、管理認証のready状態を確認できていません。

当時この環境からのドメイン追加は未実行でした。最新は**ユーザー追加済み申告・コンソール再読取未確認**です。公開Web APIキーは管理設定変更の資格情報ではありません。秘密鍵/パスワードをチャットへ送る必要はありません。最小の手動操作はFirebaseコンソールの `hight-502cc` → Authentication → Settings → Authorized domains → Add domain → `mail0306tosi-cmyk.github.io` です。既存ドメイン、APIキー25 API制限/アプリケーション制限なしは維持します。追加後の確認は本番メール・実機試験で行います。

### 実機試験の準備物

`DEVICE_TEST_PLAN.md` にスマホ2台用の16段階の試験表を用意しました。未確認メール、再送/確認、申請/拒否/承認、測定だけでは未送信、ページ終了後の継続、停止、オフライン停止失敗/再試行、両方向の共有後の解除、ログアウトまで、操作と期待結果を整理しています。機種/OS/Chrome/コミット/結果の簡単な記録に留め、不要なスクリーンショット・パスワード・個人情報の共有は求めません。

開発環境の公開だけではGitHub Pagesや本番ルールは更新されません。まだ実機試験を開始できる公開状態と確認したわけではありません。本番ルール適用とGitHub反映/Pages公開はユーザーの明示承認待ち、本番テストアカウント/データ作成も許可された範囲内で行います。

### 再検証結果

- `npm run check`：終了0、生成HTML/SDK/CSPの同期確認。
- `npm run test:rules`：demo-hightで21件成功、失敗0、スキップ0、終了0。
- `npm run test:integration`：実SDK/ローカルAuth・Firestoreで13 PASSグループ、終了0。
- `npm run test:ui`：7 PASSグループ、終了0。
- `HIGHT_TEST_URL=http://127.0.0.1:8009 npm run test:browser`：20シナリオ成功、終了0。ログ `/tmp/hight-ready-geolocation.log`。

ログは `/tmp/hight-ready-rules.log`、`/tmp/hight-ready-integration.log`、`/tmp/hight-ready-ui.log`。Auth単独と独立24h案はコード変更がないため今回再実行せず、前回の結果と区別します。現行共有に期限は導入していません。実機GPS、実メール、ドメイン追加、Firebase本番設定との統合は未検証です。

ローカルネットワークポリシーにはstorage.googleapis.com等の制限が記録されています。GitHubの `git ls-remote origin refs/heads/main` はCONNECT 403で失敗し、今回はリモートmainの実状態を照合できていません。ローカルorigin/mainは過去の観測値であり最新の保証ではありません。将来の承認済み公開時にはGitHub向け通信を確認する必要があります。プロキシ/TLS検証の回避、無断のnetwork設定変更やpushはしていません。

残リスクは、共有停止の通信失敗/後からの書込反映、通知遅延、既読値取消不可、画面を閉じても値が残ること、期限未導入、ブロック/コード失効/レート制限/テスター許可リストの未実装、Spark無料枠の上限です。本番承認前にこれらを含めて現行ルールの内容を確認し、既存ルールを退避してください。適用・公開・実機検証・ロールバックの順序は前節とDEVICE_TEST_PLAN.mdに従います。


## 保存済みファイルの引継ぎ最終監査（2026年10月25日）

開始時HEADは `e149633195103f4a27656f395ef5a9165ba7c196`、アプリ実装は `9c7fe6a157cc413f666b1867b470588026f94957` のまま、作業ツリーはクリーンでした。今回の変更は監査資料とドメイン申告の更新のみです。ルールSHA-256は `6fcfc9b05d79241e75c3bd3e6ee84dc4d59fe4f34cd2f4345a9f0b5ad18f25e5` と一致しています。

`mail0306tosi-cmyk.github.io` は **ユーザー追加済み申告・コンソール再読取未確認**へ更新しました。この環境からの追加実行成功とは扱いません。DEVICE_TEST_PLAN.mdの重複追加の指示も削除しました。

別チャットの担当者から、GitHubコネクタでリポジトリを読み取れ、リモートにはmainのみ、index.htmlは端末内SNSデモであるとの報告を受けました。このコンテナーの403はリポジトリ全体の権限不足とは断定せず、環境固有の通信制限として区別します。公開差分のローカル基準は `origin/main=285c544aa7c54138c3ff67097fa43d7abe8cf7ee`。今回この環境で最新リモートSHAを再取得したわけではないため、将来の承認済み反映前にはGitHubコネクタ側で最新SHAを再確認してください。

実装とルールの再点検では追加修正が必要な欠陥を確認しませんでした。受信者のみpending→accepted/rejected、未確認JWT拒否と確認後強制更新、nickname/本人用コード分離、手動共有のみ、停止/解除後の新規サーバー取得拒否、サーバー確認済みリスナーだけの表示、世代番号による遅延応答無視、停止の未確認/遅延成功と再試行を確認しました。24h案は現行に未導入です。

最終差分要約、現行ルール全文、適用/ロールバックの順序、残リスクはRELEASE_AUDIT.mdに保存します。本番への適用/書込、push/merge、Pages公開、APIキー制限やプラン変更は一切実施していません。

今回の再実行はルール21件・統合13グループ・UI7グループ・Auth6グループ・標高測定20シナリオすべて終了0です。ログとコマンドはRELEASE_AUDIT.mdへ記載しました。件数を合算せず、実SDK/エミュレーターと模擬UI/測位を区別しています。


## 最新コンソール観測の追記（2026年10月25日）

別担当がログイン済みFirebaseコンソールを読み取り確認しました。以前の「ユーザー追加済み申告・コンソール再読取未確認」は、この観測により更新します。

- Authentication: `mail0306tosi-cmyk.github.io` がCustomとして登録済み。localhost、hight-502cc.firebaseapp.com、hight-502cc.web.appも維持。実機での認証/メール動作確認とは区別します。
- Firestore(default): ルールタブ本文は全パス `allow read, write: if false;` の全拒否。適用予定のSHA-256 `6fcfc9b05d79241e75c3bd3e6ee84dc4d59fe4f34cd2f4345a9f0b5ad18f25e5` のルールは未適用です。
- データタブ: 「データベースの準備ができました。データを追加してください。」、コレクション未表示、場所 `asia-northeast1`。このUI観測から全データ/サブコレクションの不存在までは保証しません。
- 設定変更/データ変更は一切なし。根拠は別担当のコンソール観測で、この実行環境が管理APIやコンソールを操作した結果ではありません。

DEVICE_TEST_PLAN.mdとRELEASE_AUDIT.mdの最新欄も更新しました。以降の公開前チェックでドメインを再度追加する必要はありません。ルール適用・GitHub反映/Pages公開・本番テスト書込・APIキー/課金変更の禁止は継続します。今回アプリコードに変更がないため、直前に終了0となった21/13/7/20およびAuth6のテストを再実行せず、説明の整合/差分チェックだけを行います。


## 最新のプラン・リモートSHA・Pages観測（2026年10月25日）

別担当が読み取り確認した追加結果を反映しました。

- Firebaseコンソールに「料金プラン: Spark」「無料（月額0ドル）」の実表示。現プランは読み取り確認済みです。
- GitHubコネクタでmain SHA=`285c544aa7c54138c3ff67097fa43d7abe8cf7ee`を照合済みで、ローカルorigin/mainと一致します。この環境の403とリポジトリ全体のアクセス可否を混同しません。
- 最新Pages build/deployment run `40191060730` は同じhead_shaでsuccess。公開済みindex.htmlは端末内SNSデモです。レビュー用Firebase版は未反映です。
- PagesドメインのCustom登録、本番Firestore全拒否、データ画面にコレクション未表示、場所asia-northeast1という先の実観測も有効です。「申告のみ未確認」は過去時点の記録で、現在のコンソール/コネクタ読み取り確認と区別します。

実メール・実機GPS・Firebase版の本番統合は未検証。設定/データ/ルール/GitHub/Pages/課金/APIキーの変更は一切行っていません。RELEASE_AUDIT.mdとDEVICE_TEST_PLAN.mdの最新欄を同期し、ルール全文を維持しました。今回は資料のみの更新で、直前に成功したテストの再実行はしていません。


## 2026年10月26日：本番ルール適用後のコード公開直前監査

別担当が本日hight-502ccの本番ルールをコンソール公開し、再読み込み後の全文SHA-256が6fcfc9b05d79241e75c3bd3e6ee84dc4d59fe4f34cd2f4345a9f0b5ad18f25e5と一致したとの報告を反映しました。過去の全拒否/未適用は当時の記録です。この実行環境から本番を変更・テスト書込していません。

本日のGitHubコネクタGET branches/main成功でmain=285c544aa7c54138c3ff67097fa43d7abe8cf7ee、ローカルorigin/mainと一致。GitHub書込権限は未検証で、試験push/PR/mergeはしていません。こちらのGitHub公開ルートへのCONNECTも403だったため、環境固有の経路拒否と区別しました。

開始時HEADは0ba0bc8c0cd370f4c32d668ba8e375ff477f5a71、コード実装は9c7fe6aのまま。追加修正不要と判断。再実行のルール21・統合13・UI7・Auth6・測定20はすべて終了0です。実SDKと模擬UI/測位、本番未検証を区別した根拠はRELEASE_AUDIT.mdへ更新しました。DEVICE_TEST_PLAN.mdもルール適用済みへ更新し、再適用手順を外しました。

公開可否は「ローカル検証を満たし公開承認を依頼できる候補、公開操作自体は未実施/承認待ち」です。本番ルールは有効なのでPages未反映でも条件を満たす直接APIは利用可能です。少人数限定の許可リスト・ブロック・乱用制限なし、通知遅延、停止失敗と後からの反映、既読取消不可、期限未導入、Spark枠、実メール/実機GPS未検証のリスクは残ります。

完全差分とmanifestは最終ローカルコミット後に/workspace/hight-reviewへ保存します。本番ルール再適用/設定変更/本番書込、GitHub反映、Pages公開、課金変更はすべて未実行です。

本日の追加コネクタ観測でもActions最新runは40191060730、dynamic/pages/pages-build-deployment、main/285c544でsuccess、mainの.github/workflowsはGET404です。ブランチ反映でPages自動公開が起動する可能性を前提に、push/merge自体を公開承認に含めます。コード反映してから公開だけ止める手順は採りません。DEVICE_TEST_PLAN.md全文を簡潔な16段階の現行試験表に整理しました。今回のローカルGit読取と公開GitHubへのHEADはどちらもCONNECT 403（server: envoy）で、GitHub TLS前のプロキシ経路拒否と区別します。
