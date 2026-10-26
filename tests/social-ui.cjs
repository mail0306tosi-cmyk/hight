// UIの操作テスト。Firebaseクライアントは模擬。サーバールールの検証ではない。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
(async () => {
  // プラグインには非同期ビルドAPIを使う。
  const built = await esbuild.build({ entryPoints: ['sns.js'], bundle: true, write: false, format: 'iife', plugins: [{ name: 'ui-fixture', setup(build) {
    build.onLoad({ filter: /firebase-client\.js$/ }, () => ({ contents: fs.readFileSync('tests/fixtures/client.js', 'utf8'), loader: 'js' }));
  } }] });
  const script = '\n' + fs.readFileSync('app.js', 'utf8') + '\n;\n' + built.outputFiles[0].text + '\n';
  const hash = createHash('sha256').update(script).digest('base64');
  const html = fs.readFileSync('index.html', 'utf8').replace(/<!-- HIGHT:SCRIPT -->[\s\S]*?<!-- \/HIGHT:SCRIPT -->/, () => `<!-- HIGHT:SCRIPT --><script>${script}</script><!-- /HIGHT:SCRIPT -->`).replace(/script-src 'sha256-[^']*'/, `script-src 'sha256-${hash}'`);
  const server = http.createServer((req,res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await page.addInitScript(() => {
      window.measurements = 0; window.value = 100;
      Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'granted' }) } });
      let nextWatch = 0; const watches = new Map();
      Object.defineProperty(navigator, 'geolocation', { value: {
        watchPosition(ok, fail) {
          window.measurements++; const id = nextWatch++; const timers = [];
          watches.set(id, timers);
          if (window.value === null) fail({ code: 2 });
          else for (let i = 1; i <= 8; i++) timers.push(setTimeout(() => ok({ coords: { altitude: window.value, altitudeAccuracy: 4, latitude: 35, longitude: 139 }, timestamp: Date.now() }), i * 800));
          return id;
        },
        clearWatch(id) { (watches.get(id) || []).forEach(clearTimeout); watches.delete(id); },
      } });
    });
    let virtualTime = false;
    async function measure() {
      await page.locator('#measure').click();
      if (virtualTime) for (let i = 0; i < 8; i++) await page.clock.fastForward(800);
      await page.locator('#status').filter({ hasText: /^(測定成功|測定失敗)$/ }).waitFor();
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#email').fill('alice@example.com'); await page.locator('#password').fill('Test-pass-123'); await page.locator('#register').click();
    await page.locator('#social-feedback').filter({ hasText: '確認メールを送信しました' }).waitFor();
    assert.equal(await page.locator('#verified-features').isVisible(), false);
    await page.locator('#refresh-verification').click(); await page.locator('#verified-features').waitFor();
    await page.locator('#nickname').fill('そら'); await page.locator('#profile-form button').click();
    await page.locator('#invite-code').filter({ hasText: 'A'.repeat(32) }).waitFor();
    console.log('PASS UI: 登録/確認前非表示/確認後に解放/プロフィール');
    assert.match(await page.locator('#sharing-persistence-notice').innerText(), /画面やアプリを閉じても.*共有停止.*新しい標高は自動送信されません/);
    assert.match(await page.locator('#sharing-state').innerText(), /共有停止ではありません/);
    assert.equal(await page.locator('#sharing-toggle').isChecked(), false);
    assert.equal(await page.locator('#share-altitude').isDisabled(), true);
    await page.locator('#sharing-toggle').check(); assert.equal(await page.evaluate(() => measurements), 0);
    await measure();
    assert.equal(await page.evaluate(() => uiFixture.calls.filter(x => x[0] === 'share').length), 0);
    await page.locator('#share-altitude').click();
    await page.locator('#social-feedback').filter({ hasText: '標高を共有しました' }).waitFor();
    assert.match(await page.locator('#share-hint').innerText(), /共有中.*画面やアプリを閉じても.*新しい標高は自動送信されません/);
    const shared = await page.evaluate(() => uiFixture.calls.find(x => x[0] === 'share')[1]);
    assert.deepEqual(Object.keys(shared).sort(), ['altitude','timestamp']); assert.equal(shared.altitude, 100);
    await page.evaluate(() => { window.value = 200; }); await measure();
    assert.equal(await page.evaluate(() => uiFixture.calls.filter(x => x[0] === 'share').length), 1);
    await page.evaluate(() => { window.value = null; }); await measure();
    assert.equal(await page.locator('#share-altitude').isDisabled(), true);
    console.log('PASS UI: 初期非公開/オンと測定は未送信/共有ボタンのみ値を渡す/緯度経度なし/測定失敗時無効');
    await page.evaluate(() => uiFixture.incoming());
    await page.locator('#requests-list button').filter({ hasText: /^承認$/ }).click();
    await page.locator('#friends-list').filter({ hasText: '862 m' }).waitFor();
    await page.locator('#friends-list button').filter({ hasText: '友達を解除' }).click();
    await page.locator('#friends-empty').waitFor();
    assert.equal(await page.evaluate(() => uiFixture.active.size), 1, '友達のリスナーを解除し、本人の状態リスナーだけ残す');
    await page.evaluate(() => uiFixture.late());
    assert.equal(await page.locator('#friends-list li').count(), 0, '解除後の遅延通知でも表示を復活させない');
    console.log('PASS UI: 受信申請の承認/友達の標高と時刻/解除で一覧消去・購読解除/遅延通知の無視');
    await page.clock.install(); virtualTime = true;
    await page.evaluate(() => { window.value = 300; uiFixture.sharePending = true; });
    await measure();
    await page.locator('#share-altitude').click();
    await page.clock.fastForward(12001);
    await page.locator('#social-feedback').filter({ hasText: '後から反映' }).waitFor();
    assert.equal(await page.locator('#share-altitude').isDisabled(), true);
    await page.evaluate(() => uiFixture.resolveShare());
    await page.locator('#stop-warning').filter({ hasText: '前の共有操作が遅れて' }).waitFor();
    await page.evaluate(() => { uiFixture.sharePending = false; });
    await page.locator('#refresh-verification').click();
    await page.locator('#social-feedback').filter({ hasText: 'メール確認済みです' }).waitFor();
    await measure();
    await page.locator('#sharing-toggle').check();
    assert.equal(await page.locator('#share-altitude').isDisabled(), true, '確認状態の再取得でも未完了共有のロックを解除しない');
    assert.equal(await page.locator('#stop-warning').isVisible(), true);
    console.log('PASS UI: 共有タイムアウトは取消しではない・遅延送信を警告・停止確認まで再共有を抑止');
    await page.evaluate(() => uiFixture.ownCallback(undefined, false));
    assert.match(await page.locator('#share-hint').innerText(), /確認中/);
    await page.evaluate(() => uiFixture.ownError({ code: 'unavailable' }));
    assert.match(await page.locator('#share-hint').innerText(), /停止済みとは確認できていません/);
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
    await page.locator('#stop-sharing').click();
    assert.match(await page.locator('#stop-warning').innerText(), /サーバーに残り.*友達が読める可能性/);
    assert.equal(await page.locator('#share-altitude').isDisabled(), true);
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }));
    await page.evaluate(() => { uiFixture.failStop = true; });
    await page.locator('#logout').click();
    await page.locator('#social-feedback').filter({ hasText: 'サーバーに接続できません' }).waitFor();
    assert.equal(await page.locator('#account-card').isVisible(), true);
    assert.equal((await page.locator('#share-hint').innerText()).includes('共有停止済み：'), false);
    assert.equal((await page.locator('#social-feedback').innerText()).includes('共有を停止しました'), false);
    assert.equal(await page.evaluate(() => uiFixture.calls.some(x => x[0] === 'logout')), false);
    assert.match(await page.locator('#stop-warning').innerText(), /後から反映/);
    // 未完了削除は画面のタイムアウト後も取り消しではない。再試行でき、遅い成功だけで非公開に戻る。
    await page.evaluate(() => { uiFixture.failStop = false; uiFixture.stopPending = true; });
    await page.locator('#stop-sharing').click();
    await page.clock.fastForward(12001);
    await page.locator('#social-feedback').filter({ hasText: '後から反映' }).waitFor();
    assert.equal(await page.locator('#stop-sharing').isEnabled(), true);
    assert.equal(await page.locator('#share-altitude').isDisabled(), true);
    assert.equal(await page.locator('#stop-warning').isVisible(), true);
    await page.evaluate(() => uiFixture.resolveStop());
    await page.locator('#social-feedback').filter({ hasText: '共有を停止しました' }).waitFor();
    assert.equal(await page.locator('#stop-warning').isVisible(), false);
    assert.equal(await page.locator('#account-card').isVisible(), true, '遅延成功で自動ログアウトはしない');
    await page.evaluate(() => { uiFixture.stopPending = false; });
    console.log('PASS UI: オフライン/停止失敗/削除タイムアウト警告・再試行可能・遅延完了確認');
    await page.evaluate(() => { uiFixture.failStop = false; });
    await page.locator('#stop-sharing').click();
    await page.locator('#social-feedback').filter({ hasText: '共有を停止しました' }).waitFor();
    assert.equal(await page.locator('#sharing-toggle').isChecked(), false);
    await page.locator('#logout').click(); await page.locator('#auth-card').waitFor();
    assert.equal(await page.evaluate(() => uiFixture.active.size), 0, 'ログアウトで全購読を解除');
    console.log('PASS UI: 停止失敗時はログアウト完了扱いにしない/停止成功/ログアウト');
    for (const width of [320,375,430]) { await page.setViewportSize({ width, height:812 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
    assert.deepEqual(errors,[]); assert.equal(requests.length,1);
    console.log('PASS UI: スマホ3幅/実行時エラーなし/模擬テスト中の外部通信なし');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
