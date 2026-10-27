const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
 const {relativeUpdatedAt, timestampMillis}=await import('data:text/javascript;base64,'+fs.readFileSync('social-display.js').toString('base64'));
 const now=new Date(2026,9,27,12).getTime(), ts=ms=>({toDate:()=>new Date(ms)});
 for(const [age,label] of [[0,'たった今'],[59999,'たった今'],[60000,'1分前'],[3599999,'59分前'],[3600000,'1時間前'],[86399999,'23時間前'],[86400000,'1日前'],[604799999,'6日前']]){
  test(`相対時刻 ${age}ms`,()=>assert.equal(relativeUpdatedAt(ts(now-age),now),label));
 }
 test('ちょうど7日で日付に切り替える',()=>assert.equal(relativeUpdatedAt(ts(now-604800000),now),'2026/10/20'));
 test('古い日付をゼロ埋め',()=>assert.equal(relativeUpdatedAt(ts(new Date(2025,0,2,12).getTime()),now),'2025/01/02'));
 test('未来時刻は負数にしない',()=>assert.equal(relativeUpdatedAt(ts(now+3600000),now),'たった今'));
 for(const [name,value] of [['null',null],['undefined',undefined],['空オブジェクト',{}],['無効Date',new Date(NaN)],['無効toDate',{toDate:()=>new Date(NaN)}],['例外',{toDate(){throw Error('invalid');}}],['無限toMillis',{toMillis:()=>Infinity}],['範囲外',{toMillis:()=>8640000000000001}]]){
  test(`欠損・不正 ${name}`,()=>{assert.equal(timestampMillis(value),null);assert.equal(relativeUpdatedAt(value,now),'更新情報なし');});
 }
 test('FirestoreのtoMillisを扱う',()=>assert.equal(relativeUpdatedAt({toMillis:()=>now-60000},now),'1分前'));
 test('Unix epochの0は欠損扱いしない',()=>assert.equal(timestampMillis({toMillis:()=>0}),0));
})().catch(e=>{console.error(e);process.exitCode=1;});
