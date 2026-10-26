const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertSucceeds: yes, assertFails: no } = require('@firebase/rules-unit-testing');
const { doc, getDocFromServer: getDoc, getDocsFromServer: getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, disableNetwork, enableNetwork, serverTimestamp, Timestamp, collection, query, where } = require('firebase/firestore');
let env;
const code = uid => uid === 'alice' ? 'A'.repeat(32) : uid === 'bob' ? 'B'.repeat(32) : 'C'.repeat(32);
const db = (uid, verified = true) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: verified }).firestore();
const ref = (db, path) => doc(db, path);
const shareData = () => ({ altitude: 123, measuredAt: Timestamp.fromMillis(Date.now() - 1000), updatedAt: serverTimestamp() });
const connection = (sender = 'alice', recipient = 'bob', status = 'pending') => ({ sender, recipient, participants: [sender, recipient], status, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
async function seed(status = 'pending') {
  await env.withSecurityRulesDisabled(async c => {
    for (const uid of ['alice', 'bob', 'eve']) {
      await setDoc(ref(c.firestore(), `profiles/${uid}`), { nickname: uid });
      await setDoc(ref(c.firestore(), `privateProfiles/${uid}`), { inviteCode: code(uid) });
      await setDoc(ref(c.firestore(), `invites/${code(uid)}`), { uid });
    }
    if (status) await setDoc(ref(c.firestore(), 'connections/alice~bob'), connection('alice', 'bob', status));
    await setDoc(ref(c.firestore(), 'shares/alice'), shareData());
    await setDoc(ref(c.firestore(), 'shares/bob'), { ...shareData(), altitude: 456 });
  });
}
before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/);
  env = await initializeTestEnvironment({ projectId: 'demo-hight', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env.cleanup(); });
test('未認証・メール未確認は全コレクションの読み書きを拒否', async () => {
  await seed('accepted');
  for (const client of [env.unauthenticatedContext().firestore(), db('alice', false)]) {
    for (const path of ['shares/alice', 'profiles/alice', 'privateProfiles/alice', 'invites/' + code('alice'), 'connections/alice~bob']) {
      await no(getDoc(ref(client, path))); await no(setDoc(ref(client, path), {})); await no(deleteDoc(ref(client, path)));
    }
    await no(getDocs(query(collection(client, 'connections'), where('participants', 'array-contains', 'alice'))));
  }
});
test('プロフィールと招待コードは本人のみ原子的に作成・ニックネームのみ更新', async () => {
  const client = db('alice'), batch = writeBatch(client);
  batch.set(ref(client, 'profiles/alice'), { nickname: 'そら' });
  batch.set(ref(client, 'privateProfiles/alice'), { inviteCode: code('alice') });
  batch.set(ref(client, 'invites/' + code('alice')), { uid: 'alice' });
  await yes(batch.commit());
  await yes(updateDoc(ref(client, 'profiles/alice'), { nickname: 'やま' }));
  await no(updateDoc(ref(db('eve'), 'profiles/alice'), { nickname: '盗用' }));
  await no(updateDoc(ref(client, 'profiles/alice'), { inviteCode: code('eve') }));
  await no(updateDoc(ref(client, 'profiles/alice'), { nickname: '' }));
  await no(updateDoc(ref(client, 'profiles/alice'), { latitude: 35 }));
  await no(setDoc(ref(client, 'invites/' + code('eve')), { uid: 'alice' }));
  await no(deleteDoc(ref(client, 'profiles/alice')));
});
test('プロフィール単独作成・他人の招待コード横取り・一覧列挙を拒否', async () => {
  await no(setDoc(ref(db('alice'), 'profiles/alice'), { nickname: 'a', inviteCode: code('alice') }));
  await no(setDoc(ref(db('alice'), 'invites/' + code('alice')), { uid: 'bob' }));
  await no(getDocs(collection(db('alice'), 'invites')));
  await no(getDocs(collection(db('alice'), 'profiles')));
});
test('招待コードの個別参照はメール確認済みのみ', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(ref(c.firestore(), 'invites/' + code('alice')), { uid: 'alice' }));
  await yes(getDoc(ref(db('bob'), 'invites/' + code('alice'))));
  await no(getDoc(ref(db('bob', false), 'invites/' + code('alice'))));
});
test('申請作成は送信者本人・pendingのみ・自己宛や逆方向や余分なフィールドは禁止', async () => {
  await seed(null);
  await no(setDoc(ref(db('alice'), 'connections/alice~alice'), connection('alice', 'alice')));
  await no(setDoc(ref(db('eve'), 'connections/alice~bob'), connection()));
  await no(setDoc(ref(db('alice'), 'connections/alice~bob'), connection('alice', 'bob', 'accepted')));
  await no(setDoc(ref(db('alice'), 'connections/wrong'), connection()));
  await no(setDoc(ref(db('alice'), 'connections/alice~bob'), { ...connection(), participants: ['alice', 'bob', 'eve'] }));
  await no(setDoc(ref(db('alice'), 'connections/alice~bob'), { ...connection(), latitude: 35 }));
  await yes(setDoc(ref(db('alice'), 'connections/alice~bob'), connection()));
  await no(setDoc(ref(db('bob'), 'connections/bob~alice'), connection('bob', 'alice')));
});
test('申請受信者のみ承認・拒否可能、送信者の自己承認を拒否', async () => {
  await seed();
  await no(updateDoc(ref(db('alice'), 'connections/alice~bob'), { status: 'accepted', updatedAt: serverTimestamp() }));
  await no(updateDoc(ref(db('eve'), 'connections/alice~bob'), { status: 'accepted', updatedAt: serverTimestamp() }));
  await no(updateDoc(ref(db('bob', false), 'connections/alice~bob'), { status: 'accepted', updatedAt: serverTimestamp() }));
  await yes(updateDoc(ref(db('bob'), 'connections/alice~bob'), { status: 'accepted', updatedAt: serverTimestamp() }));
  await no(updateDoc(ref(db('bob'), 'connections/alice~bob'), { status: 'pending', updatedAt: serverTimestamp() }));
});
test('recipient/participants/createdAtの不正変更・acceptedへの直接作成を拒否', async () => {
  await seed();
  for (const patch of [{ recipient: 'eve' }, { sender: 'eve' }, { participants: ['bob', 'eve'] }, { createdAt: serverTimestamp() }]) {
    await no(updateDoc(ref(db('bob'), 'connections/alice~bob'), { ...patch, status: 'accepted', updatedAt: serverTimestamp() }));
  }
});
test('拒否後の再承認は禁止、削除した後のみ再申請できる', async () => {
  await seed();
  await yes(updateDoc(ref(db('bob'), 'connections/alice~bob'), { status: 'rejected', updatedAt: serverTimestamp() }));
  await no(updateDoc(ref(db('bob'), 'connections/alice~bob'), { status: 'accepted', updatedAt: serverTimestamp() }));
  await no(getDoc(ref(db('bob'), 'shares/alice')));
  await yes(deleteDoc(ref(db('alice'), 'connections/alice~bob')));
  await yes(setDoc(ref(db('alice'), 'connections/alice~bob'), connection()));
});
test('申請の列挙は自分が含まれるクエリのみ、第三者参照は禁止', async () => {
  await seed();
  await yes(getDocs(query(collection(db('alice'), 'connections'), where('participants', 'array-contains', 'alice'))));
  await no(getDocs(collection(db('alice'), 'connections')));
  await no(getDoc(ref(db('eve'), 'connections/alice~bob')));
});
test('承認前は標高・他人プロフィール不可、承認後は双方向の閲覧が可能', async () => {
  await seed();
  await no(getDoc(ref(db('bob'), 'shares/alice'))); await no(getDoc(ref(db('bob'), 'profiles/alice')));
  await yes(updateDoc(ref(db('bob'), 'connections/alice~bob'), { status: 'accepted', updatedAt: serverTimestamp() }));
  await yes(getDoc(ref(db('bob'), 'shares/alice'))); await yes(getDoc(ref(db('bob'), 'profiles/alice')));
  await yes(setDoc(ref(db('bob'), 'shares/bob'), shareData()));
  await yes(getDoc(ref(db('alice'), 'shares/bob')));
  await no(getDoc(ref(db('eve'), 'shares/alice'))); await no(getDocs(collection(db('bob'), 'shares')));
});
test('共有停止は値削除、承認済みでも停止後に標高を読めない', async () => {
  await seed('accepted');
  await yes(getDoc(ref(db('bob'), 'shares/alice')));
  await yes(deleteDoc(ref(db('alice'), 'shares/alice')));
  await no(getDoc(ref(db('bob'), 'shares/alice')));
  await no(setDoc(ref(db('bob'), 'shares/alice'), shareData()));
  await no(deleteDoc(ref(db('bob'), 'shares/alice')));
});
test('友達解除後は共有中でもサーバーが閲覧を拒否、第三者の解除は不可', async () => {
  await seed('accepted');
  const a = await yes(getDoc(ref(db('bob'), 'shares/alice')));
  const b = await yes(getDoc(ref(db('alice'), 'shares/bob')));
  assert.equal(a.exists(), true); assert.equal(b.exists(), true);
  assert.equal(a.data().altitude, 123); assert.equal(b.data().altitude, 456);
  await no(deleteDoc(ref(db('eve'), 'connections/alice~bob')));
  await yes(deleteDoc(ref(db('bob'), 'connections/alice~bob')));
  await no(getDoc(ref(db('bob'), 'shares/alice'))); await no(getDoc(ref(db('alice'), 'shares/bob')));
  await no(getDoc(ref(db('bob'), 'profiles/alice')));
});
test('共有の書込は本人のみ、緯度経度・メール等の余分な項目を拒否', async () => {
  await seed('accepted');
  await yes(setDoc(ref(db('alice'), 'shares/alice'), shareData()));
  await no(setDoc(ref(db('bob'), 'shares/alice'), shareData()));
  for (const extra of [{ latitude: 35 }, { longitude: 139 }, { email: 'a@example.com' }, { uid: 'bob' }]) {
    await no(setDoc(ref(db('alice'), 'shares/alice'), { ...shareData(), ...extra }));
  }
});
test('高度/日時の型・範囲を検証、0mと負の値は許可', async () => {
  for (const altitude of [0, -20, 8849]) await yes(setDoc(ref(db('alice'), 'shares/alice'), { ...shareData(), altitude }));
  for (const altitude of ['100', null, NaN, Infinity, -12001, 100001]) await no(setDoc(ref(db('alice'), 'shares/alice'), { ...shareData(), altitude }));
  await no(setDoc(ref(db('alice'), 'shares/alice'), { ...shareData(), measuredAt: Timestamp.fromMillis(Date.now() + 86400000) }));
  await no(setDoc(ref(db('alice'), 'shares/alice'), { ...shareData(), updatedAt: Timestamp.fromMillis(0) }));
});
test('検証済みから未確認トークンへの切替は既存の友達でも読み書き不可', async () => {
  await seed('accepted');
  await no(getDoc(ref(db('bob', false), 'shares/alice')));
  await no(setDoc(ref(db('alice', false), 'shares/alice'), shareData()));
});

async function liveShare(client, path) {
  let stop, timer, readyResolve, errorResolve;
  const values = [];
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const denied = new Promise(resolve => { errorResolve = resolve; });
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('リスナー通知が届きません')), 10000); });
  stop = onSnapshot(ref(client, path), { includeMetadataChanges: true }, snap => {
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) { values.push(snap.data()?.altitude); readyResolve(snap); }
  }, error => errorResolve(error));
  return { values, ready: Promise.race([ready, timeout]), denied: Promise.race([denied, timeout]), close() { clearTimeout(timer); stop(); } };
}
test('共有停止は既存リスナーにもpermission-denied、キャッシュではなくサーバー上の実在値から検証', async () => {
  await seed('accepted');
  const live = await liveShare(db('bob'), 'shares/alice');
  try {
    const snap = await live.ready; assert.equal(snap.exists(), true); assert.equal(snap.data().altitude, 123);
    await yes(deleteDoc(ref(db('alice'), 'shares/alice')));
    assert.equal((await live.denied).code, 'permission-denied');
    await no(getDoc(ref(db('bob'), 'shares/alice')));
  } finally { live.close(); }
});
test('友達解除後は両共有値の新規サーバー取得と既存リスナーへの新しい値の配信を拒否', async () => {
  await seed('accepted');
  const ab = await liveShare(db('alice'), 'shares/bob'), ba = await liveShare(db('bob'), 'shares/alice');
  try {
    assert.equal((await ab.ready).data().altitude, 456); assert.equal((await ba.ready).data().altitude, 123);
    await yes(deleteDoc(ref(db('alice'), 'connections/alice~bob')));
    await no(getDoc(ref(db('alice'), 'shares/bob'))); await no(getDoc(ref(db('bob'), 'shares/alice')));
    // 依存する関係文書の削除だけではエミュレーターが既存リスナーへ即座に通知しない。
    // 対象共有文書の変更も発生させ、新しい値が配信されず拒否されることを確認する。
    await yes(setDoc(ref(db('alice'), 'shares/alice'), { ...shareData(), altitude: 789 }));
    await yes(setDoc(ref(db('bob'), 'shares/bob'), { ...shareData(), altitude: 987 }));
    assert.equal((await ab.denied).code, 'permission-denied'); assert.equal((await ba.denied).code, 'permission-denied');
    assert.deepEqual(ab.values, [456]); assert.deepEqual(ba.values, [123]);
    // 共有値そのものは両方残っていることを所有者権限で確認。
    assert.equal((await getDoc(ref(db('alice'), 'shares/alice'))).exists(), true);
    assert.equal((await getDoc(ref(db('bob'), 'shares/bob'))).exists(), true);
    await no(getDoc(ref(db('alice'), 'shares/bob'))); await no(getDoc(ref(db('bob'), 'shares/alice')));
  } finally { ab.close(); ba.close(); }
});

test('招待コードは本人専用文書、承認友達の公開プロフィールにはnicknameだけ', async () => {
  await seed('accepted');
  const owner = await yes(getDoc(ref(db('alice'), 'privateProfiles/alice')));
  assert.equal(owner.data().inviteCode, code('alice'));
  const visible = await yes(getDoc(ref(db('bob'), 'profiles/alice')));
  assert.deepEqual(visible.data(), { nickname: 'alice' });
  await no(getDoc(ref(db('bob'), 'privateProfiles/alice')));
  await no(getDoc(ref(db('eve'), 'privateProfiles/alice')));
  await no(getDocs(collection(db('alice'), 'privateProfiles')));
  await no(updateDoc(ref(db('alice'), 'privateProfiles/alice'), { inviteCode: code('eve') }));
  await no(setDoc(ref(db('alice'), 'profiles/alice'), { nickname: 'a', inviteCode: code('alice') }));
  await yes(deleteDoc(ref(db('bob'), 'connections/alice~bob')));
  await no(getDoc(ref(db('bob'), 'profiles/alice')));
  await no(getDoc(ref(db('bob'), 'privateProfiles/alice')));
  // 既知のコードを指定した申請用途のuid参照は確認済みなら引き続き可能。
  assert.equal((await yes(getDoc(ref(db('bob'), 'invites/' + code('alice'))))).data().uid, 'alice');
});
test('新プロフィール/本人専用コード/コード対応は三文書の原子的作成が必要', async () => {
  const client = db('alice');
  await no(setDoc(ref(client, 'profiles/alice'), { nickname: 'a' }));
  await no(setDoc(ref(client, 'privateProfiles/alice'), { inviteCode: code('alice') }));
  const batch = writeBatch(client);
  batch.set(ref(client, 'profiles/alice'), { nickname: 'a' });
  batch.set(ref(client, 'privateProfiles/alice'), { inviteCode: code('alice') });
  await no(batch.commit());
});
test('旧形式は友達から遮断し、本人の原子的移行だけで同じコードを保持して公開', async () => {
  await seed('accepted');
  await env.withSecurityRulesDisabled(async c => {
    await deleteDoc(ref(c.firestore(), 'privateProfiles/alice'));
    await setDoc(ref(c.firestore(), 'profiles/alice'), { nickname: '旧', inviteCode: code('alice') });
  });
  assert.equal((await yes(getDoc(ref(db('alice'), 'profiles/alice')))).data().inviteCode, code('alice'));
  await no(getDoc(ref(db('bob'), 'profiles/alice')));
  await no(setDoc(ref(db('alice'), 'profiles/alice'), { nickname: '新' }));
  const client = db('alice');
  // 同じSDKインスタンスをバッチの全参照に使う。
  const migration = writeBatch(client);
  migration.set(ref(client, 'profiles/alice'), { nickname: '新' });
  migration.set(ref(client, 'privateProfiles/alice'), { inviteCode: code('alice') });
  await yes(migration.commit());
  assert.deepEqual((await yes(getDoc(ref(db('bob'), 'profiles/alice')))).data(), { nickname: '新' });
  await no(getDoc(ref(db('bob'), 'privateProfiles/alice')));
  assert.equal((await yes(getDoc(ref(client, 'privateProfiles/alice')))).data().inviteCode, code('alice'));
});

test('SDKのオフライン削除は未完了のまま共有値が残り、再接続して削除完了後だけ友達を拒否', async () => {
  await seed('accepted');
  const writer = db('alice'), reader = db('bob');
  await disableNetwork(writer);
  let completed = false;
  const pending = deleteDoc(ref(writer, 'shares/alice')).then(() => { completed = true; });
  try {
    assert.equal((await getDoc(ref(reader, 'shares/alice'))).data().altitude, 123);
    assert.equal(completed, false);
  } finally { await enableNetwork(writer); }
  await pending;
  assert.equal(completed, true);
  await no(getDoc(ref(reader, 'shares/alice')));
});
