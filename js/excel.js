// Excel 取り込み・書き出し（SheetJS を必要なときだけ読み込む）
import { state, active, newRecord, settings, updateSettings, save, uid, totals, fuelStats, CATS } from './data.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let loading = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { loading = null; reject(new Error('Excel 読み込み部品を取得できません（オンラインで再試行）')); };
    document.head.appendChild(s);
  });
  return loading;
}

const serialToYmd = v => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v).match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};
const toNum = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = v => (v === undefined || v === null) ? '' : String(v).trim();

/**
 * 既存の「JB7 ランニングコスト.xlsx」形式を読み取り、レコード配列と設定値を返す
 */
export async function parseWorkbook(arrayBuffer) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellFormula: true });
  const sh = name => wb.Sheets[name];
  const cell = (ws, addr) => ws && ws[addr] ? ws[addr] : null;
  const val = (ws, addr) => { const c = cell(ws, addr); return c ? c.v : undefined; };
  const lastRow = ws => ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).e.r + 1 : 0;

  const records = [];
  const patch = {};
  const warnings = [];

  const sum = sh('合算額');
  if (sum) {
    const loan = toNum(val(sum, 'H9')); if (loan !== null) patch.loanPaid = loan;
    const pc = toNum(val(sum, 'H10')); if (pc !== null) patch.purchaseCost = pc;
    const coat = toNum(val(sum, 'D10'));
    if (coat) records.push(newRecord('coating', { title: 'コーティング', amount: coat }));
  } else warnings.push('「合算額」シートが見つかりません');

  const docs = sh('書類関係');
  for (let r = 3; r <= lastRow(docs); r++) {
    const title = str(val(docs, `C${r}`));
    if (!title) continue;
    records.push(newRecord('doc', { title, amount: toNum(val(docs, `D${r}`)) || 0, note: str(val(docs, `E${r}`)), group: str(val(docs, `B${r}`)) }));
  }

  const cus = sh('カスタム費用');
  for (let r = 3; r <= lastRow(cus); r++) {
    const title = str(val(cus, `B${r}`));
    if (!title) continue;
    const c = cell(cus, `C${r}`);
    records.push(newRecord('custom', { title, amount: toNum(c && c.v) || 0, note: str(val(cus, `D${r}`)), extra: c && c.f ? { expr: c.f } : {} }));
  }

  const mt = sh('メンテナンス費用');
  if (mt) {
    const d = toNum(val(mt, 'F2')); if (d) patch.deliveryOdo = d;
    for (let r = 4; r <= lastRow(mt); r++) {
      const title = str(val(mt, `C${r}`));
      if (!title) continue;
      records.push(newRecord('maint', { title, amount: toNum(val(mt, `D${r}`)) || 0, date: serialToYmd(val(mt, `E${r}`)), odo: toNum(val(mt, `F${r}`)), note: str(val(mt, `G${r}`)) }));
    }
  }

  const gas = sh('ガソリン代');
  for (let r = 3; r <= lastRow(gas); r++) {
    const date = serialToYmd(val(gas, `C${r}`));
    const amount = toNum(val(gas, `D${r}`));
    if (!date && !amount) continue;
    records.push(newRecord('fuel', { title: '給油', date, amount: amount || 0, odo: toNum(val(gas, `E${r}`)), liters: toNum(val(gas, `G${r}`)), full: true }));
  }

  // 給油量が中央値の半分未満の給油は「継ぎ足し」とみなす（燃費計算を崩さないため。あとで編集可）
  const fuels = records.filter(r => r.type === 'fuel' && r.liters);
  if (fuels.length >= 3) {
    const sorted = fuels.map(r => r.liters).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const r of fuels) if (r.liters < median / 2) { r.full = false; warnings.push(`${r.date} の給油（${r.liters}L）は継ぎ足しとして取り込みます`); }
  }

  const plan = sh('カスタム計画');
  for (let r = 6; r <= lastRow(plan); r++) {
    const title = str(val(plan, `D${r}`));
    if (!title) continue;
    records.push(newRecord('plan', { title, amount: toNum(val(plan, `E${r}`)) || 0, extra: { genre: str(val(plan, `B${r}`)), maker: str(val(plan, `C${r}`)), link: str(val(plan, `F${r}`)) } }));
  }

  return { records, patch, warnings };
}

/** 取り込み結果を反映。replace=true なら既存レコードを削除扱いにしてから追加 */
export function applyImport({ records, patch }, replace) {
  const now = Date.now();
  if (replace) for (const r of active()) { r.deleted = true; r.updatedAt = now; }
  for (const r of records) { r.updatedAt = now; state.records.push(r); }
  save();
  if (Object.keys(patch).length) updateSettings(patch);
}

/** 元の Excel と同じシート構成で書き出す */
export async function exportWorkbook() {
  const XLSX = await loadXLSX();
  const s = settings();
  const t = totals();
  const fs = fuelStats();
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.odo || 0) - (b.odo || 0);
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  add('合算額', [
    ['愛車に費やした総額', t.grand, '支払ったローン額', t.loan, '買ってからの維持費総額', t.upkeep],
    [],
    ['内訳', '金額', '', '車両のみ支払総額', s.loanPaid],
    ...['coating', 'doc', 'custom', 'maint', 'fuel'].map((k, i) => [CATS[k].label, t.byType[k], '', i === 0 ? '車両購入費用' : '', i === 0 ? s.purchaseCost : '']),
    [],
    ['納車距離', s.deliveryOdo, '現在の平均燃費(km/L)', fs.avgEconomy ? Math.round(fs.avgEconomy * 10) / 10 : ''],
  ]);
  add('書類関係', [['区分', '品名', '金額', '日付', '備考'], ...active('doc').sort(byDate).map(r => [r.group, r.title, r.amount, r.date, r.note])]);
  add('カスタム費用', [['No', '商品名', '金額', '日付', '備考'], ...active('custom').sort(byDate).map((r, i) => [i + 1, r.title, r.amount, r.date, r.note])]);
  add('メンテナンス費用', [['No', '実施項目', '費用', '実施日', '走行距離 km', '備考'], ...active('maint').sort(byDate).map((r, i) => [i + 1, r.title, r.amount, r.date, r.odo ?? '', r.note])]);
  add('ガソリン代', [['回', '実施日', '費用', 'odo', '前回からの距離', '給油量', '単価', '燃費(km/L)', '満タン', '備考'],
    ...fs.ordered.map((r, i) => {
      const p = fs.per[r.id] || {};
      return [`${i + 1}回目`, r.date, r.amount, r.odo, p.dist ?? '', r.liters ?? '', p.unit ? Math.round(p.unit * 10) / 10 : '', p.economy ? Math.round(p.economy * 10) / 10 : '', r.full === false ? '' : '○', r.note];
    })]);
  add('コーティング', [['名称', '金額', '日付', '備考'], ...active('coating').sort(byDate).map(r => [r.title, r.amount, r.date, r.note])]);
  add('カスタム計画', [['ジャンル', 'メーカー名', '名称', '価格', 'リンク', '備考'], ...active('plan').map(r => [r.extra?.genre || '', r.extra?.maker || '', r.title, r.amount, r.extra?.link || '', r.note])]);

  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(wb, `JB7ランニングコスト_${stamp}.xlsx`);
}

export function exportJSON() {
  const blob = new Blob([JSON.stringify({ app: 'jb7-running-cost', exportedAt: new Date().toISOString(), records: state.records }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jb7-backup-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.records)) throw new Error('バックアップファイルの形式が違います');
  const now = Date.now();
  for (const r of active()) { r.deleted = true; r.updatedAt = now; }
  for (const r of data.records) {
    const rec = { ...r, updatedAt: now };
    const i = state.records.findIndex(x => x.id === rec.id);
    if (i >= 0) state.records[i] = rec; else state.records.push(rec);
  }
  save();
}
export { uid };
