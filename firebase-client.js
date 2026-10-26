import { initializeApp } from 'firebase/app';
import { initializeAuth, browserSessionPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, reload, signOut, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, doc, getDocFromServer, setDoc, deleteDoc, updateDoc, writeBatch,
  serverTimestamp, Timestamp, collection, query, where, onSnapshot, connectFirestoreEmulator } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

export function createClient() {
  const emulator = __HIGHT_EMULATORS__;
  const config = emulator ? { apiKey: 'demo-key', projectId: 'demo-hight', appId: 'demo-app', authDomain: 'localhost' } : firebaseConfig;
  if (!config.apiKey || !config.appId || config.projectId !== (emulator ? 'demo-hight' : 'hight-502cc')) return null;
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: browserSessionPersistence });
  auth.languageCode = 'ja';
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  if (emulator) {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('エミュレーター用ビルドはlocalhost専用です');
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  async function read(reference) {
    let timer;
    try {
      return await Promise.race([getDocFromServer(reference), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('サーバーの応答がありません。'), { code: 'unavailable' })), 12000); })]);
    } finally { clearTimeout(timer); }
  }
  const profileRef = uid => doc(db, 'profiles', uid);
  const privateRef = uid => doc(db, 'privateProfiles', uid);
  const pendingStops = new Map();
  const shareRef = uid => doc(db, 'shares', uid);
  function watchShare(uid, cb, error) {
    return onSnapshot(shareRef(uid), { includeMetadataChanges: true }, snap => {
      const confirmed = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
      cb(confirmed ? snap.data() : undefined, confirmed);
    }, error);
  }
  return {
    currentUser: () => auth.currentUser,
    observeAuth: cb => onAuthStateChanged(auth, cb),
    register: async (email, password) => {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      // 登録と送信は別々の成功状態として扱う。
      return user;
    },
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    sendVerification: () => sendEmailVerification(auth.currentUser),
    refresh: async () => { await reload(auth.currentUser); await auth.currentUser.getIdToken(true); return auth.currentUser; },
    verified: async user => (await user.getIdTokenResult(true)).claims.email_verified === true,
    logout: () => signOut(auth),
    profile: async uid => (await read(profileRef(uid))).data(),
    privateProfile: async uid => (await read(privateRef(uid))).data(),
    saveProfile: async (uid, nickname) => {
      const [publicSnap, privateSnap] = await Promise.all([read(profileRef(uid)), read(privateRef(uid))]);
      if (privateSnap.exists()) {
        await setDoc(profileRef(uid), { nickname });
        return privateSnap.data().inviteCode;
      }
      const legacyCode = publicSnap.data()?.inviteCode;
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const inviteCode = legacyCode || Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
      const batch = writeBatch(db);
      batch.set(profileRef(uid), { nickname });
      batch.set(privateRef(uid), { inviteCode });
      // 旧コードの対応表は不変のまま、本人保存時に原子的に移行する。
      if (!legacyCode) batch.set(doc(db, 'invites', inviteCode), { uid });
      await batch.commit();
      return inviteCode;
    },
    requestFriend: async (uid, code) => {
      const invite = await read(doc(db, 'invites', code));
      if (!invite.exists()) throw Error('招待コードが見つかりません。');
      const recipient = invite.data().uid;
      if (recipient === uid) throw Error('自分への友達申請はできません。');
      await setDoc(doc(db, 'connections', uid + '~' + recipient), {
        sender: uid, recipient, participants: [uid, recipient], status: 'pending',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    },
    connections: (uid, cb, error) => onSnapshot(query(collection(db, 'connections'), where('participants', 'array-contains', uid)),
      { includeMetadataChanges: true }, snap => {
        // サーバー確認前のローカル状態を承認済みとして扱わない。
        if (snap.metadata.fromCache) cb(null);
        else if (!snap.metadata.hasPendingWrites) cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, error),
    decide: (id, status) => updateDoc(doc(db, 'connections', id), { status, updatedAt: serverTimestamp() }),
    removeFriend: id => deleteDoc(doc(db, 'connections', id)),
    share: (uid, measurement) => setDoc(shareRef(uid), {
      altitude: measurement.altitude, measuredAt: Timestamp.fromMillis(measurement.timestamp), updatedAt: serverTimestamp(),
    }),
    stop: uid => {
      if (pendingStops.has(uid)) return pendingStops.get(uid);
      const pending = deleteDoc(shareRef(uid));
      pendingStops.set(uid, pending);
      const cleanup = () => { if (pendingStops.get(uid) === pending) pendingStops.delete(uid); };
      pending.then(cleanup, cleanup);
      return pending;
    },
    ownShare: async uid => (await read(shareRef(uid))).data(),
    watchShare,
    friendShare: async uid => (await read(shareRef(uid))).data(),
  };
}
