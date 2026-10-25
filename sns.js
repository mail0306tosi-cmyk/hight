// SNSは端末内デモ。測定値はメモリーだけに保持し、通信・永続保存しない。
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const key = 'hight.social-demo.v1';
  const catalog = {
    'DEMO-SORA': { name: 'そら', altitude: 124, updated: '2026-10-25T09:00:00+09:00' },
    'DEMO-YAMA': { name: 'やま', altitude: 862, updated: '2026-10-24T15:30:00+09:00' },
  };
  let profile = { nickname: '', code: '', friends: [] };
  let storageAvailable = true;
  let latest = null;
  let shared = null;
  const format = value => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(value);
  const time = value => new Date(value).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function storageWarning() {
    storageAvailable = false;
    $('#storage-notice').textContent = 'ブラウザー内に保存できません。今の画面では利用できますが、再読み込みするとプロフィール・コード・友達はリセットされます。';
  }
  function persist() {
    if (!storageAvailable) return;
    try { localStorage.setItem(key, JSON.stringify(profile)); } catch { storageWarning(); }
  }
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (stored && typeof stored === 'object') {
      profile.nickname = typeof stored.nickname === 'string' ? [...stored.nickname.trim()].slice(0, 20).join('') : '';
      profile.code = typeof stored.code === 'string' && /^HIGHT-[A-F0-9]{16}$/.test(stored.code) ? stored.code : '';
      profile.friends = Array.isArray(stored.friends) ? [...new Set(stored.friends.filter(code => Object.hasOwn(catalog, code)))] : [];
    }
  } catch { storageWarning(); }
  if (!profile.code) {
    const bytes = new Uint8Array(8);
    // 認証情報ではなく、このブラウザー用のデモ識別子。
    if (globalThis.crypto && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    profile.code = 'HIGHT-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  persist();
  $('#nickname').value = profile.nickname;
  $('#invite-code').textContent = profile.code;
  $('#profile-feedback').textContent = profile.nickname ? `登録中：${profile.nickname}` : 'ニックネームを登録してください。';

  $('#profile-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#nickname').value.trim();
    if (!name || [...name].length > 20) {
      $('#profile-feedback').textContent = 'ニックネームは空白以外の1〜20文字で入力してください。';
      return;
    }
    profile.nickname = name;
    persist();
    $('#nickname').value = name;
    $('#profile-feedback').textContent = `${name} を${storageAvailable ? 'このブラウザーに保存しました' : 'この画面に登録しました（保存不可）'}。`;
  });

  function renderFriends() {
    $('#friends-list').replaceChildren();
    $('#friends-empty').hidden = profile.friends.length > 0;
    for (const code of profile.friends) {
      const friend = catalog[code];
      const li = document.createElement('li');
      const heading = document.createElement('div');
      heading.className = 'friend-heading';
      const name = document.createElement('strong');
      name.textContent = friend.name;
      const value = document.createElement('strong');
      value.textContent = `${format(friend.altitude)} m`;
      heading.append(name, value);
      const updated = document.createElement('p');
      updated.className = 'caption';
      updated.textContent = `最終更新（架空）：${time(friend.updated)}`;
      li.append(heading, updated);
      $('#friends-list').append(li);
    }
  }
  $('#friend-form').addEventListener('submit', event => {
    event.preventDefault();
    const code = $('#friend-code').value.trim().toUpperCase();
    let message;
    if (code === profile.code) message = '自分の招待コードは追加できません。サンプルコードを使ってください。';
    else if (!Object.hasOwn(catalog, code)) message = 'デモでは DEMO-SORA / DEMO-YAMA のみ使えます。実際の招待コードの検索・友達登録はできません。';
    else if (profile.friends.includes(code)) message = 'このサンプルの友達はすでに追加されています。';
    else {
      profile.friends.push(code);
      persist();
      renderFriends();
      message = `${catalog[code].name} のサンプルを追加しました。実際の友達登録や同期は行っていません。`;
      $('#friend-code').value = '';
    }
    $('#friend-feedback').textContent = message;
  });
  function renderSharing() {
    const enabled = $('#sharing-toggle').checked;
    $('#sharing-state').textContent = enabled ? 'オン（デモ）' : 'オフ';
    $('#share-altitude').disabled = !enabled || !latest;
    $('#share-hint').textContent = !enabled ? '共有はオフです。オンにしても自動共有はされません。' : !latest ? '標高を測定してから共有できます。' : '測定済みの標高だけを端末内のプレビューに反映します。位置情報は送信しません。';
    $('#shared-preview').hidden = !shared;
    if (shared) {
      $('#shared-value').textContent = `${format(shared.altitude)} m`;
      $('#shared-time').textContent = `測定：${time(shared.timestamp)} ／ 共有操作：${time(shared.sharedAt)}`;
    }
  }
  $('#sharing-toggle').checked = false;
  $('#sharing-toggle').disabled = false;
  $('#sharing-toggle').addEventListener('change', () => {
    if (!$('#sharing-toggle').checked) shared = null;
    $('#share-feedback').textContent = $('#sharing-toggle').checked ? '共有をオンにしました。まだ共有していません。' : '共有をオフにし、共有プレビューを消去しました。';
    renderSharing();
  });
  document.addEventListener('hight:measurement-reset', () => { latest = null; renderSharing(); });
  document.addEventListener('hight:measurement', event => {
    if (!Number.isFinite(event.detail.altitude)) return;
    latest = { altitude: event.detail.altitude, timestamp: event.detail.timestamp };
    renderSharing();
  });
  $('#share-altitude').addEventListener('click', () => {
    if (!$('#sharing-toggle').checked || !latest) return;
    shared = { ...latest, sharedAt: Date.now() };
    $('#share-feedback').textContent = 'デモの共有プレビューを更新しました。端末内だけの表示で、友達への送信・データ同期はしていません。';
    renderSharing();
  });
  renderFriends();
  renderSharing();
})();
