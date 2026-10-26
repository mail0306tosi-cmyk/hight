// 期限は現行へ未導入。このファイルは独立した提案ルールだけを検証する。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDocFromServer, Timestamp, serverTimestamp } = require('firebase/firestore');
let env;
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/);
  env = await initializeTestEnvironment({ projectId: 'demo-hight', firestore: { rules: fs.readFileSync('proposals/firestore-24h.rules', 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'connections/alice~bob'), { sender: 'alice', recipient: 'bob', participants: ['alice', 'bob'], status: 'accepted' });
  });
});
after(async () => env.cleanup());
const client = uid => env.authenticatedContext(uid, { email_verified: true }).firestore();
async function stored(hours) {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'shares/alice'), {
    altitude: 100, measuredAt: Timestamp.fromMillis(Date.now() - 1000), updatedAt: Timestamp.fromMillis(Date.now() - hours * 3600000),
  }));
}
test('提案: サーバー更新から23時間なら友達が閲覧可', async () => {
  await stored(23);
  assert.equal((await assertSucceeds(getDocFromServer(doc(client('bob'), 'shares/alice')))).data().altitude, 100);
});
test('提案: 25時間後は友達を拒否、文書は削除されず本人は読める', async () => {
  await stored(25);
  await assertFails(getDocFromServer(doc(client('bob'), 'shares/alice')));
  assert.equal((await getDocFromServer(doc(client('alice'), 'shares/alice'))).exists(), true);
});
test('提案: 再共有のserverTimestampで期限更新、端末算出の期限は保存しない', async () => {
  await assertSucceeds(setDoc(doc(client('alice'), 'shares/alice'), { altitude: 120, measuredAt: Timestamp.fromMillis(Date.now() - 1000), updatedAt: serverTimestamp() }));
  assert.equal((await assertSucceeds(getDocFromServer(doc(client('bob'), 'shares/alice')))).data().altitude, 120);
});
test('提案: updatedAt欠損データは友達から拒否、端末による未来更新日時も拒否', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'shares/alice'), { altitude: 100 }));
  await assertFails(getDocFromServer(doc(client('bob'), 'shares/alice')));
  await assertFails(setDoc(doc(client('alice'), 'shares/alice'), { altitude: 100, measuredAt: Timestamp.fromMillis(Date.now() - 1000), updatedAt: Timestamp.fromMillis(Date.now() + 86400000) }));
});
