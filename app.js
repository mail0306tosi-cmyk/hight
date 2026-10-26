"use strict";

const button = document.querySelector("#measure");
const buttonLabel = document.querySelector("#button-label");
const cancelButton = document.querySelector("#cancel-measure");
const altitude = document.querySelector("#altitude");
const statusText = document.querySelector("#status");
const accuracy = document.querySelector("#accuracy");
const sampleRange = document.querySelector("#sample-range");
const warning = document.querySelector("#measurement-warning");
const progress = document.querySelector("#measurement-progress");
const measuredAt = document.querySelector("#measured-at");
const errorBox = document.querySelector("#error");
const TARGET = 8, MINIMUM = 3, DURATION = 20000, MIN_INTERVAL = 750;
const permissionHelp = "ブラウザーと端末の設定で位置情報を許可してください。埋め込みプレビューで制限される場合はHTTPSの独立したタブで開いてください。";
let current = null;
let sequence = 0;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1] / 2 + sorted[mid] / 2;
}
// 診断はこのページのメモリーだけ。位置座標・アカウント情報・共有イベントには含めない。
const diagnosticSummary = document.querySelector("#diagnostic-summary");
const diagnosticRows = document.querySelector("#diagnostic-rows");
const deviceInfo = document.querySelector("#diagnostic-device");
deviceInfo.textContent = `ブラウザー申告情報（機種・OSの厳密な判定ではありません）\n${navigator.userAgent}\nプラットフォーム：${navigator.userAgentData?.platform || navigator.platform || "不明"}\n言語：${navigator.language || "不明"}`;
function diagnosticNumber(value) { return Number.isFinite(value) ? `${value} m` : "不明"; }
function renderDiagnostic(run, state = "測定中") {
  const values = run.samples.map(s => s.value);
  const low = values.length ? Math.min(...values) : null, high = values.length ? Math.max(...values) : null;
  const last = run.records[run.records.length - 1];
  diagnosticSummary.textContent = `${state}／受信${run.received}回・採用${values.length}回・高度なし${run.missing}回\n最新の生高度：${last ? diagnosticNumber(last.value) : "未受信"}\n${run.done ? "採用標本の中央値" : "暫定中央値（共有不可）"}：${values.length ? diagnosticNumber(median(values)) : "不明"}\n採用標本の範囲：${values.length ? `${low}〜${high} m／幅 ${high - low} m` : "不明"}\n最新の高度精度：${last ? diagnosticNumber(last.vertical) : "不明"}／水平精度：${last ? diagnosticNumber(last.horizontal) : "不明"}`;
  diagnosticRows.replaceChildren();
  for (const record of run.records) {
    const row = document.createElement("tr");
    for (const value of [Number.isFinite(record.timestamp) && Math.abs(record.timestamp) <= 8640000000000000 ? new Date(record.timestamp).toLocaleTimeString("ja-JP") : "時刻不明", diagnosticNumber(record.value), diagnosticNumber(record.vertical), diagnosticNumber(record.horizontal), record.reason]) {
      const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
    }
    diagnosticRows.append(row);
  }
}
function active(run) { return current === run && !run.done; }
function clearWatch(run) {
  if (run.watchId !== null) {
    try { navigator.geolocation.clearWatch(run.watchId); } catch { /* 監視終了を試み、遅延応答もactiveで無視する。 */ }
    run.watchId = null;
  }
}
function finish(run) {
  run.done = true;
  clearTimeout(run.deadline); clearInterval(run.ticker); clearWatch(run);
  if (current === run) current = null;
  button.disabled = false; button.removeAttribute("aria-busy");
  buttonLabel.textContent = "高さを再測定";
  cancelButton.hidden = true; progress.hidden = true;
}
function fail(run, message) {
  if (!active(run)) return;
  finish(run); altitude.textContent = "—";
  statusText.textContent = "測定失敗";
  errorBox.textContent = message; errorBox.hidden = false;
  renderDiagnostic(run, "測定失敗・中央値は参考のみ／共有不可");
}
function cancel(reason = "測定を停止しました。結果は確定していません。") {
  if (!current) return;
  const run = current; finish(run); renderDiagnostic(run, "測定停止・中央値は参考のみ／共有不可"); altitude.textContent = "—";
  statusText.textContent = reason;
}
function renderProgress(run) {
  if (!active(run)) return;
  const seconds = Math.max(0, Math.ceil((run.startedAt + DURATION - Date.now()) / 1000));
  progress.value = run.samples.length;
  statusText.textContent = `測定中：${run.samples.length}/${TARGET}件・残り最大${seconds}秒。同じ場所で端末を動かさずお待ちください。`;
}
function complete(run) {
  if (!active(run)) return;
  if (run.samples.length < MINIMUM) {
    const detail = run.missing ? "端末から高度が返されませんでした、または有効な高度が不足しています。" : "新鮮で異なる時刻の標本が不足しています。";
    fail(run, `20秒以内に${MINIMUM}件以上の標本を取得できませんでした。${detail}屋外の空が見える場所で再測定してください。端末によっては高度を取得できません。${permissionHelp}`);
    return;
  }
  const values = run.samples.map(s => s.value);
  const value = median(values), low = Math.min(...values), high = Math.max(...values);
  const known = run.samples.map(s => s.precision).filter(Number.isFinite);
  const unknown = run.samples.length - known.length;
  const precision = known.length ? Math.max(...known) : null;
  const notes = [];
  if (unknown) notes.push(`${unknown}/${run.samples.length}件は端末の高度精度が不明です。`);
  // 10m/5mはこのUIの注意喚起用の目安であり、測量・階数判定の基準ではない。
  if (precision !== null && precision > 10) notes.push("端末精度が低めです（10m超は注意の目安）。小さな高さ差の比較には不向きです。");
  if (high - low > 5) notes.push("標本のばらつきが大きめです（範囲5m超は注意の目安）。中央値でも誤差を除去できる保証はありません。");
  if (run.samples.length < TARGET) notes.push(`標本は${run.samples.length}/${TARGET}件で終了した参考値です。再測定もお試しください。`);
  notes.push(high - low <= 3 ? "この測定中のばらつきは小さめですが、安定＝正確ではありません。" : "端末間の差が実際の高さ差とは限りません。");
  notes.push("端末ごとの系統誤差は繰り返しても消えません。端末精度は中央値の95%信頼区間ではありません。");
  const timestamp = run.samples[run.samples.length - 1].timestamp;
  finish(run);
  altitude.textContent = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
  statusText.textContent = "測定成功";
  renderDiagnostic(run, "測定成功");
  accuracy.textContent = precision === null ? "端末の高度精度（95%指標）：不明"
    : `端末の高度精度（95%指標）：±${Math.ceil(precision)} m（標本中の最大報告値${unknown ? `・${unknown}件不明` : ""}）`;
  sampleRange.textContent = `今回の標本：${run.samples.length}件／範囲 ${low.toFixed(1)}〜${high.toFixed(1)} m／幅 ${(high - low).toFixed(1)} m。表示値は中央値です。`;
  warning.textContent = notes.join(" ");
  measuredAt.textContent = `最後の採用標本：${new Date(timestamp).toLocaleTimeString("ja-JP")}`;
  for (const element of [accuracy, sampleRange, warning, measuredAt]) element.hidden = false;
  // 共有との契約を維持。精度・標本・緯度経度は渡さず、完了した代表値と時刻だけ。
  document.dispatchEvent(new CustomEvent("hight:measurement", { detail: { altitude: value, timestamp } }));
}
function accept(run, position) {
  if (!active(run)) return;
  const now = Date.now(), timestamp = position?.timestamp;
  const coords = position?.coords;
  const value = coords?.altitude, reported = coords?.altitudeAccuracy, horizontal = coords?.accuracy;
  const record = { value: Number.isFinite(value) ? value : null, timestamp,
    vertical: Number.isFinite(reported) && reported >= 0 ? reported : null,
    horizontal: Number.isFinite(horizontal) && horizontal >= 0 ? horizontal : null, reason: "採用" };
  run.received++;
  const last = run.samples[run.samples.length - 1];
  if (!Number.isFinite(timestamp) || timestamp > now || timestamp < run.startedAt - 1000 || now - timestamp > 5000 || run.seen.has(timestamp)) record.reason = "除外：古い・重複・無効時刻";
  else if (last && timestamp - last.timestamp < MIN_INTERVAL) record.reason = "除外：間隔不足";
  else if (!Number.isFinite(value)) { run.missing++; record.reason = "除外：高度なし"; }
  else {
    run.seen.add(timestamp);
    run.samples.push({ value, timestamp, precision: record.vertical });
  }
  run.records.push(record);
  if (run.records.length > 32) run.records.shift();
  renderDiagnostic(run);
  if (record.reason !== "採用") return;
  renderProgress(run);
  if (run.samples.length >= TARGET) complete(run);
}
button.addEventListener("click", () => {
  if (current) return;
  const run = { id: ++sequence, startedAt: Date.now(), samples: [], records: [], received: 0, seen: new Set(), missing: 0, watchId: null, done: false };
  current = run;
  renderDiagnostic(run);
  document.dispatchEvent(new Event("hight:measurement-reset"));
  altitude.textContent = "—";
  for (const element of [accuracy, sampleRange, warning, measuredAt, errorBox]) element.hidden = true;
  button.disabled = true; button.setAttribute("aria-busy", "true"); buttonLabel.textContent = "測定中…";
  cancelButton.hidden = false; progress.hidden = false; progress.value = 0;
  renderProgress(run);
  run.deadline = setTimeout(() => complete(run), DURATION);
  run.ticker = setInterval(() => renderProgress(run), 250);
  try {
    if (!window.isSecureContext) { fail(run, "位置情報にはHTTPSが必要です。HTTPSのページで開いてください。"); return; }
    if (!navigator.geolocation || typeof navigator.geolocation.watchPosition !== "function" || typeof navigator.geolocation.clearWatch !== "function") {
      fail(run, "この環境では位置情報APIを利用できません。対応ブラウザーでHTTPSのページを開いてください。"); return;
    }
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature("geolocation")) {
      fail(run, "プレビューまたは配信元のPermissions Policyで位置情報が禁止されています。HTTPSの独立したタブで開くか、iframeのallow属性と配信側の設定を確認してください。"); return;
    }
    if (navigator.permissions?.query) {
      try { navigator.permissions.query({ name: "geolocation" }).then(p => {
        if (active(run) && p.state === "denied") fail(run, "位置情報の権限が拒否されています。" + permissionHelp);
      }).catch(() => {}); } catch { /* 非対応時も測位は試す。 */ }
    }
    const watchId = navigator.geolocation.watchPosition(position => accept(run, position), error => {
      if (!active(run)) return;
      if (error.code === 3) return; // watchの一時タイムアウトは全体20秒の期限まで待つ。
      const message = error.code === 1 ? "位置情報の使用が許可されていません。"
        : error.code === 2 ? "現在地を取得できません。端末の位置情報設定と測定場所を確認してください。"
        : "位置情報の取得中にエラーが発生しました。再測定してください。";
      fail(run, message + permissionHelp);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    run.watchId = watchId;
    // 同期的に失敗通知する実装/モックでも、後から返った監視IDを確実に解放する。
    if (!active(run)) clearWatch(run);
  } catch { fail(run, "位置情報を利用できませんでした。" + permissionHelp); }
});
cancelButton.addEventListener("click", () => cancel());
window.addEventListener("pagehide", () => cancel("画面を閉じたため測定を停止しました。"));
document.addEventListener("visibilitychange", () => { if (document.hidden) cancel("画面が非表示になったため測定を停止しました。再測定してください。"); });
statusText.textContent = "測定待機中：「高さを測定」を押してください";
button.disabled = false;
