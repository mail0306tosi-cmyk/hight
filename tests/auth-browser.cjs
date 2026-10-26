// Firestoreに接続せず、実際のFirebase SDK + Authエミュレーターだけを検証する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
(async () => {
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):9099$/);
  const target = path.resolve('.cache/auth-browser/index.html');
  execFileSync(process.execPath, ['scripts/build.cjs'], { env: { ...process.env, HIGHT_EMULATORS: '1', HIGHT_OUTPUT_FILE: target }, stdio: 'inherit' });
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(target)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [], external = [], outsideResponses = [];
  await page.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.cspViolations.push({ uri: event.blockedURI, directive: event.effectiveDirective })); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (!r.url().startsWith('http://127.0.0.1:')) outsideResponses.push(r.url()); });
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:')) external.push(r.url()); });
  // このテストはAuthのみ。Firestore未起動を明示的なエラー応答に置き換える。
  await page.route('http://127.0.0.1:8080/**', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Auth-only test: Firestore unavailable' } }) }));
  try {
    await page.goto(url);
    const email = `auth-${Date.now()}@example.com`;
    await page.locator('#email').fill(email); await page.locator('#password').fill('Test-pass-1234');
    await page.locator('#register').click();
    await page.locator('#social-feedback').filter({ hasText: '確認メールを送信しました' }).waitFor();
    assert.equal(await page.locator('#verified-features').isVisible(), false);
    assert.match(await page.locator('#verification-state').innerText(), /メール未確認/);
    console.log('PASS 実Auth登録・未確認ユーザーに共有UIを表示しない・確認メール発行');
    await page.locator('#resend-verification').click();
    await page.locator('#social-feedback').filter({ hasText: '再送信しました' }).waitFor();
    const data = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-hight/oobCodes').then(r => r.json());
    const item = data.oobCodes.filter(c => c.email === email && c.requestType === 'VERIFY_EMAIL').at(-1);
    assert.ok(item);
    console.log('PASS 確認メールの再送信');
    const apply = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: item.oobCode }) });
    assert.equal(apply.status, 200);
    await page.locator('#refresh-verification').click();
    await page.locator('#verification-state').filter({ hasText: 'メールアドレス確認済み' }).waitFor();
    await page.locator('#verified-features').waitFor();
    console.log('PASS メール確認リンク適用・IDトークン更新後に共有UIを解放');
    await page.locator('#social-feedback').filter({ hasText: /アクセスが拒否|サーバーに接続/ }).waitFor({ timeout: 25000 });
    assert.equal(await page.locator('#share-altitude').isDisabled(), true);
    assert.equal(await page.locator('#sharing-toggle').isChecked(), false);
    console.log('PASS Firestore接続失敗の案内・未測定では共有不可・初期オフ');
    // 新しいコンテキストは未ログイン。確認済みアカウントのログインをテスト。
    const login = await browser.newPage();
    await login.route('http://127.0.0.1:8080/**', route => route.abort());
    await login.goto(url);
    await login.locator('#email').fill(email); await login.locator('#password').fill('wrong-pass-123');
    await login.locator('#login').click();
    await login.locator('#social-feedback').filter({ hasText: '正しくありません' }).waitFor();
    await login.locator('#password').fill('Test-pass-1234'); await login.locator('#login').click();
    await login.locator('#verification-state').filter({ hasText: 'メールアドレス確認済み' }).waitFor();
    console.log('PASS 不正パスワード拒否・正しいパスワードでログイン');
    // 表示・エラー確認。GPS/Firestoreルールの成功はこのテストでは主張しない。
    for (const width of [320, 375, 430]) { await page.setViewportSize({ width, height: 812 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
    await page.screenshot({ path: '/tmp/hight-firebase-auth.png', fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(outsideResponses, []);
    for (const url of external) {
      assert.match(url, /^https:\/\/www\.google\.com\/images\/cleardot\.gif/);
      const violations = await page.evaluate(() => window.cspViolations);
      assert.ok(violations.some(item => item.uri.startsWith('https://www.google.com') && item.directive === 'img-src'), 'SDKの接続診断画像はCSPで遮断される: ' + JSON.stringify(violations));
    }
    console.log('PASS スマホ幅・実行時エラーなし・本番通信なし');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
