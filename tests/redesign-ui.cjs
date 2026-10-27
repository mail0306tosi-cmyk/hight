// 新レイアウトの画面分離・ナビ・カード順序を実際のUI操作で検証。Firebaseは模擬。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
(async()=>{
 const bundled=await esbuild.build({entryPoints:['sns.js'],bundle:true,write:false,format:'iife',plugins:[{name:'fixture',setup(build){build.onLoad({filter:/firebase-client\.js$/},()=>({contents:fs.readFileSync('tests/fixtures/client.js','utf8'),loader:'js'}));}}]});
 const script='\n'+fs.readFileSync('app.js','utf8')+'\n;\n'+bundled.outputFiles[0].text+'\n';
 const hash=createHash('sha256').update(script).digest('base64');
 const html=fs.readFileSync('index.html','utf8').replace(/<!-- HIGHT:SCRIPT -->[\s\S]*?<!-- \/HIGHT:SCRIPT -->/,()=>`<!-- HIGHT:SCRIPT --><script>${script}</script><!-- /HIGHT:SCRIPT -->`).replace(/script-src 'sha256-[^']*'/,`script-src 'sha256-${hash}'`);
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],external=[];
 const url=`http://127.0.0.1:${server.address().port}/`;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url()!==url)external.push(r.url());});
 await page.addInitScript(()=>{
  window.watchCount=0;window.cleared=0;
  Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});
  Object.defineProperty(navigator,'geolocation',{value:{watchPosition(ok){watchCount++;window.emitSample=ok;return 1;},clearWatch(){cleared++;}}});
 });
 const nav=async name=>page.locator(`[data-nav="${name}"]`).click();
 const order=()=>page.locator('#friends-list>li').evaluateAll(els=>els.map(e=>e.dataset.uid));
 try{
  await page.goto(url);
  assert.equal(await page.locator('[data-screen]:visible').count(),1);
  assert.equal(await page.locator('#screen-home').isVisible(),true);
  assert.equal(await page.locator('#friends-list').isVisible(),false);
  assert.equal(await page.locator('[data-nav]').count(),4);
  await page.locator('[data-nav="friends"]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#friends-heading').evaluate(el=>el===document.activeElement),true);
  await nav('history');assert.match(await page.locator('#screen-history').innerText(),/測定履歴は保存していません/);
  assert.equal(await page.evaluate(()=>watchCount),0);
  console.log('PASS redesign: 4画面分離・キーボード操作・履歴保存なし・ナビだけで測位なし');
  await nav('home');await page.locator('[data-open-diagnostic]').click();
  assert.equal(await page.locator('#screen-settings').isVisible(),true);assert.equal(await page.locator('#diagnostic').getAttribute('open'),'');
  await page.locator('#email').fill('alice@example.com');await page.locator('#password').fill('Test-pass-123');await page.locator('#register').click();
  await page.locator('#account-card').waitFor();await page.locator('#refresh-verification').click();
  await page.locator('#nickname').fill('ユウ');await page.locator('#profile-form button').click();
  await nav('friends');await page.locator('#friend-tools > summary').click();await page.locator('#invite-code').filter({hasText:'A'.repeat(32)}).waitFor();
  assert.equal(await page.locator('#nickname').isVisible(),false);await page.locator('#friend-tools > summary').click();
  console.log('PASS redesign: 設定でログイン/確認/プロフィール・友達画面に本人招待コード・診断導線');
  await nav('home');await page.setViewportSize({width:375,height:667});
  const assertCoreFits = async (ids) => {
    const navBox = await page.locator('.bottom-nav').boundingBox();
    for (const id of ids) { const b = await page.locator('#'+id).boundingBox(); assert.ok(b.y>=0 && b.y+b.height<=navBox.y, `${id} fits initial viewport`); }
  };
  await assertCoreFits(['altitude','measure','share-altitude','stop-sharing']);
  await page.clock.install();await page.locator('#measure').click();
  await assertCoreFits(['altitude','measure','cancel-measure','share-altitude','stop-sharing']);
  for(let i=0;i<8;i++){
   await page.clock.fastForward(1000);
   await page.evaluate(()=>{const coords={altitude:128,altitudeAccuracy:4,accuracy:9};for(const k of ['latitude','longitude'])Object.defineProperty(coords,k,{get(){throw Error('coordinates read');}});emitSample({coords,timestamp:Date.now()});});
   if(i===2){await nav('settings');assert.match(await page.locator('#diagnostic-summary').textContent(),/採用3回/);await nav('home');}
  }
  assert.equal(await page.locator('#altitude').innerText(),'128');assert.equal(await page.evaluate(()=>cleared),1);
  assert.equal(await page.evaluate(()=>uiFixture.calls.filter(c=>c[0]==='share').length),0);
  await page.locator('#sharing-toggle').check();await page.locator('#share-altitude').click();
  await page.locator('#sharing-summary').filter({hasText:'共有中：128 m'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>Object.keys(uiFixture.calls.find(c=>c[0]==='share')[1]).sort()),['altitude','timestamp']);
  console.log('PASS redesign: 画面移動中の測定/診断維持・手動共有のみ・精度/座標を共有しない');
  await page.evaluate(()=>uiFixture.seedFriends());await nav('friends');
  await page.locator('#friends-list strong').filter({hasText:'あおい'}).waitFor();
  assert.deepEqual(await order(),['east','north','quietA','quietB']);
  assert.equal(await page.locator('[data-uid="quietA"] .friend-altitude').innerText(),'—');
  assert.match(await page.locator('[data-uid="quietA"]').innerText(),/非公開/);
  assert.doesNotMatch(await page.locator('#friends-list').innerText(),/高度精度/);
  console.log('PASS redesign: 更新日時降順・非公開は下に日本語名順・精度なしは表示しない');
  await page.evaluate(()=>uiFixture.emitFriend('north',{altitude:555,altitudeAccuracy:8,updatedAt:{toDate:()=>new Date(1700000006000)}}));
  assert.deepEqual(await order(),['north','east','quietA','quietB']);
  assert.match(await page.locator('[data-uid="north"]').innerText(),/高度精度.*8 m/);
  await page.evaluate(()=>uiFixture.emitFriend('north',null));
  assert.deepEqual(await order(),['east','quietA','north','quietB']);
  assert.doesNotMatch(await page.locator('[data-uid="north"]').innerText(),/555|高度精度/);
  await page.evaluate(()=>uiFixture.emitFriend('east',{altitude:999},false));
  assert.doesNotMatch(await page.locator('[data-uid="east"]').innerText(),/999|86 m/);
  await page.evaluate(()=>uiFixture.friendError('east'));
  assert.match(await page.locator('[data-uid="east"]').innerText(),/確認不可/);
  assert.equal(await page.locator('[data-uid="east"] .friend-altitude').innerText(),'—');
  console.log('PASS redesign: リアルタイム並べ替え・停止/キャッシュ/権限エラーで古い値と精度を消去');
  await page.evaluate(()=>uiFixture.seedFriends());
  fs.mkdirSync('/workspace/hight-review/ui-compact',{recursive:true});
  const sizes=[[375,667],[390,844],[360,800],[412,915],[1280,900]];
  for(const [width,height] of sizes){
   await page.setViewportSize({width,height});
   for(const screen of ['home','friends','history','settings']){
    await nav(screen);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} ${screen}`);
    const box=await page.locator('.bottom-nav').boundingBox();assert.ok(Math.abs(box.y+box.height-height)<1);
    if(screen==='home' && width<600){
      for(const id of ['altitude','measure','share-altitude','stop-sharing','sharing-summary','sharing-state']){
        const b=await page.locator('#'+id).boundingBox();assert.ok(b.y>=0 && b.y+b.height<=box.y,`${width}x${height} ${id} must fit before nav (${JSON.stringify(b)}, nav ${box.y})`);
      }
      assert.equal(await page.locator('#sharing-details').evaluate(el=>el.open),false);
      assert.equal(await page.locator('#measurement-details').evaluate(el=>el.open),false);
    }
    if(screen==='friends'){
      assert.equal(await page.locator('#friend-tools').evaluate(el=>el.open),false);
      assert.equal(await page.locator('#request-tools').evaluate(el=>el.open),false);
      if(width<600){for(const card of await page.locator('#friends-list>li').all()){assert.ok((await card.boundingBox()).height<=112);}}
    }
    await page.screenshot({path:`/workspace/hight-review/ui-compact/${screen}-${width}x${height}.png`,fullPage:false});
    await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
    const after=await page.locator('.bottom-nav').boundingBox();assert.ok(Math.abs(after.y-box.y)<1,'nav stays fixed when scrolling');
    assert.ok((await page.locator('footer').boundingBox()).y+(await page.locator('footer').boundingBox()).height<=after.y+1,'bottom content can clear nav');
   }
  }
  console.log('PASS compact: 375×667/390×844/Android 360×800・412×915で主要操作が初期画面内');
  await page.setViewportSize({width:375,height:667});await nav('home');
  await page.evaluate(()=>{document.querySelector('.bottom-nav').style.paddingBottom='38px';document.querySelector('.app').style.paddingBottom='130px';});
  await assertCoreFits(['altitude','measure','share-altitude','stop-sharing']);
  await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
  const safeNav=await page.locator('.bottom-nav').boundingBox(), safeFooter=await page.locator('footer').boundingBox();
  assert.ok(safeFooter.y+safeFooter.height<=safeNav.y);
  await page.evaluate(()=>{document.querySelector('.bottom-nav').style.paddingBottom='';document.querySelector('.app').style.paddingBottom='';});
  console.log('PASS compact: カード112px以下・招待/申請折りたたみ・スクロール中ナビ固定・最下部余白');
  await nav('home');await page.locator('#sharing-details > summary').click();
  assert.match(await page.locator('#sharing-persistence-notice').innerText(),/閉じても.*共有停止/);
  await page.locator('#sharing-details > summary').click();
  await page.locator('#sharing-toggle').uncheck();await page.locator('#sharing-summary').filter({hasText:'非公開（サーバー確認済み）'}).waitFor();
  assert.match(await page.locator('#sharing-state').innerText(),/準備なし/);
  await page.evaluate(()=>{uiFixture.ownError({code:'unavailable'});});
  assert.match(await page.locator('#sharing-summary').innerText(),/未確認.*停止済みとは限りません/);
  await page.evaluate(()=>{uiFixture.failStop=true;});await page.locator('#stop-sharing').click();
  assert.equal(await page.locator('#stop-warning').isVisible(),true);
  assert.match(await page.locator('#stop-warning').innerText(),/友達が読める可能性/);
  await nav('friends');assert.equal(await page.locator('#stop-warning').isVisible(),true);
  console.log('PASS compact: 共有状態と準備状態を分離・通信不明を非公開扱いせず停止失敗警告を常時表示');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/history|diagnostic/i.test(k))),false);
  console.log('PASS redesign: 指定スマホ4サイズとPC全画面・下部ナビ・画面画像・外部通信/実行時エラーなし');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
