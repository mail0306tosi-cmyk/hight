import { createClient } from './firebase-client.js';
import { relativeUpdatedAt, timestampMillis } from './social-display.js';

(() => {
  const $ = selector => document.querySelector(selector);
  let client, user = null, verified = false, latest = null, connections = [];
  let unsubscribe = () => {}, unsubscribeOwn = () => {}, friendSubscriptions = [], generation = 0, renderGeneration = 0, busy = false, privacyLock = false;
  const sharingNotice = '画面やアプリを閉じても、最後に共有した標高は承認済みの友達に表示され続けます。止めるには「共有停止」を押してください。新しい標高は自動送信されません。';
  let feedbackTimer, friendTimeTimer, refreshFriendTimes = () => {};
  function feedback(message, kind = 'notice') {
    clearTimeout(feedbackTimer);
    const node = $('#social-feedback'); node.textContent = message; node.dataset.kind = kind;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    if (kind === 'success') feedbackTimer = setTimeout(() => { node.textContent = ''; }, 5000);
  }
  const success = message => feedback(message, 'success');
  const date = timestamp => timestamp?.toDate ? timestamp.toDate().toLocaleString('ja-JP') : '不明';
  const format = n => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(n);
  function setShareStatus(message) {
    $('#share-hint').textContent = message;
    const shared = message.match(/^(?:サーバーで)?共有中：([^（。]+? m)/);
    $('#sharing-summary').textContent = shared ? `共有中：${shared[1]}（停止するまで継続）`
      : /^(共有停止済み|サーバー上の共有値はありません)/.test(message) ? '非公開（サーバー確認済み）'
      : '共有状態：未確認（停止済みとは限りません）';
  }
  function explain(error) {
    const messages = {
      'auth/email-already-in-use': 'このメールアドレスでは登録できません。ログインをお試しください。',
      'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません。',
      'auth/user-not-found': 'メールアドレスまたはパスワードが正しくありません。',
      'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
      'auth/invalid-email': 'メールアドレスの形式を確認してください。',
      'auth/weak-password': 'より強いパスワードを設定してください。',
      'auth/too-many-requests': '操作が多すぎます。時間をおいて再度お試しください。',
      'auth/network-request-failed': '接続できません。ネットワークを確認してください。',
      'auth/operation-not-allowed': 'Firebaseでメール・パスワード認証が有効になっているか確認してください。',
      'auth/unauthorized-domain': 'この公開ドメインがFirebase Authenticationで許可されていません。',
      'permission-denied': 'アクセスが拒否されました。メール確認、友達関係、本番ルールの適用状況を確認してください。重複・逆向きの申請も受け付けられません。',
      'unavailable': 'サーバーに接続できません。通信状態を確認してください。',
      'write-uncertain': 'サーバーでの完了を確認できません。未完了の送信・削除は取り消されておらず、後から反映される場合があります。共有停止を再試行してください。',
    };
    return messages[error.code] || (error.code ? '処理に失敗しました。再度お試しください。' : error.message);
  }
  function showVerified(show) {
    document.querySelectorAll('[data-verified]').forEach(el => { el.hidden = !show; });
    document.querySelectorAll('[data-guest]').forEach(el => { el.hidden = show; });
  }
  function controls() {
    $('#login').disabled = $('#register').disabled = !client || busy;
    $('#account-card').querySelectorAll('button').forEach(el => { el.disabled = busy; });
    document.querySelectorAll('[data-verified] button,[data-verified] input').forEach(el => { el.disabled = !verified || busy; });
    $('#share-altitude').disabled = !verified || busy || privacyLock || !latest;
  }
  const stopRisk = '共有停止はまだ確認できていません。最後の共有値がサーバーに残り、承認済みの友達が読める可能性があります。画面を閉じずに通信を確認し、「共有停止」を再試行してください。未完了の送信・削除は後から反映される場合があります。';
  function warnStop(message = stopRisk) {
    $('#stop-warning').textContent = message; $('#stop-warning').hidden = false;
  }
  async function awaitWrite(pending, lateSuccess) {
    let timer, timedOut = false;
    pending.then(() => { if (timedOut) lateSuccess(); }, () => {});
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(Object.assign(new Error('サーバーでの完了を確認できません。操作は取り消されておらず、後から反映される場合があります。'), { code: 'write-uncertain' })); }, 12000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function run(action, { stopIntent = false } = {}) {
    if (stopIntent) { privacyLock = true; warnStop(); }
    if (busy) return;
    if (!navigator.onLine) { feedback('オフラインです。接続後に操作してください。共有停止はサーバーでの完了が必要です。'); controls(); return; }
    busy = true; controls(); feedback('サーバーに確認中です。', 'progress');
    try { await action(); } catch (error) { feedback(explain(error), 'error'); }
    finally { busy = false; controls(); }
  }
  function emptyList() {
    renderGeneration++; clearInterval(friendTimeTimer); refreshFriendTimes = () => {};
    friendSubscriptions.forEach(stop => stop()); friendSubscriptions = [];
    $('#friends-list').replaceChildren(); $('#requests-list').replaceChildren();
    $('#requests-summary').textContent = '申請管理（0件）';
    $('#friends-empty').hidden = false;
    $('#friends-empty').textContent = '承認済みの友達はいません。';
  }
  function actionButton(text, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = text;
    button.addEventListener('click', () => run(action));
    return button;
  }
  async function renderConnections() {
    emptyList();
    const rendering = renderGeneration, session = generation, current = user;
    if (!verified || !current) return;
    const accepted = connections.filter(item => item.status === 'accepted');
    $('#friends-empty').hidden = accepted.length > 0;
    const pending = connections.filter(item => item.status !== 'accepted');
    $('#requests-summary').textContent = `申請管理（${pending.length}件）`;
    for (const item of pending) {
      const li = document.createElement('li'), label = document.createElement('p');
      label.className = 'caption';
      const incoming = item.recipient === current.uid;
      label.textContent = item.status === 'rejected' ? '拒否済みの申請（標高は非公開）' : incoming ? '受信した友達申請' : '送信した友達申請：承認待ち';
      const identity = document.createElement('p'); identity.className = 'caption';
      identity.textContent = `相手のユーザーID：${incoming ? item.sender : item.recipient}`;
      li.append(label, identity);
      if (incoming && item.status === 'pending') {
        li.append(actionButton('承認', async () => { await client.decide(item.id, 'accepted'); success('友達申請を承認しました。'); }),
          actionButton('拒否', async () => { await client.decide(item.id, 'rejected'); success('申請を拒否しました。'); }));
      }
      li.append(actionButton('申請を削除', async () => { await client.removeFriend(item.id); success('申請を削除しました。'); }));
      $('#requests-list').append(li);
    }
    const cards = [];
    refreshFriendTimes = () => {
      if (session !== generation || rendering !== renderGeneration) return;
      cards.forEach(card => card.refreshTime?.());
    };
    if (accepted.length) friendTimeTimer = setInterval(() => refreshFriendTimes(), 30000);
    const collator = new Intl.Collator('ja');
    const reorder = () => {
      cards.sort((a, b) => Number(b.shared) - Number(a.shared) ||
        (a.shared && b.shared ? b.updated - a.updated : 0) ||
        collator.compare(a.name.textContent, b.name.textContent) || a.uid.localeCompare(b.uid));
      for (const card of cards) $('#friends-list').append(card.li);
    };
    for (const item of accepted) {
      const other = item.sender === current.uid ? item.recipient : item.sender;
      const li = document.createElement('li'), name = document.createElement('strong'), details = document.createElement('p');
      name.textContent = '友達'; details.className = 'caption'; details.textContent = '標高をサーバーで確認中…';
      li.className = 'friend-card'; li.dataset.uid = other; li.dataset.shared = 'false';
      const top = document.createElement('div'), state = document.createElement('span'), reading = document.createElement('p');
      top.className = 'friend-top'; state.className = 'friend-state'; state.textContent = '確認中';
      reading.className = 'friend-altitude'; reading.textContent = '—';
      top.append(name, state);
      const card = { li, name, uid: other, shared: false, updated: 0 }; cards.push(card);
      const menu = document.createElement('details'), menuLabel = document.createElement('summary'), extra = document.createElement('p');
      menu.className = 'friend-menu'; menu.id = `friend-menu-${cards.length}`;
      menuLabel.textContent = '⋯'; menuLabel.setAttribute('aria-label', '友達の操作');
      menu.append(menuLabel, extra, actionButton('友達を解除', async () => {
        await client.removeFriend(item.id); li.remove(); success('友達を解除しました。お互いの標高にアクセスできなくなりました。');
      }));
      li.append(top, reading, details, menu);
      $('#friends-list').append(li);
      const active = () => session === generation && rendering === renderGeneration;
      // 停止/権限失効の通知で表示済みの値も消す。キャッシュの値は表示しない。
      friendSubscriptions.push(client.watchShare(other, (share, confirmed) => {
        if (!active()) return;
        card.shared = !!(confirmed && share && Number.isFinite(share.altitude));
        const updated = timestampMillis(share?.updatedAt);
        card.updated = card.shared && Number.isFinite(updated) ? updated : 0;
        li.dataset.shared = String(card.shared);
        reading.textContent = card.shared ? `${format(share.altitude)} m` : '—';
        state.textContent = !confirmed ? '確認中' : card.shared ? '共有中' : '非公開';
        details.title = '';
        card.refreshTime = card.shared ? () => {
          const label = relativeUpdatedAt(share.updatedAt);
          details.textContent = `${label === '更新情報なし' ? label : `更新：${label}`}${Number.isFinite(share.altitudeAccuracy) && share.altitudeAccuracy >= 0 ? ` ／ 高度精度（報告値）：±${share.altitudeAccuracy} m` : ''}`;
          details.title = timestampMillis(share.updatedAt) === null ? '' : `最終更新：${date(share.updatedAt)}`;
        } : null;
        if (card.refreshTime) card.refreshTime();
        else details.textContent = !confirmed ? 'サーバー確認待ちです。以前の標高は表示しません。'
          : '共有停止中・標高は非公開／更新情報なし';
        extra.textContent = card.shared ? `測定：${date(share.measuredAt)}（サーバー確認済み）。共有値は参考高度です。` : '';
        reorder();
      }, () => {
        if (active()) {
          card.shared = false; card.updated = 0; card.refreshTime = null; details.title = ''; li.dataset.shared = 'false';
          reading.textContent = '—'; state.textContent = '確認不可'; extra.textContent = '';
          details.textContent = '標高を取得できません。共有停止・友達解除・通信状態を確認してください。再開後は更新ボタンを押してください。';
          reorder();
        }
      }));
      try {
        const profile = await client.profile(other);
        if (!active()) return;
        name.textContent = profile?.nickname || '友達'; menuLabel.setAttribute('aria-label', `${name.textContent}の操作`); reorder();
      } catch { if (active()) { name.textContent = '友達（プロフィール取得不可）'; reorder(); } }

    }
    controls();
  }
  async function session(nextUser) {
    const sameUser = user?.uid === nextUser?.uid;
    const currentGeneration = ++generation;
    unsubscribe(); unsubscribeOwn(); unsubscribe = () => {}; unsubscribeOwn = () => {}; verified = false; user = nextUser; latest = null; connections = [];
    emptyList(); if (!sameUser) { privacyLock = false; $('#stop-warning').hidden = true; }
    $('#auth-card').hidden = !!user; $('#account-card').hidden = !user; showVerified(false);
    setShareStatus('サーバーの共有状態は未確認です。まだ送信していません。');
    $('#nickname').value = ''; $('#invite-code').textContent = 'プロフィールを保存すると発行されます';
    $('#password').value = ''; controls();
    if (!user) { $('#connection-status').textContent = 'ログインしなくても標高を測定できます。共有にはログインとメール確認が必要です。'; return; }
    $('#account-email').textContent = user.email;
    $('#verification-state').textContent = 'メールの確認状態を確認中…';
    try {
      const result = user.emailVerified && await client.verified(user);
      if (currentGeneration !== generation) return;
      verified = !!result;
      $('#verification-state').textContent = verified ? 'メールアドレス確認済み' : 'メール未確認：共有・友達申請は利用できません。';
      showVerified(verified); $('#resend-verification').hidden = verified;
      $('#connection-status').textContent = verified ? 'Firebaseに接続しました。標高の送信は共有ボタンを押した時だけです。' : '確認メールのリンクを開き、確認状態を更新してください。';
      controls();
      if (!verified) return;
      unsubscribeOwn = client.watchShare(user.uid, (shared, confirmed) => {
        if (currentGeneration !== generation) return;
        setShareStatus(!confirmed ? 'サーバーの共有状態を確認中です。'
          : shared ? `サーバーで共有中：${format(shared.altitude)} m（最終共有：${date(shared.updatedAt)}）。${sharingNotice}`
          : 'サーバー上の共有値はありません。非公開です。');
      }, error => {
        if (currentGeneration === generation) {
          setShareStatus('サーバーの共有状態を確認できません。停止済みとは確認できていません。');
          feedback(explain(error), 'error');
        }
      });
      const [profile, privateProfile] = await Promise.all([client.profile(user.uid), client.privateProfile(user.uid)]);
      if (currentGeneration !== generation) return;
      if (profile) $('#nickname').value = profile.nickname;
      if (privateProfile) $('#invite-code').textContent = privateProfile.inviteCode;
      else if (profile) $('#invite-code').textContent = 'プロフィールを保存して招待コードを安全な形式へ移行してください。';
      unsubscribe = client.connections(user.uid, items => {
        if (currentGeneration !== generation) return;
        connections = items || []; void renderConnections();
        if (!items) $('#friends-empty').textContent = 'サーバー確認待ちです。友達の以前の標高は表示しません。';
      }, error => { if (currentGeneration === generation) { emptyList(); feedback(explain(error), 'error'); } });
    } catch (error) {
      if (currentGeneration === generation) { emptyList(); feedback(explain(error), 'error'); }
      return false;
    }
  }
  $('#auth-form').addEventListener('submit', event => {
    event.preventDefault(); void run(async () => { await client.login($('#email').value.trim(), $('#password').value); success('ログインしました。メール確認状態を確認しています。'); });
  });
  $('#register').addEventListener('click', () => {
    if (!$('#auth-form').reportValidity()) return;
    void run(async () => {
      await client.register($('#email').value.trim(), $('#password').value);
      try { await client.sendVerification(); success('登録しました。確認メールを送信しました。メール内のリンクを開いてください。'); }
      catch (error) { feedback('アカウントは登録済みですが確認メールを送れませんでした。再送信してください。' + explain(error)); }
    });
  });
  $('#resend-verification').addEventListener('click', () => run(async () => { await client.sendVerification(); success('確認メールを再送信しました。迷惑メールフォルダーも確認してください。'); }));
  $('#refresh-verification').addEventListener('click', () => run(async () => { const updated = await client.refresh(); const ready = await session(updated); if (ready !== false) { if (updated.emailVerified) success('メール確認済みです。'); else feedback('まだメール未確認です。メール内のリンクを開いてください。'); } }));
  $('#profile-form').addEventListener('submit', event => {
    event.preventDefault(); if (!verified) return;
    void run(async () => {
      const name = $('#nickname').value.trim();
      if (!name || name.length > 20) throw Error('ニックネームは空白以外の1〜20文字で入力してください。');
      const code = await client.saveProfile(user.uid, name); $('#invite-code').textContent = code; success('プロフィールを保存しました。');
    });
  });
  $('#friend-form').addEventListener('submit', event => {
    event.preventDefault(); if (!verified) return;
    void run(async () => {
      const code = $('#friend-code').value.trim().toUpperCase();
      if (!/^[A-F0-9]{32}$/.test(code)) throw Error('32桁の招待コードを確認してください。');
      await client.requestFriend(user.uid, code); $('#friend-code').value = ''; success('申請を送信しました。相手の承認後に友達になります。');
    });
  });
  async function stop() {
    const epoch = generation, uid = user.uid;
    const confirmed = () => {
      if (epoch !== generation || user?.uid !== uid) return;
      privacyLock = false; $('#stop-warning').hidden = true;
      setShareStatus('共有停止済み：サーバーの標高を削除しました。');
      success('共有を停止しました。友達はサーバーから標高を取得できません。'); controls();
    };
    try { await awaitWrite(client.stop(uid), confirmed); confirmed(); }
    catch (error) { warnStop(); throw error; }
  }
  $('#stop-sharing').addEventListener('click', () => run(stop, { stopIntent: true }));
  $('#share-altitude').addEventListener('click', () => {
    if (!verified || privacyLock || !latest) return;
    const snapshot = { ...latest };
    void run(async () => {
      const epoch = generation, uid = user.uid;
      try {
        await awaitWrite(client.share(uid, snapshot), () => {
          if (epoch !== generation || user?.uid !== uid) return;
          privacyLock = true; warnStop('前の共有操作が遅れてサーバーへ反映されました。最後の標高を友達が読める可能性があります。止めるには「共有停止」を押してください。'); controls();
        });
      } catch (error) { privacyLock = true; warnStop(); throw error; }
      setShareStatus(`共有中：${format(snapshot.altitude)} m。${sharingNotice}`);
      success('標高を共有しました。');
    });
  });
  $('#refresh-friends').addEventListener('click', () => run(async () => { await renderConnections(); success('友達の表示を更新しました。取得に失敗した場合は一覧の案内を確認してください。'); }));
  $('#logout').addEventListener('click', () => run(async () => {
    if (verified) await stop();
    await client.logout(); success('ログアウトしました。');
  }, { stopIntent: verified }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFriendTimes(); });
  document.addEventListener('hight:measurement-reset', () => { latest = null; controls(); });
  document.addEventListener('hight:measurement', event => {
    if (Number.isFinite(event.detail.altitude)) latest = { altitude: event.detail.altitude, timestamp: event.detail.timestamp };
    controls();
  });
  try {
    client = createClient();
    if (!client) { $('#connection-status').textContent = 'Firebaseの公開Webアプリ設定が未入力です。標高測定は利用できます。'; controls(); return; }
    client.observeAuth(next => { void session(next); });
    controls();
  } catch { $('#connection-status').textContent = 'Firebaseを初期化できません。設定とブラウザーのストレージ設定を確認してください。標高測定は利用できます。'; }
})();
