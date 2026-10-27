// 表示専用。通信・位置情報・永続保存には触れない。
export function timestampMillis(timestamp) {
  try {
    const value = timestamp instanceof Date ? timestamp.getTime()
      : typeof timestamp?.toMillis === 'function' ? timestamp.toMillis()
      : typeof timestamp?.toDate === 'function' ? timestamp.toDate().getTime() : null;
    return Number.isFinite(value) && Math.abs(value) <= 8640000000000000 ? value : null;
  } catch { return null; }
}
export function relativeUpdatedAt(timestamp, now = Date.now()) {
  const value = timestampMillis(timestamp);
  if (value === null) return '更新情報なし';
  const elapsed = Math.max(0, now - value); // 未来時刻でも負の経過時間は表示しない。
  if (elapsed < 60000) return 'たった今';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}分前`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}時間前`;
  if (elapsed < 604800000) return `${Math.floor(elapsed / 86400000)}日前`;
  const d = new Date(value);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
