# HIGHT 高さ測定の改修レビュー（2026年10月26日）

## 状態と基準

ローカル68fc283307e8d0147d15a2dc7a5bcefa058da30b（公開335c2badb259f385286a766474e5df02b6eaa6a8と同一tree）から、feature/height-measurement-qualityで変更しました。元のfeature/firebase-sharing-reviewは68fc283のまま保持しています。本変更はローカルのみで、GitHub反映/Pages公開/Firebase設定/本番ルール/課金変更/本番データ操作はしていません。

## 原因分析の範囲

公開版はgetCurrentPositionによる単発の高度を丸めて表示していました。altitudeAccuracyの表示自体は既存機能で、今回は精度表示の新設ではなく説明・集約・警告の強化です。79m対47mの実測ログ/端末精度/時刻/測位環境がないため、32m差の原因を断定できません。一時的なばらつき、端末/OS・ブラウザーの推定や補正の違い、屋内での測位環境、系統誤差などが考えられます。

W3C Geolocation仕様のaltitudeはWGS84楕円体基準の高度、altitudeAccuracyはメートル単位の95%精度指標です。GPSだけと断定せず、OS/ブラウザーが推定する端末位置の参考値として扱います。海抜、地面の標高、床からスマホまでの高さではありません。精密な相対高さ・フロア/センチ差を保証する機能にはなりません。

参照：https://www.w3.org/TR/geolocation/#altitude-and-altitudeaccuracy-attributes

## 実装

- app.jsだけで測定セッションを管理。追加の測定モジュールや外部APIはありません。
- watchPosition(enableHighAccuracy=true, maximumAge=0, API timeout=10秒)。全体の期限は許可待ちを含め20秒、目標8件、最低3件。8件で早期完了、期限時3〜7件なら不足警告付き参考値、2件以下は失敗。
- timestampが有限・未来でない・開始の1秒前以降・受信時に5秒以内・未採用時刻であることを検証。直前の採用時刻から750ms未満/順不同の標本を除外。最低750ms間隔で、同じキャッシュを大量に数えません。
- 高さの代表値は全採用標本の中央値。外れ値1件の影響を抑えますが、外れ値を正しい値と判別できる保証はありません。全採用標本の最小〜最大と幅を別欄に表示します。
- 端末精度は採用標本中の最大報告値（控えめな表示）と不明件数を表示。不明/負の無効値を0に置き換えません。端末報告0は0と表示し、精度保証とは扱いません。
- 端末精度10m超/標本幅5m超は注意喚起の運用目安です。ばらつき3m以内も「安定＝正確ではない」と明示。中央値の95%信頼区間とは表示せず、標本数の平方根で精度が向上する計算もしません。系統誤差は反復で消えません。
- 進捗件数と残り時間、停止、再測定UI。成功/失敗/停止/期限切れ/pagehide/背景移行でwatchとタイマーを解放し、終了後の遅延callbackを無視。同期的な失敗callbackの後に返るwatch IDも解放します。
- 開始時のhight:measurement-resetで旧共有候補を無効化。成功完了時だけhight:measurementを発行し、payloadは従来通りaltitude/timestampの2項目。測定途中や停止/失敗時には確定値を発行しません。
- 緯度経度を読み取らず、送信/保存もしません。標本/精度は測定セッションのメモリーと画面だけで、履歴保存なし。共有は既存の明示ボタンだけ。友達には精度/ばらつきは送らないため、数値だけで上下を確定できない説明を追加しました。
- Firestoreのsharesスキーマ、ルール、firebase-client.js、sns.js、Firebase公開Web設定は変更していません。ルールSHA-256は6fcfc9b05d79241e75c3bd3e6ee84dc4d59fe4f34cd2f4345a9f0b5ad18f25e5のままです。

## テスト結果

全コマンド終了0。本番ではなくlocalhost/demo-hightだけを使用しました。

| コマンド | 結果 | ログ |
|---|---|---|
| HIGHT_TEST_URL=http://127.0.0.1:8012 npm run test:browser | 37シナリオ成功 | /tmp/hight-height-geolocation.log |
| npm run test:rules | 21件 pass21/fail0/skipped0 | /tmp/hight-height-rules.log |
| npm run test:integration | 13 PASSグループ | /tmp/hight-height-integration.log |
| npm run test:ui | 7 PASSグループ | /tmp/hight-height-ui.log |
| npm run test:auth | 6 PASSグループ | /tmp/hight-height-auth.log |
| npm run build / npm run check / git diff --check | 成功 | コマンド出力 |

エミュレーター実行時はFIREBASE_EMULATORS_PATH=/workspace/hight/.cache/emulators、XDG_CONFIG_HOME=/workspace/hight/.cache/configを設定しました。

測定テストは実Chromium上の生成HTMLと仮想時計/位置情報モックで、中央値・0/負・高度null・精度null/無効/低精度・外れ値・重複/古い/未来/無効時刻・過密/順不同・権限拒否・API非対応/例外・タイムアウト回復/全体期限・cancel・背景/pagehide・再測定・古いcallback・clearWatch・37ケースを確認します。Latitude/longitudeのgetterが呼ばれると例外にするモックで、読み取らないことも検証しました。単一HTML/実Permissions Policy/sandbox/JavaScript無効の既存プレビュー回帰も維持しています。320/375/430pxで横はみ出しなし。ブラウザーズームの全倍率を検証したものではありません。

SNSのモックはwatchPositionで8個の新しい標本を返す形へ更新し、成功完了を待って既存操作を検証します。実SDK統合テストでは測定中は共有ボタン無効、完了だけでは共有文書が作られない/更新されない、共有しても精度メタデータが保存されないことを確認。ログイン/メール確認/招待/受信者承認/拒否/停止/解除/コード分離/旧データ移行の回帰も成功しています。

初回測定テストで、NaNを含む不足時の案内に対する文言期待が合わず1件失敗しました。実装は「高度不足」を正しく案内しており、テストを必要件数不足の条件へ合わせ、最終37件を再実行して成功しました。失敗を合格として数えていません。

## 残課題と実機手順

実機GPS/OSの実際の精度、端末間の系統差、32m差の再現/原因特定は未検証です。複数標本や中央値で同じ部屋の2台が一致する保証はありません。ブラウザー/OSが同じ時刻しか返さない場合や背景制限では標本不足となり、端末ごとのWGS84仕様への実装差もあり得ます。地形APIへの置換やランキング/履歴グラフは実装しません。

改修版公開の明示承認後、同じ高さに固定した2台で各3回程度、中央値/範囲/件数/端末精度/不明警告/端末OS/Chrome/測定環境を記録します。安定して差が残っても上下や正確さを確定せず、屋内/窓際/屋外で再試行。途中停止・背景移行と再開、精度不明、測定後の共有手動性、再測定失敗後の旧値共有不可を確認します。詳細はDEVICE_TEST_PLAN.md追記を参照してください。
