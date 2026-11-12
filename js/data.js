// データ保存・モデル・計算ロジック
export const APP_VERSION = '0.1.0';

export const CATS = {
  fuel:    { label: 'ガソリン',     short: '給油',     icon: 'ti-gas-station',  color: '#BA7517' },
  maint:   { label: 'メンテナンス', short: 'メンテ',   icon: 'ti-tool',         color: '#D85A30' },
  custom:  { label: 'カスタム',     short: 'カスタム', icon: 'ti-sparkles',     color: '#1D9E75' },
  doc:     { label: '書類・保険・税', short: '書類',   icon: 'ti-file-text',    color: '#534AB7' },
  coating: { label: 'コーティング', short: 'コート',   icon: 'ti-droplet',      color: '#378ADD' },
  plan:    { label: 'カスタム計画', short: '計画',     icon: 'ti-shopping-cart', color: '#888780' },
};
// 維持費に含めるカテゴリ（計画は含めない）
export const COST_TYPES = ['doc', 'custom', 'maint', 'fuel', 'coating'];

export const DEFAULT_MAINT_PRESETS = [
  'オイル交換', 'オイル・フィルター交換', 'MTオイル・EGオイル・フィルター交換', 'ATF交換',
  'タイヤ交換（冬→夏）', 'タイヤ交換（冬）ローテーション', 'オイル交換・タイヤローテーション',
  'リアタイヤ交換持ち込み1本', 'タイヤ代', '12か月点検', 'キーパーコーティング（2回目）',
  'エアコンエバポレーター洗浄', 'エアコンフィルター交換', 'エアクリ、エレメント交換',
  'リアブレーキパッド交換', 'ブレーキパッドチェック', 'ブレーキフルード交換', 'ワイパーゴム交換',
  'リアワイパー交換', '助手席ウインドウモーター交換', 'スマートキーボタン電池交換', 'バッテリー交換',
];

export const DEFAULT_SETTINGS = {
  vehicleName: 'JB7 ライフ',
  deliveryOdo: 60000,
  deliveryDate: '',
  loanPaid: 0,       // 車両のみ支払総額（総額に加算）
  purchaseCost: 0,   // 車両購入費用（参考表示）
  reminders: [
    { name: 'エンジンオイル', keyword: 'オイル', km: 3000, months: 6 },
    { name: 'エアコンフィルター', keyword: 'エアコンフィルター', km: 0, months: 12 },
    { name: 'ワイパーゴム', keyword: 'ワイパー', km: 0, months: 12 },
    { name: 'バッテリー', keyword: 'バッテリー', km: 0, months: 36 },
  ],
  maintPresets: DEFAULT_MAINT_PRESETS,
};

const KEY = 'jb7rc.v1';
const SYNC_KEY = 'jb7rc.sync';

export const state = {
  records: [],          // type=settings を含む全レコード（削除は deleted=true の墓標）
  sync: { url: '', token: '', lastPush: 0, lastSyncAt: 0, status: 'off', error: '' },
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state.records = JSON.parse(raw).records || [];
  } catch (e) { console.error(e); }
  try {
    const s = localStorage.getItem(SYNC_KEY);
    if (s) Object.assign(state.sync, JSON.parse(s));
  } catch (e) { console.error(e); }
  if (!state.records.find(r => r.type === 'settings')) {
    state.records.push({ id: 'settings', type: 'settings', extra: { ...DEFAULT_SETTINGS }, updatedAt: 0, deleted: false });
  }
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify({ records: state.records }));
}
export function saveSync() {
  const { url, token, lastPush, lastSyncAt } = state.sync;
  localStorage.setItem(SYNC_KEY, JSON.stringify({ url, token, lastPush, lastSyncAt }));
}

export function settings() {
  const r = state.records.find(x => x.type === 'settings');
  return { ...DEFAULT_SETTINGS, ...(r ? r.extra : {}) };
}
export function updateSettings(patch) {
  const r = state.records.find(x => x.type === 'settings');
  r.extra = { ...settings(), ...patch };
  r.updatedAt = Date.now();
  save();
}

export function active(type) {
  return state.records.filter(r => !r.deleted && r.type !== 'settings' && (!type || r.type === type));
}

export function upsert(rec) {
  rec.updatedAt = Date.now();
  rec.deleted = !!rec.deleted;
  const i = state.records.findIndex(r => r.id === rec.id);
  if (i >= 0) state.records[i] = rec; else state.records.push(rec);
  save();
  return rec;
}
export function remove(id) {
  const r = state.records.find(x => x.id === id);
  if (r) { r.deleted = true; r.updatedAt = Date.now(); save(); }
}

export function newRecord(type, fields = {}) {
  return {
    id: uid(), type, date: '', title: '', amount: 0, odo: null, liters: null, full: true,
    note: '', group: '', extra: {}, updatedAt: 0, deleted: false, ...fields,
  };
}

// 金額式（例: 13800+1290）を評価。+ - * / と括弧のみ許可
export function evalAmount(text) {
  const s = String(text ?? '').replace(/[，,円¥\s]/g, '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[＋]/g, '+').replace(/[－ー−]/g, '-').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
  if (s === '') return { value: 0, expr: '' };
  if (!/^[0-9+\-*/().]+$/.test(s)) return { value: NaN, expr: s };
  let v;
  try { v = Function('"use strict";return (' + s + ')')(); } catch { v = NaN; }
  return { value: Number.isFinite(v) ? Math.round(v) : NaN, expr: /[+\-*/]/.test(s.replace(/^-/, '')) ? s : '' };
}

// ---------- 日付 ----------
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addMonths(ymd, m) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const dt = new Date(y, mo - 1 + m, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// ---------- 集計 ----------
export function sumOf(type) {
  return active(type).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

export function totals() {
  const s = settings();
  const byType = {};
  for (const t of COST_TYPES) byType[t] = sumOf(t);
  const upkeep = COST_TYPES.reduce((a, t) => a + byType[t], 0);
  return { byType, upkeep, loan: Number(s.loanPaid) || 0, grand: upkeep + (Number(s.loanPaid) || 0), plan: sumOf('plan') };
}

export function currentOdo() {
  const s = settings();
  let max = Number(s.deliveryOdo) || 0;
  for (const r of active()) if (r.odo && r.odo > max) max = r.odo;
  return max;
}

// 給油ごとの計算: 前回からの距離 / 単価 / 満タン法燃費
export function fuelStats() {
  const list = active('fuel').filter(r => r.odo).sort((a, b) => a.odo - b.odo || (a.date || '').localeCompare(b.date || ''));
  const per = {};
  let prev = null, lastFull = null, litersSinceFull = 0;
  let firstFullOdo = null, lastFullOdo = null, litersForAvg = 0;
  for (const r of list) {
    const liters = Number(r.liters) || 0;
    const info = { dist: prev ? r.odo - prev.odo : null, unit: liters ? r.amount / liters : null, economy: null };
    litersSinceFull += liters;
    if (r.full !== false) {
      if (lastFull && litersSinceFull > 0) {
        info.economy = (r.odo - lastFull.odo) / litersSinceFull;
        litersForAvg += litersSinceFull;
        lastFullOdo = r.odo;
      } else {
        firstFullOdo = r.odo;
      }
      lastFull = r; litersSinceFull = 0;
    }
    per[r.id] = info;
    prev = r;
  }
  const avgEconomy = (firstFullOdo !== null && lastFullOdo !== null && litersForAvg > 0) ? (lastFullOdo - firstFullOdo) / litersForAvg : null;
  const totalLiters = list.reduce((a, r) => a + (Number(r.liters) || 0), 0);
  return { per, avgEconomy, totalLiters, ordered: list };
}

export function costPerKm() {
  const dist = currentOdo() - (Number(settings().deliveryOdo) || 0);
  if (dist <= 0) return { dist, fuel: null, upkeep: null };
  const t = totals();
  return { dist, fuel: t.byType.fuel / dist, upkeep: t.upkeep / dist };
}

// メンテ時期のお知らせ
export function reminders() {
  const s = settings();
  const odo = currentOdo();
  const now = today();
  const maint = active('maint');
  return (s.reminders || []).map(rule => {
    const kw = (rule.keyword || rule.name || '').split('|').map(k => k.trim()).filter(Boolean);
    const hits = maint.filter(r => kw.some(k => (r.title || '').includes(k)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.odo || 0) - (a.odo || 0));
    const last = hits[0];
    const res = { rule, last, remainKm: null, remainDays: null, dueOdo: null, dueDate: null, status: 'unknown' };
    if (!last) return res;
    if (rule.km && last.odo) { res.dueOdo = last.odo + Number(rule.km); res.remainKm = res.dueOdo - odo; }
    if (rule.months && last.date) { res.dueDate = addMonths(last.date, Number(rule.months)); res.remainDays = daysBetween(now, res.dueDate); }
    const over = (res.remainKm !== null && res.remainKm < 0) || (res.remainDays !== null && res.remainDays < 0);
    const soon = (res.remainKm !== null && res.remainKm <= 500) || (res.remainDays !== null && res.remainDays <= 30);
    res.status = over ? 'over' : soon ? 'soon' : 'ok';
    return res;
  });
}

// 月別・年別
export function monthly() {
  const map = {};
  for (const r of active()) {
    if (!COST_TYPES.includes(r.type) || !r.date) continue;
    const ym = r.date.slice(0, 7);
    map[ym] ??= Object.fromEntries(COST_TYPES.map(t => [t, 0]));
    map[ym][r.type] += Number(r.amount) || 0;
  }
  return map;
}
export function yearly() {
  const map = {};
  for (const r of active()) {
    if (!COST_TYPES.includes(r.type)) continue;
    const y = r.date ? r.date.slice(0, 4) : '日付なし';
    map[y] ??= Object.fromEntries(COST_TYPES.map(t => [t, 0]));
    map[y][r.type] += Number(r.amount) || 0;
  }
  return map;
}

export const yen = n => (n === null || n === undefined || Number.isNaN(n)) ? '—' : '¥' + Math.round(n).toLocaleString('ja-JP');
export const num = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : Number(n).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
