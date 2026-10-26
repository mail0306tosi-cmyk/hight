// 実際のFirebase SDK + Auth/Firestoreエミュレーターによる2ブラウザー統合テスト。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDocFromServer: getDoc } = require('firebase/firestore');
(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8080$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):9099$/);
  const output = path.resolve('.cache/browser/index.html');
  execFileSync(process.execPath, ['scripts/build.cjs'], { env: { ...process.env, HIGHT_EMULATORS: '1', HIGHT_OUTPUT_FILE: output }, stdio: 'inherit' });
  const html = fs.readFileSync(output);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const env = await initializeTestEnvironment({ projectId: 'demo-hight', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
  const errors = [], external = [];
  const stamp = Date.now();
  async function verifyEmail(email) {
    const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-hight/oobCodes');
    const codes = (await response.json()).oobCodes;
    const code = codes.filter(c => c.email === email && c.requestType === 'VERIFY_EMAIL').at(-1);
    assert.ok(code, '確認メールがエミュレーターに発行される');
    const result = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: code.oobCode }),
    });
    assert.equal(result.status, 200);
  }
  async function newAccount(label) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'granted' }) } });
      let nextWatch = 0; const watches = new Map();
      Object.defineProperty(navigator, 'geolocation', { value: {
        watchPosition(ok) {
          const id = nextWatch++, timers = []; watches.set(id, timers);
          for (let i = 1; i <= 8; i++) timers.push(setTimeout(() => ok({ coords: { altitude: window.testAltitude ?? 123, altitudeAccuracy: 3, latitude: 35, longitude: 139 }, timestamp: Date.now() }), i * 800));
          return id;
        },
        clearWatch(id) { (watches.get(id) || []).forEach(clearTimeout); watches.delete(id); },
      } });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:')) external.push(req.url()); });
    await page.goto(url);
    const email = `${label}-${stamp}@example.com`;
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('Hight-test-12345');
    const signupResponse = page.waitForResponse(r => r.url().includes('accounts:signUp'));
    await page.locator('#register').click();
    const oldToken = (await (await signupResponse).json()).idToken;
    assert.ok(oldToken);
    await page.locator('#social-feedback').filter({ hasText: '確認メールを送信しました' }).waitFor();
    assert.equal(await page.locator('#verified-features').isVisible(), false);
    await page.locator('#resend-verification').click();
    await page.locator('#social-feedback').filter({ hasText: '再送信しました' }).waitFor();
    const probeCode = 'D'.repeat(32);
    const { setDoc } = require('firebase/firestore');
    await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'invites', probeCode), { uid: 'probe' }));
    const checkOldToken = () => fetch(`http://127.0.0.1:8080/v1/projects/demo-hight/databases/(default)/documents/invites/${probeCode}`, { headers: { Authorization: `Bearer ${oldToken}` } });
    assert.equal((await checkOldToken()).status, 403, '実在する招待ドキュメントを未確認トークンで拒否');
    await verifyEmail(email);
    assert.equal((await checkOldToken()).status, 403, '確認リンク適用後も古いトークンは拒否');
    await page.locator('#refresh-verification').click();
    await page.locator('#verified-features').waitFor();
    await page.locator('#nickname').fill(label);
    await page.locator('#profile-form button').click();
    await page.locator('#social-feedback').filter({ hasText: 'プロフィールを保存しました' }).waitFor();
    const code = await page.locator('#invite-code').innerText();
    let uid;
    await env.withSecurityRulesDisabled(async c => { uid = (await getDoc(doc(c.firestore(), 'invites', code))).data().uid; });
    return { context, page, code, uid, email };
  }
  try {
    const alice = await newAccount('alice'), bob = await newAccount('bob');
    console.log('PASS 実在する招待データの未確認JWT拒否・確認リンク後も古いJWT拒否・更新後に書込成功');
    console.log('PASS 2ユーザーの新規登録・未確認時の制限・確認メール再送・確認後トークン更新・プロフィール');
    async function shareExists() {
      let data;
      await env.withSecurityRulesDisabled(async c => { const snap = await getDoc(doc(c.firestore(), 'shares', alice.uid)); data = snap.exists() ? snap.data() : null; });
      return data;
    }
    await alice.page.locator('#measure').click();
    assert.equal(await alice.page.locator('#share-altitude').isDisabled(), true);
    await alice.page.locator('#status').filter({ hasText: '測定成功' }).waitFor();
    assert.equal(await shareExists(), null);
    await alice.page.locator('#sharing-toggle').check();
    assert.equal(await shareExists(), null);
    await alice.page.locator('#share-altitude').click();
    await alice.page.locator('#social-feedback').filter({ hasText: '標高を共有しました' }).waitFor();
    assert.match(await alice.page.locator('#sharing-persistence-notice').innerText(), /画面やアプリを閉じても.*新しい標高は自動送信されません/);
    assert.match(await alice.page.locator('#share-hint').innerText(), /共有中.*画面やアプリを閉じても/);
    let share = await shareExists();
    assert.deepEqual(Object.keys(share).sort(), ['altitude', 'measuredAt', 'updatedAt']);
    assert.equal(share.altitude, 123);
    await alice.page.evaluate(() => { window.testAltitude = 222; });
    await alice.page.locator('#measure').click();
    assert.equal(await alice.page.locator('#share-altitude').isDisabled(), true);
    await alice.page.locator('#status').filter({ hasText: '測定成功' }).waitFor();
    assert.equal((await shareExists()).altitude, 123);
    const bobDb = env.authenticatedContext(bob.uid, { email_verified: true }).firestore();
    await assertFails(getDoc(doc(bobDb, 'shares', alice.uid)));
    console.log('PASS 測定/トグルだけでは未送信・ボタンのみ標高送信・緯度経度なし・再測定では未更新');
    await alice.page.locator('summary').click();
    await alice.page.locator('#friend-code').fill(bob.code);
    await alice.page.locator('#friend-form button').click();
    await bob.page.locator('#requests-list button').filter({ hasText: /^承認$/ }).waitFor();
    assert.equal(await alice.page.locator('#friends-list li').count(), 0);
    await assertFails(getDoc(doc(bobDb, 'shares', alice.uid)));
    await bob.page.locator('#requests-list button').filter({ hasText: /^承認$/ }).click();
    await bob.page.locator('#friends-list').filter({ hasText: '123 m' }).waitFor();
    assert.deepEqual((await getDoc(doc(bobDb, 'profiles', alice.uid))).data(), { nickname: 'alice' });
    await assertFails(getDoc(doc(bobDb, 'privateProfiles', alice.uid)));
    assert.equal((await getDoc(doc(env.authenticatedContext(alice.uid, { email_verified: true }).firestore(), 'privateProfiles', alice.uid))).data().inviteCode, alice.code);
    console.log('PASS 申請・受信側承認・承認済み友達の標高/時刻表示・友達に招待コードを公開しない');
    // 両者が共有し、双方に実在する値を見せた上で解除をテストする。
    await bob.page.locator('#measure').click();
    await bob.page.locator('#status').filter({ hasText: '測定成功' }).waitFor();
    await bob.page.locator('#sharing-toggle').check();
    await bob.page.locator('#share-altitude').click();
    await bob.page.locator('#social-feedback').filter({ hasText: '標高を共有しました' }).waitFor();
    await alice.page.locator('#refresh-friends').click();
    await alice.page.locator('#friends-list').filter({ hasText: '123 m' }).waitFor();
    const aliceDb = env.authenticatedContext(alice.uid, { email_verified: true }).firestore();
    assert.equal((await getDoc(doc(aliceDb, 'shares', bob.uid))).data().altitude, 123);
    console.log('PASS 双方向に実在する共有データのサーバー取得');
    const beforeClose = await shareExists();
    await alice.page.close();
    assert.equal((await getDoc(doc(bobDb, 'shares', alice.uid))).data().altitude, 123);
    alice.page = await alice.context.newPage();
    alice.page.on('pageerror', e => errors.push(e.message));
    alice.page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:')) external.push(req.url()); });
    await alice.page.goto(url);
    await alice.page.locator('#email').fill(alice.email);
    await alice.page.locator('#password').fill('Hight-test-12345');
    await alice.page.locator('#login').click();
    await alice.page.locator('#share-hint').filter({ hasText: 'サーバーで共有中：123 m' }).waitFor();
    assert.match(await alice.page.locator('#share-hint').innerText(), /画面やアプリを閉じても.*共有停止.*新しい標高は自動送信されません/);
    assert.match(await alice.page.locator('#sharing-state').innerText(), /準備なし（共有停止ではありません）/);
    assert.equal((await shareExists()).updatedAt.toMillis(), beforeClose.updatedAt.toMillis());
    await alice.page.evaluate(() => { window.testAltitude = 222; });
    await alice.page.locator('#measure').click();
    assert.equal(await alice.page.locator('#share-altitude').isDisabled(), true);
    await alice.page.locator('#status').filter({ hasText: '測定成功' }).waitFor();
    console.log('PASS 実際に画面を閉じても最後の標高を友達が取得可能・再ログイン後の共有中表示と注意文・自動更新なし');
    await alice.page.locator('#stop-sharing').click();
    await alice.page.locator('#social-feedback').filter({ hasText: '共有を停止しました' }).waitFor();
    assert.equal(await shareExists(), null);
    await assertFails(getDoc(doc(bobDb, 'shares', alice.uid)));
    await bob.page.locator('#friends-list').filter({ hasText: '標高を取得できません' }).waitFor();
    assert.equal(await bob.page.locator('#friends-list').innerText().then(s => s.includes('123 m')), false);
    console.log('PASS 共有停止後の新規取得拒否・既存リスナー通知で更新操作なしに古い表示を消去');
    await alice.page.locator('#sharing-toggle').check();
    await alice.page.locator('#share-altitude').click();
    await alice.page.locator('#social-feedback').filter({ hasText: '標高を共有しました' }).waitFor();
    await bob.page.locator('#refresh-friends').click();
    await bob.page.locator('#friends-list').filter({ hasText: '222 m' }).waitFor();
    await bob.page.locator('#friends-list button').filter({ hasText: '友達を解除' }).click();
    await bob.page.locator('#social-feedback').filter({ hasText: '友達を解除しました' }).waitFor();
    await assertFails(getDoc(doc(bobDb, 'shares', alice.uid)));
    await assertFails(getDoc(doc(aliceDb, 'shares', bob.uid)));
    assert.equal((await getDoc(doc(aliceDb, 'shares', alice.uid))).exists(), true);
    assert.equal((await getDoc(doc(bobDb, 'shares', bob.uid))).exists(), true);
    await alice.page.locator('#friends-empty').waitFor();
    assert.equal(await alice.page.locator('#friends-list li').count(), 0);
    assert.equal(await bob.page.locator('#friends-list li').count(), 0);
    console.log('PASS 友達解除・両画面の一覧更新・サーバーで閲覧拒否');
    // 再申請に対する拒否も実行。
    await alice.page.locator('summary').click();
    await alice.page.locator('#friend-code').fill(bob.code);
    await alice.page.locator('#friend-form button').click();
    await bob.page.locator('#requests-list button').filter({ hasText: /^拒否$/ }).click();
    await bob.page.locator('#social-feedback').filter({ hasText: '申請を拒否しました' }).waitFor();
    await assertFails(getDoc(doc(bobDb, 'shares', alice.uid)));
    console.log('PASS 申請拒否・閲覧不可');
    // ページ再読込は共有停止ではない。サーバー状態を正しく表示する。
    await alice.page.reload();
    await alice.page.locator('#share-hint').filter({ hasText: 'サーバーで共有中：222 m' }).waitFor();
    assert.equal(await alice.page.locator('#sharing-toggle').isChecked(), false);
    assert.match(await alice.page.locator('#sharing-state').innerText(), /共有停止ではありません/);
    assert.match(await alice.page.locator('#share-hint').innerText(), /画面やアプリを閉じても/);
    assert.equal((await shareExists()).altitude, 222);
    console.log('PASS 再読込後も既存共有中を正しく表示・オンにせず自動再送もしない');
    await alice.page.locator('#logout').click();
    await alice.page.locator('#auth-card').waitFor();
    assert.equal(await shareExists(), null);
    assert.equal(await alice.page.locator('#verified-features').isVisible(), false);
    await alice.page.locator('#email').fill(alice.email);
    await alice.page.locator('#password').fill('Hight-test-12345');
    await alice.page.locator('#login').click();
    await alice.page.locator('#verified-features').waitFor();
    assert.equal(await alice.page.locator('#sharing-toggle').isChecked(), false);
    assert.equal(await alice.page.locator('#share-altitude').isDisabled(), true);
    console.log('PASS 共有停止付きログアウト・再ログイン時非公開');
    const { setDoc, deleteDoc } = require('firebase/firestore');
    await env.withSecurityRulesDisabled(async c => {
      await setDoc(doc(c.firestore(), 'profiles', alice.uid), { nickname: '旧そら', inviteCode: alice.code });
      await deleteDoc(doc(c.firestore(), 'privateProfiles', alice.uid));
    });
    await alice.page.reload();
    await alice.page.locator('#invite-code').filter({ hasText: '安全な形式へ移行' }).waitFor();
    await alice.page.locator('#profile-form button').click();
    await alice.page.locator('#social-feedback').filter({ hasText: 'プロフィールを保存しました' }).waitFor();
    assert.equal(await alice.page.locator('#invite-code').innerText(), alice.code);
    assert.deepEqual((await getDoc(doc(aliceDb, 'profiles', alice.uid))).data(), { nickname: '旧そら' });
    assert.equal((await getDoc(doc(aliceDb, 'privateProfiles', alice.uid))).data().inviteCode, alice.code);
    console.log('PASS 旧プロフィールのコードを露出させず案内・本人保存でコードを維持し原子的移行');
    await alice.page.screenshot({ path: '/tmp/hight-firebase-review.png', fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS ブラウザー実行時エラーなし・本番への通信なし');
  } finally { await env.cleanup(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
