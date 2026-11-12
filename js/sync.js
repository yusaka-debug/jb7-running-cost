// Google スプレッドシート（Apps Script Web アプリ）との同期
// 方式: 前回同期以降に変更したレコードを送信 → サーバーが updatedAt の新しい方を採用して保存 → 全件を返す → 端末側も新しい方を採用
import { state, save, saveSync } from './data.js';

let running = null;
let timer = null;
const listeners = new Set();
export const onSyncChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn(state.sync));

export function syncConfigured() {
  return !!(state.sync.url && state.sync.token);
}

export function scheduleSync(delay = 2000) {
  if (!syncConfigured()) return;
  clearTimeout(timer);
  state.sync.status = 'pending'; emit();
  timer = setTimeout(() => syncNow().catch(() => {}), delay);
}

export async function syncNow() {
  if (!syncConfigured()) { state.sync.status = 'off'; emit(); return { skipped: true }; }
  if (running) return running;
  running = (async () => {
    const startedAt = Date.now();
    const changes = state.records.filter(r => (r.updatedAt || 0) > (state.sync.lastPush || 0));
    state.sync.status = 'syncing'; state.sync.error = ''; emit();
    try {
      const res = await fetch(state.sync.url, {
        method: 'POST',
        // text/plain にするとプリフライトが発生せず Apps Script でも CORS が通る
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: state.sync.token, action: 'sync', changes }),
        redirect: 'follow',
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('サーバーの応答を読めません（URLかデプロイ設定を確認）'); }
      if (!data.ok) throw new Error(data.error === 'unauthorized' ? '合言葉（トークン）が一致しません' : (data.error || '同期に失敗しました'));
      let changed = 0;
      for (const sr of data.records) {
        const rec = normalize(sr);
        const i = state.records.findIndex(r => r.id === rec.id);
        if (i < 0) { state.records.push(rec); changed++; }
        else if ((rec.updatedAt || 0) > (state.records[i].updatedAt || 0)) { state.records[i] = rec; changed++; }
      }
      save();
      state.sync.lastPush = startedAt;
      state.sync.lastSyncAt = Date.now();
      state.sync.status = state.records.some(r => (r.updatedAt || 0) > startedAt) ? 'pending' : 'ok';
      saveSync(); emit();
      return { pushed: changes.length, pulled: changed };
    } catch (e) {
      state.sync.status = 'error';
      state.sync.error = e.message === 'Failed to fetch' ? 'オフラインか、URLに接続できません' : e.message;
      emit();
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

// シートから戻ってきた値を端末の形式に揃える
function normalize(r) {
  const n = v => (v === '' || v === null || v === undefined) ? null : Number(v);
  let extra = r.extra;
  if (typeof extra === 'string') { try { extra = extra ? JSON.parse(extra) : {}; } catch { extra = {}; } }
  return {
    id: String(r.id), type: String(r.type), date: r.date ? String(r.date).slice(0, 10) : '',
    title: r.title == null ? '' : String(r.title), amount: Number(r.amount) || 0,
    odo: n(r.odo), liters: n(r.liters), full: !(r.full === false || r.full === 'FALSE' || r.full === 'false'),
    note: r.note == null ? '' : String(r.note), group: r.group == null ? '' : String(r.group),
    extra: extra || {}, updatedAt: Number(r.updatedAt) || 0,
    deleted: r.deleted === true || r.deleted === 'TRUE' || r.deleted === 'true',
  };
}
