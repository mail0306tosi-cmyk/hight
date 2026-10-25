// 実行: node tests/geolocation.cjs（playwrightとChromiumが必要）
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseURL = process.env.HIGHT_TEST_URL || 'http://127.0.0.1:8000';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const cases = [
      { name: '成功', value: 123.6, expected: '124' },
      { name: '海抜0m', value: 0, expected: '0' },
      { name: '負の高度', value: -12, expected: '-12' },
      { name: '標高なし', value: null, error: '標高が返されません' },
      { name: '権限拒否', code: 1, error: '許可されていません' },
      { name: '測位失敗', code: 2, error: '現在地を取得できません' },
      { name: 'APIタイムアウト', code: 3, error: 'タイムアウト' },
      { name: '未知のエラー', code: 9, error: 'エラーが発生' },
      { name: 'API非対応', unsupported: true, error: 'APIを利用できません' },
      { name: '非HTTPS', insecure: true, error: 'HTTPS' },
      { name: '同期例外', throws: true, error: '利用できませんでした' },
      { name: '権限ポリシー禁止', policy: true, error: 'Permissions Policy' },
      { name: '権限状態denied', permission: 'denied', silent: true, error: '権限が拒否' },
      { name: '権限API非対応', noPermissions: true, value: 10, expected: '10' },
      { name: '権限API例外', permissionThrows: true, value: 10, expected: '10' },
      { name: 'API無応答と遅延応答', silent: true, watchdog: true, error: '25秒以内' },
    ];
    for (const test of cases) {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true });
      const external = []; const errors = [];
      page.on('request', r => { if (!r.url().startsWith(baseURL + '/')) external.push(r.url()); });
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(t => {
        if (t.insecure) Object.defineProperty(window, 'isSecureContext', { value: false });
        Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => !t.policy } });
        Object.defineProperty(navigator, 'permissions', { value: t.noPermissions ? undefined : { query() {
          if (t.permissionThrows) throw Error('unsupported');
          return Promise.resolve({ state: t.permission || 'prompt' });
        } } });
        Object.defineProperty(navigator, 'geolocation', { value: t.unsupported ? undefined : { getCurrentPosition(ok, fail, options) {
          window.lastSuccess = ok;
          window.geoOptions = options;
          if (t.throws) throw Error('blocked');
          if (t.silent) return;
          setTimeout(() => t.code ? fail({ code: t.code }) : ok({ coords: { altitude: t.value, altitudeAccuracy: 4.2 }, timestamp: Date.now() }), 50);
        } } });
      }, test);
      if (test.watchdog) await page.clock.install();
      const response = await page.goto(baseURL);
      assert.equal(response.status(), 200);
      assert.match(await page.locator('#status').innerText(), /測定待機中/);
      await page.locator('#measure').click();
      if (test.watchdog) {
        assert.match(await page.locator('#status').innerText(), /測定中/);
        await page.clock.fastForward(25001);
      }
      await page.waitForFunction(() => !document.querySelector('#measure').disabled);
      if (test.error) {
        assert.equal(await page.locator('#status').innerText(), '測定失敗');
        assert.match(await page.locator('#error').innerText(), new RegExp(test.error));
        assert.equal(await page.locator('#altitude').innerText(), '—');
      } else {
        assert.equal(await page.locator('#status').innerText(), '測定成功');
        assert.equal(await page.locator('#altitude').innerText(), test.expected);
        assert.equal(await page.locator('#error').isVisible(), false);
        assert.deepEqual(await page.evaluate(() => window.geoOptions), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      }
      if (test.watchdog) {
        await page.evaluate(() => window.lastSuccess({ coords: { altitude: 999 }, timestamp: Date.now() }));
        assert.equal(await page.locator('#status').innerText(), '測定失敗');
        await page.locator('#measure').click();
        await page.evaluate(() => window.lastSuccess({ coords: { altitude: 42 }, timestamp: Date.now() }));
        assert.equal(await page.locator('#status').innerText(), '測定成功');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      console.log('PASS', test.name);
      await page.close();
    }
    // 実ブラウザーのPermissions Policy制限を、モックなしで確認。
    const blocked = await browser.newPage();
    await blocked.route('**/*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'permissions-policy': 'geolocation=()' } });
    });
    await blocked.goto(baseURL);
    await blocked.locator('#measure').click();
    assert.equal(await blocked.locator('#status').innerText(), '測定失敗');
    assert.match(await blocked.locator('#error').innerText(), /Permissions Policy/);
    console.log('PASS 実際のPermissions-Policyヘッダー');
    await blocked.close();
    // 外部JS/CSSを遮断しても単一HTMLで初期化できる。
    const missing = await browser.newPage();
    await missing.route('**/app.js', route => route.abort());
    await missing.route('**/style.css', route => route.abort());
    await missing.goto(baseURL);
    assert.equal(await missing.locator('#measure').isDisabled(), false);
    assert.match(await missing.locator('#status').innerText(), /測定待機中/);
    console.log('PASS 外部JS・CSSの取得に依存しない');
    await missing.close();
    // 基準URLを持たないHTML埋め込みでも実行される。
    const embedded = await browser.newPage();
    const scriptErrors = [];
    embedded.on('pageerror', e => scriptErrors.push(e.message));
    await embedded.setContent('<iframe sandbox="allow-scripts"></iframe>');
    await embedded.locator('iframe').evaluate((frame, html) => { frame.srcdoc = html; }, fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
    const frame = embedded.frameLocator('iframe');
    await frame.locator('#measure').waitFor();
    await frame.locator('#measure').click();
    await frame.locator('#status').filter({ hasText: '測定失敗' }).waitFor();
    assert.match(await frame.locator('#error').innerText(), /HTTPS|Permissions Policy|API/);
    assert.equal(await frame.locator('#measure').isEnabled(), true);
    assert.deepEqual(scriptErrors, []);
    console.log('PASS 基準URLのないsandbox iframeで初期化・クリック・エラー表示');
    await embedded.close();
    const noJs = await browser.newPage({ javaScriptEnabled: false });
    await noJs.goto(baseURL);
    assert.equal(await noJs.locator('noscript .error').isVisible(), true);
    assert.equal(await noJs.locator('#measure').isDisabled(), true);
    console.log('PASS JavaScript無効');
    await noJs.close();
    console.log('20 scenarios passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
