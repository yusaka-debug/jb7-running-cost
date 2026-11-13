// データ保存・モデル・計算ロジック
export const APP_VERSION = '0.6.2';

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

export const JB7_MAINT_PRESETS = [
  'オイル交換', 'オイル・フィルター交換', 'MTオイル・EGオイル・フィルター交換', 'ATF交換',
  'タイヤ交換（冬→夏）', 'タイヤ交換（冬）ローテーション', 'オイル交換・タイヤローテーション',
  'リアタイヤ交換持ち込み1本', 'タイヤ代', '12か月点検', 'キーパーコーティング（2回目）',
  'エアコンエバポレーター洗浄', 'エアコンフィルター交換', 'エアクリ、エレメント交換',
  'リアブレーキパッド交換', 'ブレーキパッドチェック', 'ブレーキフルード交換', 'ワイパーゴム交換',
  'リアワイパー交換', '助手席ウインドウモーター交換', 'スマートキーボタン電池交換', 'バッテリー交換',
];
export const CAR_MAINT_PRESETS = [
  'オイル交換', 'オイル・フィルター交換', 'MTオイル交換', 'デフオイル交換', 'タイヤ交換（夏→冬）', 'タイヤ交換（冬→夏）',
  'タイヤローテーション', 'タイヤ代', '12か月点検', '車検', 'エアコンフィルター交換', 'エアクリーナー交換',
  'ブレーキパッド交換', 'ブレーキフルード交換', 'クーラント交換', 'スパークプラグ交換', 'ワイパーゴム交換', 'バッテリー交換', '洗車',
];
export const BIKE_MAINT_PRESETS = [
  'オイル交換', 'オイル・フィルター交換', 'チェーン清掃・注油', 'チェーン調整', 'チェーン・スプロケット交換',
  'タイヤ交換（前）', 'タイヤ交換（後）', 'ブレーキパッド交換（前）', 'ブレーキパッド交換（後）', 'ブレーキフルード交換',
  'クーラント交換', 'エアクリーナー交換', 'スパークプラグ交換', 'バッテリー交換', '12か月点検', '車検', '洗車',
];

// 交換・点検の目安（keyword は記録の「実施項目」に含まれる言葉。| で区切ると複数）
const REMINDERS = {
  car: [
    { name: 'エンジンオイル', keyword: 'オイル', km: 5000, months: 6 },
    { name: 'オイルフィルター', keyword: 'オイル・フィルター|オイルフィルター|オイルエレメント', km: 10000, months: 12 },
    { name: 'ブレーキフルード', keyword: 'ブレーキフルード|ブレーキオイル', km: 0, months: 24 },
    { name: 'ミッションオイル', keyword: 'ATF|CVT|MTオイル|ミッションオイル', km: 40000, months: 0 },
    { name: 'エアクリーナー', keyword: 'エアクリ|エアエレメント', km: 30000, months: 0 },
    { name: 'タイヤローテーション', keyword: 'ローテーション', km: 5000, months: 0 },
    { name: 'エアコンフィルター', keyword: 'エアコンフィルター', km: 0, months: 12 },
    { name: 'ワイパーゴム', keyword: 'ワイパー', km: 0, months: 12 },
    { name: 'バッテリー', keyword: 'バッテリー', km: 0, months: 36 },
    { name: '12か月点検', keyword: '12か月点検|12ヶ月点検|法定点検|車検', km: 0, months: 12 },
  ],
  bike: [
    { name: 'エンジンオイル', keyword: 'オイル', km: 3000, months: 6 },
    { name: 'オイルフィルター', keyword: 'オイル・フィルター|オイルフィルター|オイルエレメント', km: 6000, months: 12 },
    { name: 'チェーン注油', keyword: 'チェーン', km: 1000, months: 0 },
    { name: 'ブレーキフルード', keyword: 'ブレーキフルード', km: 0, months: 24 },
    { name: 'バッテリー', keyword: 'バッテリー', km: 0, months: 24 },
    { name: '12か月点検', keyword: '12か月点検|12ヶ月点検|法定点検', km: 0, months: 12 },
  ],
};
const REMINDERS_V = 2;   // 標準の目安を増やしたら上げる（既存の乗り物に足りない分だけ追加される）

// 乗り物ごとの設定。id は設定レコードの id（JB7 は過去データ互換のため 'settings'）
export const DEFAULT_VEHICLE = {
  vehicleName: '新しい乗り物', kind: 'car', order: 99,
  deliveryOdo: 0, deliveryDate: '', loanPaid: 0, purchaseCost: 0,
  reminders: REMINDERS.car, maintPresets: CAR_MAINT_PRESETS,
};
const BUILTIN_VEHICLES = {
  'settings':      { vehicleName: 'JB7 ライフ', kind: 'car', order: 0, deliveryOdo: 60000, reminders: [{ name: 'エンジンオイル', keyword: 'オイル', km: 3000, months: 6 }, ...REMINDERS.car.slice(1)], maintPresets: JB7_MAINT_PRESETS, remindersV: REMINDERS_V },
  'settings-fl5':  { vehicleName: 'FL5', kind: 'car', order: 1, reminders: REMINDERS.car, maintPresets: CAR_MAINT_PRESETS, remindersV: REMINDERS_V },
  'settings-mc51': { vehicleName: 'MC51', kind: 'bike', order: 2, displacement: 250, reminders: REMINDERS.bike, maintPresets: BIKE_MAINT_PRESETS, remindersV: REMINDERS_V },
};
export const presetsForKind = kind => kind === 'bike' ? BIKE_MAINT_PRESETS : CAR_MAINT_PRESETS;
export const remindersForKind = kind => REMINDERS[kind] || REMINDERS.car;

const KEY = 'jb7rc.v1';
const SYNC_KEY = 'jb7rc.sync';
const VID_KEY = 'jb7rc.vid';

export const state = {
  records: [],          // type=settings（乗り物）を含む全レコード（削除は deleted=true の墓標）
  vid: 'settings',      // 表示中の乗り物
  sync: { url: '', token: '', lastPush: 0, lastSyncAt: 0, status: 'off', error: '' },
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state.records = raw ? (JSON.parse(raw).records || []) : [];
  } catch (e) { console.error(e); }
  try {
    const s = localStorage.getItem(SYNC_KEY);
    if (s) Object.assign(state.sync, JSON.parse(s));
  } catch (e) { console.error(e); }
  ensureBuiltins();
  migrateVehicles();
  try { state.vid = localStorage.getItem(VID_KEY) || 'settings'; } catch {}
  fixCurrentVid();
}

// 標準の乗り物（JB7/FL5/MC51）が無ければ作る。updatedAt=0 なので他端末で編集済みの内容が同期で必ず勝つ
export function ensureBuiltins() {
  for (const [id, v] of Object.entries(BUILTIN_VEHICLES)) {
    if (!state.records.find(r => r.id === id)) {
      state.records.push({ id, type: 'settings', extra: { ...DEFAULT_VEHICLE, ...v }, updatedAt: 0, deleted: false });
    }
  }
}

/** 標準の交換目安が増えたとき、既存の乗り物に無い項目だけ追加する（名前が同じものは触らない） */
export function migrateVehicles() {
  let dirty = false;
  for (const r of state.records) {
    if (r.type !== 'settings' || r.deleted) continue;
    const ex = r.extra || (r.extra = {});
    if ((ex.remindersV || 1) >= REMINDERS_V) continue;
    if (Array.isArray(ex.reminders)) {   // 無い場合は標準（最新）がそのまま使われる
      const have = new Set(ex.reminders.map(x => x.name));
      ex.reminders = [...ex.reminders, ...remindersForKind(ex.kind || 'car').filter(x => !have.has(x.name))];
    }
    ex.remindersV = REMINDERS_V;
    if (r.updatedAt) r.updatedAt = Date.now();   // 0 の標準データは同期で他端末の内容が勝つようにそのまま
    dirty = true;
  }
  if (dedupeFuel()) dirty = true;
  if (dirty) save();
  return dirty;
}

// 同じ乗り物・同じ日・同じ金額の給油が「距離あり」と「距離なし」で二重にあるとき（Excel 取り込み分と
// トータルケア等から入れた分など）、距離なしの方を削除扱いにする。メモは残す側へ移す
// 金額が 0（記録なし）のものや、同じ日の距離ありの給油の合計とほぼ同じ金額（1日2回をまとめて1行にしたもの）も対象
function dedupeFuel() {
  const byDay = new Map();
  const key = r => `${r.extra?.vid || 'settings'}|${r.date}`;
  for (const r of state.records) {
    if (r.type !== 'fuel' || r.deleted || !r.odo || !r.date) continue;
    if (!byDay.has(key(r))) byDay.set(key(r), []);
    byDay.get(key(r)).push(r);
  }
  let dirty = false;
  for (const r of state.records) {
    if (r.type !== 'fuel' || r.deleted || r.odo || !r.date) continue;
    const day = byDay.get(key(r));
    if (!day) continue;
    const amt = Number(r.amount) || 0;
    const sum = day.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const keep = day.find(x => (Number(x.amount) || 0) === amt) || ((!amt || Math.abs(sum - amt) <= Math.max(50, sum * 0.01)) ? day[0] : null);
    if (!keep) continue;
    if (r.note && !keep.note) { keep.note = r.note; keep.updatedAt = Date.now(); }
    r.deleted = true; r.updatedAt = Date.now();
    dirty = true;
  }
  return dirty;
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify({ records: state.records }));
}
export function saveSync() {
  const { url, token, lastPush, lastSyncAt } = state.sync;
  localStorage.setItem(SYNC_KEY, JSON.stringify({ url, token, lastPush, lastSyncAt }));
}

// ---------- 乗り物 ----------
export function vehicles() {
  return state.records.filter(r => r.type === 'settings' && !r.deleted)
    .map(r => ({ id: r.id, ...DEFAULT_VEHICLE, ...(BUILTIN_VEHICLES[r.id] || {}), ...(r.extra || {}) }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.vehicleName.localeCompare(b.vehicleName));
}
export function fixCurrentVid() {
  const vs = vehicles();
  if (!vs.find(v => v.id === state.vid)) state.vid = vs[0]?.id || 'settings';
}
export function setVehicle(vid) {
  state.vid = vid;
  try { localStorage.setItem(VID_KEY, vid); } catch {}
}
export function addVehicle(name, kind) {
  const order = Math.max(0, ...vehicles().map(v => v.order ?? 0)) + 1;
  const id = 'settings-' + uid();
  state.records.push({ id, type: 'settings', extra: { ...DEFAULT_VEHICLE, vehicleName: name, kind, order, reminders: remindersForKind(kind), maintPresets: presetsForKind(kind), remindersV: REMINDERS_V }, updatedAt: Date.now(), deleted: false });
  save();
  return id;
}
export function deleteVehicle(vid) {
  const now = Date.now();
  for (const r of state.records) {
    if (r.id === vid || (r.type !== 'settings' && vidOf(r) === vid)) { r.deleted = true; r.updatedAt = now; }
  }
  save();
  fixCurrentVid();
}

export const vidOf = r => (r.extra && r.extra.vid) || 'settings';

export function settings(vid = state.vid) {
  const r = state.records.find(x => x.id === vid && x.type === 'settings');
  return { ...DEFAULT_VEHICLE, ...(BUILTIN_VEHICLES[vid] || {}), ...(r ? r.extra : {}) };
}
export function updateSettings(patch, vid = state.vid) {
  let r = state.records.find(x => x.id === vid && x.type === 'settings');
  if (!r) { r = { id: vid, type: 'settings', extra: {}, deleted: false }; state.records.push(r); }
  r.extra = { ...settings(vid), ...patch };
  r.updatedAt = Date.now();
  save();
}

/** 有効なレコード。vid='*' で全乗り物 */
export function active(type, vid = state.vid) {
  return state.records.filter(r => !r.deleted && r.type !== 'settings' && (!type || r.type === type) && (vid === '*' || vidOf(r) === vid));
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

export function newRecord(type, fields = {}, vid = state.vid) {
  return {
    id: uid(), type, date: '', title: '', amount: 0, odo: null, liters: null, full: true,
    note: '', group: '', updatedAt: 0, deleted: false, ...fields,
    extra: { ...(fields.extra || {}), vid },
  };
}

// 金額式（例: 13800+1290）を評価。+ - * / と括弧のみ許可
export function evalAmount(text) {
  const s = String(text ?? '').replace(/[，,円¥\s]/g, '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[＋]/g, '+').replace(/[－−]/g, '-').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/').replace(/．/g, '.');
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

// ---------- 車検 ----------
const ymdOf = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/** 車検が必要か。設定 shaken='yes'/'no'、未設定なら 車＝必要、バイク＝251cc以上なら必要 */
export function shakenRequired(vid = state.vid) {
  const s = settings(vid);
  if (s.shaken === 'yes') return true;
  if (s.shaken === 'no') return false;
  return s.kind !== 'bike' || Number(s.displacement) > 250;
}

/**
 * 次の車検満了日と、お知らせの状態。
 * 車検証の満了日（shakenExpiry）があればそれを基準に、無ければ初度登録年月（firstReg）＋3年（以後2年ごと）を目安にする。
 * 満了日の前後3か月に「車検」の記録があれば済んだものとして次の回へ進む。
 * status: over=満了日を過ぎた / now=受けられる期間（満了2か月前〜） / soon=3か月前〜（予約の準備） / ok
 */
export function shakenInfo(vid = state.vid) {
  const s = settings(vid);
  if (!shakenRequired(vid)) return { required: false };
  let base = s.shakenExpiry || '', approx = false;
  if (!base && /^\d{4}-\d{2}$/.test(s.firstReg || '')) {
    const [y, m] = s.firstReg.split('-').map(Number);
    base = ymdOf(new Date(y + 3, m, 0));   // 登録日が分からないので、3年後の登録月の末日を目安にする
    approx = true;
  }
  if (!base) return { required: true, expiry: null };
  const now = today();
  const done = state.records.filter(r => !r.deleted && (r.type === 'maint' || r.type === 'doc') && vidOf(r) === vid && r.date && /車検|継続検査/.test(r.title || '')).map(r => r.date);
  const isDone = E => done.some(d => d >= addMonths(E, -3) && d <= addMonths(E, 3));
  let E = base;
  for (let i = 0; i < 60 && (isDone(E) || E < addMonths(now, -3)); i++) E = addMonths(E, 24);
  const daysLeft = daysBetween(now, E);
  const canFrom = addMonths(E, -2);
  const status = daysLeft < 0 ? 'over' : now >= canFrom ? 'now' : now >= addMonths(E, -3) ? 'soon' : 'ok';
  return { required: true, expiry: E, approx, daysLeft, canFrom, status };
}

// ---------- 集計（すべて乗り物単位。vid 省略時は表示中の乗り物） ----------
export function sumOf(type, vid = state.vid) {
  return active(type, vid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

export function totals(vid = state.vid) {
  const s = settings(vid);
  const byType = {};
  for (const t of COST_TYPES) byType[t] = sumOf(t, vid);
  const upkeep = COST_TYPES.reduce((a, t) => a + byType[t], 0);
  const loan = Number(s.loanPaid) || 0;
  return { byType, upkeep, loan, grand: upkeep + loan, plan: sumOf('plan', vid) };
}

export function currentOdo(vid = state.vid) {
  const s = settings(vid);
  let max = Number(s.deliveryOdo) || 0;
  for (const r of active(null, vid)) if (r.odo && r.odo > max) max = r.odo;
  return max;
}

// 給油ごとの計算: 前回からの距離 / 単価 / 満タン法燃費
export function fuelStats(vid = state.vid) {
  const list = active('fuel', vid).filter(r => r.odo).sort((a, b) => a.odo - b.odo || (a.date || '').localeCompare(b.date || ''));
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

export function costPerKm(vid = state.vid) {
  const dist = currentOdo(vid) - (Number(settings(vid).deliveryOdo) || 0);
  if (dist <= 0) return { dist, fuel: null, upkeep: null };
  const t = totals(vid);
  return { dist, fuel: t.byType.fuel / dist, upkeep: t.upkeep / dist };
}

// メンテ時期のお知らせ
export function reminders(vid = state.vid) {
  const s = settings(vid);
  const odo = currentOdo(vid);
  const now = today();
  const maint = active('maint', vid);
  return (s.reminders || []).filter(rule => rule.name !== '車検').map(rule => {
    const kw = (rule.keyword || rule.name || '').split('|').map(k => k.trim()).filter(Boolean);
    const hits = maint.filter(r => kw.some(k => (r.title || '').includes(k)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.odo || 0) - (a.odo || 0));
    const last = hits[0];
    const res = { rule, last, remainKm: null, remainDays: null, dueOdo: null, dueDate: null, status: 'unknown' };
    if (!last) return res;
    const fr = [];
    if (rule.km && last.odo) { res.dueOdo = last.odo + Number(rule.km); res.remainKm = res.dueOdo - odo; fr.push((odo - last.odo) / Number(rule.km)); }
    if (rule.months && last.date) {
      res.dueDate = addMonths(last.date, Number(rule.months)); res.remainDays = daysBetween(now, res.dueDate);
      const span = daysBetween(last.date, res.dueDate);
      if (span > 0) fr.push(daysBetween(last.date, now) / span);
    }
    res.progress = fr.length ? Math.max(0, Math.max(...fr)) : null;   // 1 で交換時期
    const over = (res.remainKm !== null && res.remainKm < 0) || (res.remainDays !== null && res.remainDays < 0);
    const soon = (res.remainKm !== null && res.remainKm <= 500) || (res.remainDays !== null && res.remainDays <= 30);
    res.status = over ? 'over' : soon ? 'soon' : 'ok';
    return res;
  });
}

// 月別・年別
export function monthly(vid = state.vid) {
  const map = {};
  for (const r of active(null, vid)) {
    if (!COST_TYPES.includes(r.type) || !r.date) continue;
    const ym = r.date.slice(0, 7);
    map[ym] ??= Object.fromEntries(COST_TYPES.map(t => [t, 0]));
    map[ym][r.type] += Number(r.amount) || 0;
  }
  return map;
}
export function yearly(vid = state.vid) {
  const map = {};
  for (const r of active(null, vid)) {
    if (!COST_TYPES.includes(r.type)) continue;
    const y = r.date ? r.date.slice(0, 4) : '日付なし';
    map[y] ??= Object.fromEntries(COST_TYPES.map(t => [t, 0]));
    map[y][r.type] += Number(r.amount) || 0;
  }
  return map;
}

export const yen = n => (n === null || n === undefined || Number.isNaN(n)) ? '—' : '¥' + Math.round(n).toLocaleString('ja-JP');
export const num = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n)) ? '—' : Number(n).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
