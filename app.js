"use strict";

const button = document.querySelector("#measure");
const buttonLabel = document.querySelector("#button-label");
const altitude = document.querySelector("#altitude");
const statusText = document.querySelector("#status");
const accuracy = document.querySelector("#accuracy");
const measuredAt = document.querySelector("#measured-at");
const errorBox = document.querySelector("#error");
let measuring = false;
let requestId = 0;
let watchdog;

const permissionHelp = "ブラウザーのサイト設定と端末の設定で位置情報を許可し、再測定してください。埋め込みプレビューでは位置情報が制限される場合があります。その場合はページをHTTPSの独立したタブで開いてください。";

function finish() {
  clearTimeout(watchdog);
  measuring = false;
  button.disabled = false;
  button.removeAttribute("aria-busy");
  buttonLabel.textContent = "標高を測定";
}

function showError(message) {
  finish();
  statusText.textContent = "測定失敗";
  errorBox.textContent = message;
  errorBox.hidden = false;
}

button.addEventListener("click", () => {
  if (measuring) return;
  const currentRequest = ++requestId;
  const active = () => measuring && currentRequest === requestId;
  altitude.textContent = "—";
  accuracy.hidden = true;
  measuredAt.hidden = true;
  errorBox.hidden = true;
  measuring = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  buttonLabel.textContent = "測定中…";
  statusText.textContent = "測定中：位置情報の許可を確認し、現在地を取得しています…";

  // APIのタイムアウトは許可待ちを含まない場合があるため、画面側でも監視する。
  watchdog = setTimeout(() => {
    if (active()) showError("25秒以内に位置情報の応答がありませんでした。許可の確認画面が出ていないか確認してください。" + permissionHelp);
  }, 25000);

  try {
    if (!window.isSecureContext) {
      showError("位置情報を使うには、安全な接続（HTTPS）が必要です。HTTPSでページを開いてください。HTTPのプレビューでは測定できません。");
      return;
    }
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
      showError("この環境では位置情報APIを利用できません。スマートフォンのSafariやChromeなど、対応ブラウザーでHTTPSのページを開いてください。");
      return;
    }
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy && typeof policy.allowsFeature === "function" && !policy.allowsFeature("geolocation")) {
      showError("プレビューまたは配信元のPermissions Policyにより、位置情報の利用が禁止されています。HTTPSの独立したタブで開いてください。改善しない場合は、配信側のPermissions-Policyヘッダーと埋め込みiframeのallow属性でgeolocationの許可を確認してください。");
      return;
    }
    // Permissions APIが非対応・応答待ちでも測位自体は止めない。
    if (navigator.permissions && typeof navigator.permissions.query === "function") {
      try {
        navigator.permissions.query({ name: "geolocation" }).then((permission) => {
          if (active() && permission.state === "denied") {
            showError("位置情報の権限が拒否されています。" + permissionHelp);
          }
        }).catch(() => {});
      } catch { /* 権限の最終判断はGeolocation APIの結果に従う。 */ }
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active()) return;
        const value = position.coords.altitude;
        if (!Number.isFinite(value)) {
          showError("現在地は取得できましたが、端末から標高が返されませんでした。屋外の空が見える場所で、位置情報を有効にしたスマートフォンから再測定してください。パソコンや一部の端末・プレビューでは標高を取得できません。");
          return;
        }
        altitude.textContent = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
        statusText.textContent = "測定成功";
        const uncertainty = position.coords.altitudeAccuracy;
        accuracy.textContent = Number.isFinite(uncertainty) && uncertainty >= 0
          ? `高度の精度：±${Math.ceil(uncertainty).toLocaleString("ja-JP")} m（端末の報告値）`
          : "高度の精度：端末からの情報なし";
        accuracy.hidden = false;
        measuredAt.textContent = `測定時刻：${new Date(position.timestamp).toLocaleTimeString("ja-JP")}`;
        measuredAt.hidden = false;
        finish();
      },
      (error) => {
        if (!active()) return;
        const messages = {
          1: "位置情報の使用が許可されていません。" + permissionHelp,
          2: "現在地を取得できませんでした。端末の位置情報が有効か確認し、屋外の空が見える場所でもう一度お試しください。プレビューの場合は通常のブラウザーでHTTPSのページを開いてください。",
          3: "位置情報の取得がタイムアウトしました。端末の位置情報と許可を確認し、場所を変えて再測定してください。",
        };
        showError(messages[error.code] || "位置情報の取得中にエラーが発生しました。ページを再読み込みして再測定してください。" + permissionHelp);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  } catch {
    showError("位置情報を利用できませんでした。" + permissionHelp);
  }
});

// 読み込み・イベント登録が完了してからボタンを有効にする。
statusText.textContent = "測定待機中：「標高を測定」を押してください";
button.disabled = false;
