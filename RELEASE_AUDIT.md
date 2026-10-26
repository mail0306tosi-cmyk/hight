# HIGHT 公開直前監査（2026年10月26日）

## 対象と判断

監査開始HEADは `0ba0bc8c0cd370f4c32d668ba8e375ff477f5a71`。実装は `9c7fe6a157cc413f666b1867b470588026f94957` のまま、開始時作業ツリーはクリーンでした。今回追加のアプリ修正は不要と判断し、資料更新だけを行います。最終候補SHA・完全差分・ログはコミット後の `/workspace/hight-review/` のmanifestへ固定します。

**判断：ローカル検証上はコード公開の承認を依頼できる状態。公開は未実施・承認待ち。実機/本番統合の成功を保証した状態ではありません。**

## 本番とGitHubの実観測

- 本番hight-502ccのFirestoreルールは、本日別担当がコンソールで公開し、再読み込み後に全文SHA-256=`6fcfc9b05d79241e75c3bd3e6ee84dc4d59fe4f34cd2f4345a9f0b5ad18f25e5`の一致を確認済みとの報告。この環境から本番へ適用/書込/設定変更はしていません。
- PagesドメインCustom登録・Spark無料(月額0ドル)は前回の別担当UI読み取りで確認済み。今回はプラン/ドメイン/キー設定を変更していません。APIキー25 API制限維持、Web制限は未追加、referrer/CSP方針維持です。
- 本日別担当のGitHubコネクタでGET branches/main成功、SHA=`285c544aa7c54138c3ff67097fa43d7abe8cf7ee`（端末内SNSデモ）。ローカルorigin/mainと一致し、この値を公開差分基準に固定します。公開直前にもその時点のmainを再確認します。
- GitHubへの書込権限は未検証です。試験push/PR/mergeは行っていません。本日のコネクタ再読取でも最新Actions runは40191060730、dynamic/pages/pages-build-deployment、main/285c544、successです。mainルートに.github/workflowsはなく同パスGET404との報告。Pages成功はデモ版についてであり、Firebase版の配信成功ではありません。
- 10月25日の全拒否ルール/コレクション未表示は過去観測です。本日のデータ件数やサブコレクションは確認していません。

## 差分の要点（mainデモ→候補）

- app.jsの標高測定はmainから変更なし。sns.jsをデモから実Firebaseへ置換。
- メール登録/ログイン/確認メール再送、reloadとIDトークン更新。未確認ユーザーの共有拒否をUIとルールの両方に実装。
- nicknameはprofiles、inviteCodeは本人専用privateProfiles。3文書の原子的作成・旧形式の原子的移行。既知コードの個別uid参照は確認済み全ユーザーに残り、一覧は拒否。
- 受信者だけが申請を承認/拒否。自己承認・参加者改変は禁止。削除/再申請可能で、永久ブロックではない。
- 明示共有だけで高度/測定日時/サーバー更新日時を保存。緯度経度は保存不可。測定/再ログインだけでは送信しない。
- 停止/解除後はサーバー取得を拒否。関係/共有リスナーで古い表示を消し、世代番号で遅延応答を無視。停止不明/失敗の警告、12秒監視、再試行と未完了書込の遅延反映を扱う。
- SDKは固定依存としてHTMLへ埋込み、ハッシュ付きCSPを生成。公開Web設定は管理者秘密鍵ではない。24h案は別ファイルで、現行へ未導入。

## 今回のテスト

全件demo-hight/localhost専用。FIREBASE_EMULATORS_PATH=/workspace/hight/.cache/emulators、XDG_CONFIG_HOME=/workspace/hight/.cache/configを設定。本番へのテスト書込はしていません。

| コマンド | 結果 | ログ |
| --- | --- | --- |
| npm run test:rules | 21件、pass21/fail0/skipped0、終了0 | /tmp/hight-prepublish-rules.log |
| npm run test:integration | 実SDK/2ブラウザー13 PASSグループ、終了0 | /tmp/hight-prepublish-integration.log |
| npm run test:ui | 模擬サービス/仮想時計7 PASSグループ、終了0 | /tmp/hight-prepublish-ui.log |
| npm run test:auth | 実Authエミュレーター6 PASSグループ、終了0 | /tmp/hight-prepublish-auth.log |
| HIGHT_TEST_URL=http://127.0.0.1:8011 npm run test:browser | 測位応答模擬20シナリオ、終了0 | /tmp/hight-prepublish-geolocation.log |
| npm run check / git diff --check | HTML/SDK/CSP同期と差分確認、終了0 | コマンド出力 |

根拠はgetDocFromServer/getDocsFromServer、両者の実在する共有値を解除前に正常取得してからの拒否、確認前の実JWTの確認リンク後も続く拒否と更新後の書込成功です。既存リスナーの解除後の新値拒否、オフライン削除未完了の間は友達が読めることも確認済みです。画面やアプリを閉じても最後の値が残ることをUIに明記し、実際のタブ終了/再ログインも試しています。

関係文書削除だけではエミュレーターの共有リスナー失効通知が即時に届かない観測があります。新規取得は拒否され、その後の対象値変更でも新値は配信されません。画面側は別の関係リスナーで購読/表示を消すため、即時の失効エラーだけに依存しません。通知タイミングが本番で同じとは検証していません。

## GitHub 403の読み取り診断

現在のenvironment_statusはobservations_current=true、running/connected、networkはrestricted、許可先はstorage.googleapis.comのみ、network stateはunknownです。起動時ネットワークポリシーファイルも同内容です。state=unknownをenforcedとは扱いません。

実操作では `git ls-remote origin refs/heads/main` がCONNECT tunnel 403、公開ルート `curl --head https://github.com` も同じCONNECT 403で、拒否ヘッダーはserver: envoyです。GitHubへのTLS接続前の応答としてプロキシ経路由来と判断できる範囲に留めます。GitHubのリポジトリ認可へ届く前の経路拒否で、別担当コネクタの同main読取は成功しています。したがってこの環境固有の通信経路制限と判断し、GitHubのリポジトリ権限不足や書込権限の有無を断定しません。プロキシ迂回、TLS無効化、ネットワーク設定変更、試験pushは行っていません。

## 残リスク

- 実メール配送/迷惑メール/本文の言語、実機GPS/高度取得、本番設定とPages版の統合は未検証。コアのメール確認手順はエミュレーター検証です。
- 本番ルールはすでに有効です。Pagesがデモのままでも、条件を満たす直接API操作は可能です。フロント未公開をアクセス遮断と考えてはいけません。
- テスター許可リスト、App Check、乱用レート制限、ブロック、コード失効/変更、アカウント削除UIは未実装。少人数運用は参加者限定の認可ではありません。
- 共有停止が届かなければ最後の値は残り、友達が読める場合があります。画面終了では止まらず、期限も未導入。タイムアウトで操作は取り消されず後から反映され得ます。
- リスナー/通信遅延、既読値取消不可、Spark無料枠・メール送信制限があります。無制限動作や即時非公開を保証しません。
- 24h提案は検討用のみ。期限切れは削除ではなく拒否で、時刻経過だけの購読失効通知は保証できず表示タイマーも別途必要です。

## 公開とロールバックの順序（未実行）

1. 最新候補SHA/差分を確認し、GitHub反映・Pages公開の明示承認を得る。本番試験アカウント/データ作成の許可範囲も別途確認。
2. 適用済みルールのSHAとドメイン登録情報を確認。今回の作業でルールを再適用/変更しない。直前のmainをコネクタで読み取り、基準SHAと一致または差分を再レビュー。
3. **mainへのpush/merge自体がPagesの自動公開を起動し得るため、GitHub反映と公開の両方を含む明示承認が必要**です。.github/workflowsがないことを非公開の根拠にしません。承認範囲内で候補をmainへ反映し、Pagesジョブのhead_shaと成功、HTTPS配信のHTML/注意文/認証UIを確認。force-pushしない。
4. 許可済み本番書込だけでDEVICE_TEST_PLAN.mdの2台試験を実行。共有/停止/解除、実メールとGPS、閉じた後の継続・失敗警告を記録し、終了時は共有停止/ログアウトを確認。
5. 問題時は公開変更を承認済みrevertで以前のデモへ戻し、Pages配信を確認。プライバシー上の問題なら別途明示指示を得てFirestore全拒否へ戻す。今回その変更はしない。
6. 全拒否はデータ削除ではなく、停止ボタンの削除も拒否される。再公開前の残データ整理/移行/削除は別途承認が必要。既読値を取り消したとは案内しない。

## 本番適用済みと報告された現行ルール全文

SHA-256: `6fcfc9b05d79241e75c3bd3e6ee84dc4d59fe4f34cd2f4345a9f0b5ad18f25e5`。以下はローカル実ファイルと一致。今回この環境から本番へ適用したものではありません。

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
