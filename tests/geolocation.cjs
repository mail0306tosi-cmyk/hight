const { withScreens } = require('./screen-navigation.cjs');
// 本番と同じHTMLをChromiumで測定。Geolocationのみ模擬、仮想時計で20秒を検証。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const baseURL = process.env.HIGHT_TEST_URL || 'http://127.0.0.1:8000';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let count = 0;
  async function scenario(name, options, body) {
    const page = withScreens(await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true }));
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(baseURL + '/')) external.push(r.url()); });
    await page.addInitScript(o => {
      window.events = []; window.watches = []; window.cleared = [];
      document.addEventListener('hight:measurement', e => events.push(e.detail));
      if (o.insecure) Object.defineProperty(window, 'isSecureContext', { value: false });
      Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => !o.policy } });
      Object.defineProperty(navigator, 'permissions', { value: o.noPermissions ? undefined : { query() {
        if (o.permissionThrows) throw Error('unsupported');
        return Promise.resolve({ state: o.denied ? 'denied' : 'prompt' });
      } } });
      Object.defineProperty(navigator, 'geolocation', { value: o.unsupported ? undefined : {
        watchPosition(ok, fail, config) {
          window.geoOptions = config; const id = watches.length; watches.push({ ok, fail });
          if (o.throws) throw Error('blocked');
          if (o.syncError) fail({ code: 1 });
          return id;
        }, clearWatch(id) { cleared.push(id); },
      } });
      window.sample = (value, precision = 4, delta = 0, id = watches.length - 1) => {
        const coords = { altitude: value, altitudeAccuracy: precision };
        Object.defineProperty(coords, 'latitude', { get() { throw Error('latitude must not be read'); } });
        Object.defineProperty(coords, 'longitude', { get() { throw Error('longitude must not be read'); } });
        watches[id].ok({ coords, timestamp: Date.now() + delta });
      };
    }, options);
    await page.clock.install();
    await page.goto(baseURL);
    await page.locator('#measure').click();
    try {
      await body(page);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      console.log('PASS', name); count++;
    } finally { await page.close(); }
  }
  const tick = (page, ms = 1000) => page.clock.fastForward(ms);
  async function samples(page, values, precisions = values.map(() => 4)) {
    for (let i = 0; i < values.length; i++) {
      if (i) await tick(page);
      await page.evaluate(([v,p]) => sample(v,p), [values[i], precisions[i]]);
    }
  }
  async function success(page, value) {
    assert.equal(await page.locator('#status').innerText(), '測定成功');
    assert.equal(await page.locator('#altitude').innerText(), value);
    assert.equal(await page.locator('#measure').isEnabled(), true);
    assert.equal(await page.locator('#cancel-measure').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => cleared), [0]);
    const events = await page.evaluate(() => window.events);
    assert.equal(events.length,1); assert.deepEqual(Object.keys(events[0]).sort(), ['altitude','timestamp']);
  }
  async function failed(page, text) {
    assert.equal(await page.locator('#status').innerText(), '測定失敗');
    assert.match(await page.locator('#error').innerText(), text);
    assert.equal(await page.locator('#altitude').innerText(), '—');
    assert.equal(await page.locator('#measure').isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => events), []);
  }
  try {
    await scenario('8件の中央値・95%端末指標・標本範囲を分離・cleanup', {}, async p => {
      await samples(p,[100,101,99,100,102,100,99,100]); await success(p,'100');
      assert.match(await p.locator('#accuracy').innerText(), /95%指標.*±4 m/);
      assert.match(await p.locator('#sample-range').innerText(), /8件.*99.0〜102.0/);
      assert.match(await p.locator('#measurement-warning').innerText(), /安定＝正確ではありません/);
      assert.deepEqual(await p.evaluate(() => geoOptions), { enableHighAccuracy:true,timeout:10000,maximumAge:0 });
      await tick(p,30000); assert.equal(await p.locator('#status').innerText(),'測定成功');
    });
    for (const [name,value,display] of [['0m',0,'0'],['負の高さ',-12,'-12']]) await scenario(name,{},async p => { await samples(p,Array(8).fill(value)); await success(p,display); });
    await scenario('外れ値1件でも中央値を保持・全標本範囲と大きいばらつき警告',{},async p => {
      await samples(p,[100,100,101,100,1000,99,100,100]); await success(p,'100');
      assert.match(await p.locator('#sample-range').innerText(), /99.0〜1000.0/);
      assert.match(await p.locator('#measurement-warning').innerText(), /ばらつきが大きめ/);
    });
    await scenario('精度nullを0扱いしない',{},async p => {
      await samples(p,Array(8).fill(79),Array(8).fill(null)); await success(p,'79');
      assert.equal(await p.locator('#accuracy').innerText(),'端末の高度精度（95%指標）：不明');
      assert.match(await p.locator('#measurement-warning').innerText(), /8\/8件.*不明/);
    });
    await scenario('混在精度は最大報告値と不明件数を明示・中央値のCIと区別',{},async p => {
      await samples(p,Array(8).fill(47),[4,null,20,3,-5,8,9,4]); await success(p,'47');
      assert.match(await p.locator('#accuracy').innerText(), /±20 m.*2件不明/);
      assert.match(await p.locator('#measurement-warning').innerText(), /10m超は注意の目安/);
      assert.match(await p.locator('#measurement-warning').innerText(), /中央値の95%信頼区間ではありません/);
    });
    await scenario('端末報告の精度0は不明と区別',{},async p => { await samples(p,Array(8).fill(10),Array(8).fill(0)); await success(p,'10'); assert.match(await p.locator('#accuracy').innerText(),/±0 m/); });
    await scenario('高度nullは有限期限で失敗',{},async p => { await samples(p,Array(8).fill(null)); await tick(p,20000); await failed(p,/高度が返されません/); assert.deepEqual(await p.evaluate(()=>cleared),[0]); });
    await scenario('3件なら期限時に参考値・不足警告、完了前イベントなし',{},async p => {
      await samples(p,[20,21,19]); assert.deepEqual(await p.evaluate(()=>events),[]);
      await tick(p,20000); await success(p,'20'); assert.match(await p.locator('#measurement-warning').innerText(),/3\/8件/);
    });
    await scenario('2件以下は共有可能な結果を出さない',{},async p => { await samples(p,[20,21]); await tick(p,20000); await failed(p,/3件以上/); });
    await scenario('同じtimestampの繰返しは1件のみ',{},async p => {
      await p.evaluate(()=>{const t=Date.now();for(let i=0;i<20;i++)watches[0].ok({coords:{altitude:10,altitudeAccuracy:4},timestamp:t});});
      assert.match(await p.locator('#status').innerText(),/1\/8件/); await tick(p,20000); await failed(p,/標本が不足/);
    });
    for (const [name,delta] of [['古い標本',-6000],['未来の標本',1000]]) await scenario(name,{},async p=>{ await p.evaluate(d=>sample(10,4,d),delta); assert.match(await p.locator('#status').innerText(),/0\/8件/); await tick(p,20000); await failed(p,/標本が不足/); });
    await scenario('NaN高さ・無効timestamp・過密標本を除外',{},async p=>{
      await p.evaluate(()=>{sample(NaN);watches[0].ok({coords:{altitude:10},timestamp:NaN});sample(10);sample(20,4,-1);});
      assert.match(await p.locator('#status').innerText(),/1\/8件/);await tick(p,20000);await failed(p,/3件以上/);
    });
    for (const [name,code,message] of [['権限拒否',1,/許可されていません/],['測位失敗',2,/現在地を取得できません/],['未知のエラー',9,/エラーが発生/]]) await scenario(name,{},async p=>{await p.evaluate(c=>watches[0].fail({code:c}),code);await failed(p,message);assert.deepEqual(await p.evaluate(()=>cleared),[0]);});
    await scenario('API timeout後も回復を待ち採用',{},async p=>{await p.evaluate(()=>watches[0].fail({code:3}));await samples(p,Array(8).fill(50));await success(p,'50');});
    await scenario('API/許可待ち無応答は20秒で打切り',{},async p=>{await tick(p,20001);await failed(p,/20秒以内/);await p.evaluate(()=>sample(999));assert.deepEqual(await p.evaluate(()=>events),[]);});
    for(const [name,opt,err] of [['非HTTPS',{insecure:true},/HTTPS/],['API非対応',{unsupported:true},/APIを利用できません/],['権限ポリシー',{policy:true},/Permissions Policy/],['権限状態denied',{denied:true},/権限が拒否/],['同期例外',{throws:true},/利用できませんでした/],['同期失敗callback',{syncError:true},/許可されていません/]]) await scenario(name,opt,async p=>{await failed(p,err);if(opt.syncError)assert.deepEqual(await p.evaluate(()=>cleared),[0]);});
    for (const opt of [{noPermissions:true},{permissionThrows:true}]) await scenario('Permissions API非対応/例外でも測位',opt,async p=>{await samples(p,Array(8).fill(10));await success(p,'10');});
    await scenario('停止は確定しない・再測定の古いcallbackを無視',{},async p=>{
      await samples(p,[10,11,12]);await p.locator('#cancel-measure').click();assert.match(await p.locator('#status').innerText(),/停止/);assert.deepEqual(await p.evaluate(()=>events),[]);
      await p.locator('#measure').click();await p.evaluate(()=>sample(999,4,0,0));assert.match(await p.locator('#status').innerText(),/0\/8件/);
      await samples(p,Array(8).fill(200));assert.equal(await p.locator('#altitude').innerText(),'200');assert.deepEqual(await p.evaluate(()=>cleared),[0,1]);assert.equal(await p.evaluate(()=>events.length),1);
    });
    for(const kind of ['pagehide','background']) await scenario(kind+'で監視終了',{},async p=>{
      await samples(p,[10,11,12]);await p.evaluate(k=>{if(k==='pagehide')window.dispatchEvent(new Event('pagehide'));else {Object.defineProperty(document,'hidden',{value:true});document.dispatchEvent(new Event('visibilitychange'));}},kind);
      assert.match(await p.locator('#status').innerText(),/停止/);assert.deepEqual(await p.evaluate(()=>cleared),[0]);await p.evaluate(()=>sample(999));assert.deepEqual(await p.evaluate(()=>events),[]);
    });
    await scenario('成功後の再測定失敗は旧結果を消し新イベントを発行しない',{},async p=>{
      await samples(p,Array(8).fill(50));await p.locator('#measure').click();assert.equal(await p.locator('#altitude').innerText(),'—');await p.evaluate(()=>watches[1].fail({code:1}));assert.equal(await p.locator('#status').innerText(),'測定失敗');assert.equal(await p.evaluate(()=>events.length),1);assert.equal(await p.locator('#accuracy').isVisible(),false);
    });
    await scenario('320/375/430pxの横はみ出しなし',{},async p=>{await samples(p,Array(8).fill(50));for(const width of [320,375,430]){await p.setViewportSize({width,height:812});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}await p.screenshot({path:'/tmp/hight-height-quality.png',fullPage:true});});
    await scenario('開始後に古くなった標本と短すぎる更新間隔を除外',{},async p=>{
      await tick(p,6000); await p.evaluate(()=>sample(10,4,-5500));
      assert.match(await p.locator('#status').innerText(),/0\/8件/);
      await p.evaluate(()=>sample(10));await tick(p,200);await p.evaluate(()=>sample(11));
      assert.match(await p.locator('#status').innerText(),/1\/8件/);
      await tick(p,800);await p.evaluate(()=>sample(12));assert.match(await p.locator('#status').innerText(),/2\/8件/);
      await tick(p,20000);await failed(p,/3件以上/);
    });
    await scenario('診断：生高度・中央値・水平/高度精度・端末情報・共有payload不変',{},async p=>{
      await p.locator('#diagnostic summary').click();
      await p.evaluate(()=>watches[0].ok({coords:{altitude:79.125,altitudeAccuracy:6.25,accuracy:12.5},timestamp:Date.now()}));
      assert.match(await p.locator('#diagnostic-summary').innerText(),/最新の生高度：79.125 m/);
      assert.match(await p.locator('#diagnostic-summary').innerText(),/暫定中央値（共有不可）：79.125 m/);
      assert.match(await p.locator('#diagnostic-summary').innerText(),/高度精度：6.25 m／水平精度：12.5 m/);
      assert.deepEqual(await p.evaluate(()=>events),[]);
      await tick(p); await samples(p,[80,78,79,79,79,79,79]); await success(p,'79');
      assert.match(await p.locator('#diagnostic-summary').innerText(),/採用標本の中央値：79 m/);
      assert.match(await p.locator('#diagnostic-summary').innerText(),/受信8回・採用8回/);
      assert.equal(await p.locator('#diagnostic-rows tr').count(),8);
      assert.ok((await p.locator('#diagnostic-device').innerText()).includes(await p.evaluate(()=>navigator.userAgent)));
    });
    await scenario('診断：null/負精度は不明、精度0と区別',{},async p=>{
      await p.evaluate(()=>watches[0].ok({coords:{altitude:null,altitudeAccuracy:null,accuracy:-1},timestamp:Date.now()}));
      assert.match(await p.locator('#diagnostic-summary').textContent(),/高度なし1回/);
      assert.match(await p.locator('#diagnostic-summary').textContent(),/最新の生高度：不明/);
      assert.match(await p.locator('#diagnostic-summary').textContent(),/高度精度：不明／水平精度：不明/);
      await tick(p);await p.evaluate(()=>watches[0].ok({coords:{altitude:0,altitudeAccuracy:0,accuracy:0},timestamp:Date.now()}));
      assert.match(await p.locator('#diagnostic-summary').textContent(),/高度精度：0 m／水平精度：0 m/);
    });
    await scenario('診断：重複の除外理由・直近32件に制限・座標getter未読',{},async p=>{
      await p.evaluate(()=>{const t=Date.now();for(let i=0;i<40;i++)watches[0].ok({coords:{altitude:27,altitudeAccuracy:4},timestamp:t});});
      assert.equal(await p.locator('#diagnostic-rows tr').count(),32);
      assert.match(await p.locator('#diagnostic-summary').textContent(),/受信40回・採用1回/);
      assert.match(await p.locator('#diagnostic-rows').textContent(),/重複/);
      await p.locator('#cancel-measure').click();
      const before=await p.locator('#diagnostic-summary').textContent();
      await p.evaluate(()=>sample(999));assert.equal(await p.locator('#diagnostic-summary').textContent(),before);
      assert.match(before,/測定停止.*共有不可/);
    });
    await scenario('診断：失敗後の値は共有不可・再測定と再読み込みで消去',{},async p=>{
      await p.evaluate(()=>sample(123.456789));await tick(p,20001);
      assert.match(await p.locator('#diagnostic-summary').textContent(),/測定失敗.*共有不可/);
      await p.locator('#measure').click();
      assert.equal(await p.locator('#diagnostic-rows tr').count(),0);
      assert.doesNotMatch(await p.locator('#diagnostic-summary').textContent(),/123.456789/);
      await p.evaluate(()=>sample(123.456789));await p.reload();
      assert.equal(await p.locator('#diagnostic-rows tr').count(),0);
      assert.match(await p.locator('#diagnostic-summary').textContent(),/まだ測定していません/);
      assert.equal(await p.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('123.456789')),false);
    });
    await scenario('診断：狭い320px画面でも表は画面内でスクロール',{},async p=>{
      await p.setViewportSize({width:320,height:640});await p.locator('#diagnostic summary').click();
      await samples(p,[100,101,102,103,104,105,106,107]);
      assert.equal(await p.evaluate(()=>{const e=document.querySelector('.diagnostic-scroll');return e.scrollWidth>e.clientWidth;}),true);
    });
    const blocked=await browser.newPage();await blocked.route('**/*',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'permissions-policy':'geolocation=()'}});});
    await blocked.goto(baseURL);await blocked.locator('#measure').click();assert.equal(await blocked.locator('#status').innerText(),'測定失敗');assert.match(await blocked.locator('#error').innerText(),/Permissions Policy/);await blocked.close();count++;console.log('PASS 実ブラウザーのPermissions-Policy制限');
    const single=await browser.newPage();await single.route('**/app.js',r=>r.abort());await single.route('**/style.css',r=>r.abort());await single.goto(baseURL);assert.equal(await single.locator('#measure').isEnabled(),true);await single.close();count++;console.log('PASS 単一HTMLで初期化・外部JS/CSS不要');
    const embedded=await browser.newPage();await embedded.setContent('<iframe sandbox="allow-scripts"></iframe>');await embedded.locator('iframe').evaluate((frame,html)=>{frame.srcdoc=html;},fs.readFileSync('index.html','utf8'));const frame=embedded.frameLocator('iframe');await frame.locator('#measure').click();await frame.locator('#status').filter({hasText:'測定失敗'}).waitFor();assert.match(await frame.locator('#error').innerText(),/HTTPS|Permissions Policy|API/);await embedded.close();count++;console.log('PASS 基準URLのないsandboxプレビューの初期化とエラー');
    const noJs=await browser.newPage({javaScriptEnabled:false});await noJs.goto(baseURL);assert.equal(await noJs.locator('noscript .error').isVisible(),true);assert.equal(await noJs.locator('#measure').isDisabled(),true);await noJs.close();count++;console.log('PASS JavaScript無効の案内');
    console.log(`${count} scenarios passed`);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
