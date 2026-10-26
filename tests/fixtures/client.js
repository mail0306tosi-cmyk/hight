// UIのみを検証するテスト用クライアント。本番ビルドでは一切使わない。
export function createClient() {
  let observer, connectionObserver, profile, mine, relationships = [];
  let user = null;
  const active = new Set(), history = [];
  const state = window.uiFixture = { calls: [], active, late() { history.forEach(cb => cb({ altitude: 999, updatedAt: { toDate: () => new Date() }, measuredAt: { toDate: () => new Date() } }, true)); }, failStop: false, otherShare: { altitude: 862, updatedAt: { toDate: () => new Date() }, measuredAt: { toDate: () => new Date() } },
    incoming() { relationships = [{ id: 'bob~alice', sender: 'bob', recipient: 'alice', participants: ['bob','alice'], status: 'pending' }]; connectionObserver?.(relationships); } };
  const emit = () => observer?.(user);
  return {
    observeAuth(cb) { observer = cb; queueMicrotask(() => cb(user)); },
    register: async () => { user = { uid: 'alice', email: 'alice@example.com', emailVerified: false }; emit(); },
    login: async () => { user = { uid: 'alice', email: 'alice@example.com', emailVerified: false }; emit(); },
    sendVerification: async () => { state.calls.push(['verify']); },
    refresh: async () => { user.emailVerified = true; return user; },
    verified: async () => true,
    profile: async uid => uid === 'alice' ? profile : { nickname: 'やま' },
    privateProfile: async () => profile ? { inviteCode: profile.inviteCode } : undefined,
    ownShare: async () => mine,
    saveProfile: async (uid, nickname) => { profile = { nickname, inviteCode: 'A'.repeat(32) }; return profile.inviteCode; },
    connections(uid, cb) { connectionObserver = cb; queueMicrotask(() => cb(relationships)); return () => { connectionObserver = null; }; },
    requestFriend: async () => {},
    decide: async (id, status) => { relationships[0].status = status; connectionObserver(relationships); },
    removeFriend: async () => { relationships = []; connectionObserver(relationships); },
    watchShare(uid, cb, error) { if (uid === 'alice') { state.ownCallback = cb; state.ownError = error; } active.add(cb); history.push(cb); queueMicrotask(() => cb(uid === 'alice' ? mine : state.otherShare, true)); return () => { active.delete(cb); }; },
    friendShare: async () => state.otherShare,
    share: async (uid, value) => { state.calls.push(['share', structuredClone(value)]); if (state.sharePending) return new Promise(resolve => { state.resolveShare = () => { mine = value; resolve(); }; }); mine = value; },
    stop: async () => { state.calls.push(['stop']); if (state.stopPending) return new Promise(resolve => { state.resolveStop = () => { mine = null; resolve(); }; }); if (state.failStop) throw Object.assign(Error('offline'), { code: 'unavailable' }); mine = null; },
    logout: async () => { state.calls.push(['logout']); user = null; emit(); },
  };
}
