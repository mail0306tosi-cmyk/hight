// UIのみを検証するテスト用クライアント。本番ビルドでは一切使わない。
export function createClient() {
  let observer, connectionObserver, profile, mine, relationships = [];
  let user = null;
  const active = new Set(), history = [];
  const state = window.uiFixture = { calls: [], active, late() { history.forEach(cb => cb({ altitude: 999, updatedAt: { toDate: () => new Date() }, measuredAt: { toDate: () => new Date() } }, true)); }, failStop: false, otherShare: { altitude: 862, updatedAt: { toDate: () => new Date() }, measuredAt: { toDate: () => new Date() } },
    seedFriends() {
      state.profileNames = { north: 'そら', east: 'りん', quietA: 'あおい', quietB: 'はる' };
      const ts = ms => ({ toDate: () => new Date(ms) });
      state.friendShares = { north: { altitude: 412, updatedAt: ts(1700000002000), measuredAt: ts(1700000001000) }, east: { altitude: 86, updatedAt: ts(1700000004000), measuredAt: ts(1700000003000) }, quietA: null, quietB: null };
      relationships = Object.keys(state.profileNames).reverse().map(uid => ({ id: uid + '~alice', sender: uid, recipient: 'alice', status: 'accepted' })); connectionObserver?.(relationships);
    },
    friendCallbacks: new Map(),
    emitFriend(uid, share, confirmed = true) { state.friendCallbacks.get(uid)?.cb(share, confirmed); },
    friendError(uid) { state.friendCallbacks.get(uid)?.error({ code: 'permission-denied' }); },
    incoming() { relationships = [{ id: 'bob~alice', sender: 'bob', recipient: 'alice', participants: ['bob','alice'], status: 'pending' }]; connectionObserver?.(relationships); } };
  const emit = () => observer?.(user);
  return {
    observeAuth(cb) { observer = cb; queueMicrotask(() => cb(user)); },
    register: async () => { user = { uid: 'alice', email: 'alice@example.com', emailVerified: false }; emit(); },
    login: async () => { user = { uid: 'alice', email: 'alice@example.com', emailVerified: false }; emit(); },
    sendVerification: async () => { state.calls.push(['verify']); },
    refresh: async () => { user.emailVerified = true; return user; },
    verified: async () => true,
    profile: async uid => uid === 'alice' ? profile : { nickname: state.profileNames?.[uid] || 'やま' },
    privateProfile: async () => profile ? { inviteCode: profile.inviteCode } : undefined,
    ownShare: async () => mine,
    saveProfile: async (uid, nickname) => { profile = { nickname, inviteCode: 'A'.repeat(32) }; return profile.inviteCode; },
    connections(uid, cb) { connectionObserver = cb; queueMicrotask(() => cb(relationships)); return () => { connectionObserver = null; }; },
    requestFriend: async () => {},
    decide: async (id, status) => { relationships[0].status = status; connectionObserver(relationships); },
    removeFriend: async () => { relationships = []; connectionObserver(relationships); },
    watchShare(uid, cb, error) { if (uid === 'alice') { state.ownCallback = cb; state.ownError = error; } active.add(cb); history.push(cb); state.friendCallbacks.set(uid, { cb, error }); queueMicrotask(() => cb(uid === 'alice' ? mine : state.friendShares && Object.hasOwn(state.friendShares, uid) ? state.friendShares[uid] : state.otherShare, true)); return () => { active.delete(cb); }; },
    friendShare: async () => state.otherShare,
    share: async (uid, value) => { state.calls.push(['share', structuredClone(value)]); if (state.sharePending) return new Promise(resolve => { state.resolveShare = () => { mine = value; resolve(); }; }); mine = value; },
    stop: async () => { state.calls.push(['stop']); if (state.stopPending) return new Promise(resolve => { state.resolveStop = () => { mine = null; resolve(); }; }); if (state.failStop) throw Object.assign(Error('offline'), { code: 'unavailable' }); mine = null; },
    logout: async () => { state.calls.push(['logout']); user = null; emit(); },
  };
}
