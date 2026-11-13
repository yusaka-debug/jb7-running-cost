import {
  APP_VERSION, CATS, COST_TYPES, state, load, save, saveSync, settings, updateSettings, active, upsert, remove, newRecord,
  evalAmount, today, totals, currentOdo, fuelStats, costPerKm, reminders, monthly, yearly, yen, num,
  vehicles, setVehicle, addVehicle, deleteVehicle, fixCurrentVid, presetsForKind, remindersForKind,
} from './data.js';
import { readReceipt } from './receipt.js';
import { syncNow, scheduleSync, onSyncChange, syncConfigured, loadFile } from './sync.js';
import { storeFile, delBlob, discardFiles, fmtSize, isPdf, isImage, getBlob } from './files.js';
import { readMaintDoc } from './docread.js';
import { parseWorkbook, applyImport, exportWorkbook, exportJSON, importJSON } from './excel.js';

const $main = document.getElementById('main');
const $sheet = document.getElementById('sheet');
const ui = { view: 'home', cat: 'all', statsYear: 'all' };
try { Object.assign(ui, JSON.parse(sessionStorage.getItem('jb7.ui') || '{}')); } catch {}

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = ymd => ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : '日付なし';
const icon = (name, extra = '') => `<i class="ti ${name}" aria-hidden="true" ${extra}></i>`;

function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function go(view, opts = {}) {
  if (view === 'add') { openForm(ui.view === 'records' && ui.cat !== 'all' ? ui.cat : 'fuel'); return; }
  Object.assign(ui, { view }, opts);
  try { sessionStorage.setItem('jb7.ui', JSON.stringify(ui)); } catch {}
  render();
  window.scrollTo(0, 0);
}
document.getElementById('nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) go(b.dataset.view);
});

function changed() { render(); scheduleSync(); }

// ---------- 共通パーツ ----------
function syncPill() {
  const s = state.sync;
  if (!syncConfigured()) return `<button class="sync-pill" data-act="to-settings">${icon('ti-cloud-off')}端末のみ</button>`;
  const map = {
    ok: ['ok', 'ti-cloud-check', '同期済み'], syncing: ['', 'ti-refresh', '同期中…'], pending: ['', 'ti-cloud-upload', '未同期'],
    error: ['error', 'ti-cloud-x', '同期エラー'], off: ['', 'ti-cloud', '同期'],
  };
  const [cls, ic, label] = map[s.status] || map.off;
  return `<button class="sync-pill ${cls}" data-act="sync" title="${h(s.error)}">${icon(ic)}${label}</button>`;
}
function vehicleTabs() {
  const vs = vehicles();
  return `<div class="vtabs" role="tablist" aria-label="乗り物">${vs.map(v => `<button class="vtab ${v.id === state.vid ? 'active' : ''}" data-vid="${h(v.id)}" role="tab">
    ${icon(v.kind === 'bike' ? 'ti-motorbike' : 'ti-car')}<span>${h(v.vehicleName)}</span></button>`).join('')}
    <button class="vtab add" data-act="add-vehicle" aria-label="乗り物を追加">${icon('ti-plus')}</button></div>`;
}
function topbar(title) {
  return `<div class="topbar"><h1>${h(title)}</h1>${syncPill()}</div>${vehicleTabs()}`;
}

function subLine(r, fs) {
  const parts = [md(r.date)];
  if (r.odo) parts.push(`${num(r.odo)}km`);
  if (r.type === 'fuel') {
    const p = fs.per[r.id] || {};
    if (r.liters) parts.push(`${num(r.liters, 2)}L`);
    if (p.unit) parts.push(`¥${num(p.unit, 1)}/L`);
    if (p.economy) parts.push(`${num(p.economy, 1)}km/L`);
    if (p.dist !== null && p.dist !== undefined) parts.push(`前回から${num(p.dist)}km`);
  }
  if (r.type === 'doc' && r.group) parts.push(r.group);
  return parts.join(' · ');
}

function tlItem(r, fs) {
  const c = CATS[r.type];
  const title = r.type === 'fuel' ? `給油${r.liters ? ' ' + num(r.liters, 2) + 'L' : ''}` : r.title;
  const badges = [];
  if (r.type === 'fuel' && r.full === false) badges.push('継ぎ足し');
  if (r.extra?.expr) badges.push(h(r.extra.expr));
  if (r.extra?.files?.length) badges.push(`${icon('ti-paperclip')}${r.extra.files.length}`);
  let plan = '';
  if (r.type === 'plan') {
    const meta = [r.extra?.genre, r.extra?.maker].filter(Boolean).join(' · ');
    plan = `${meta ? `<div class="s">${h(meta)}</div>` : ''}${r.extra?.link ? `<div class="s"><a href="${h(r.extra.link)}" target="_blank" rel="noopener" data-stop>${icon('ti-external-link')} リンクを開く</a></div>` : ''}
      <div class="btn-row" style="margin-top:6px"><span class="btn" data-act="bought" data-id="${h(r.id)}">${icon('ti-check')}購入済みにする</span></div>`;
  }
  return `<div class="tl-item" role="button" tabindex="0" style="--c:${c.color}" data-edit="${h(r.id)}">
    <div class="t"><span>${icon(c.icon)}<span>${h(title)}</span>${badges.map(b => `<span class="badge">${b}</span>`).join('')}</span><span>${yen(r.amount)}</span></div>
    ${r.type === 'plan' ? plan : `<div class="s">${h(subLine(r, fs))}</div>`}
    ${r.note ? `<div class="n">${h(r.note)}</div>` : ''}
  </div>`;
}

function sortRecords(list) {
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.odo || 0) - (a.odo || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

// ---------- ホーム（A） ----------
function renderHome() {
  const s = settings();
  const t = totals();
  const fs = fuelStats();
  const cpk = costPerKm();
  const rems = reminders().filter(r => r.status !== 'unknown');
  const recent = sortRecords(active().filter(r => r.type !== 'plan')).slice(0, 6);
  const hasData = active().length > 0;
  const bar = COST_TYPES.filter(k => t.byType[k] > 0).map(k => `<span style="width:${(t.byType[k] / (t.upkeep || 1) * 100).toFixed(2)}%;background:${CATS[k].color}" title="${CATS[k].label}"></span>`).join('');

  const remHtml = rems.length ? rems.map(r => {
    const bits = [];
    if (r.remainKm !== null) bits.push(r.remainKm >= 0 ? `あと${num(r.remainKm)}km` : `${num(-r.remainKm)}km超過`);
    if (r.remainDays !== null) bits.push(r.remainDays >= 0 ? `あと${r.remainDays}日` : `${-r.remainDays}日超過`);
    const ic = r.status === 'over' ? 'ti-alert-triangle' : r.status === 'soon' ? 'ti-bell' : 'ti-circle-check';
    return `<div class="alert ${r.status}">${icon(ic)}<span>${h(r.rule.name)}：${bits.join(' / ')}</span></div>`;
  }).join('') : '<div class="tiny">メンテ記録が入ると次回の目安を表示します</div>';

  $main.innerHTML = `
    ${topbar('のりもの維持費')}
    <div class="quick">
      <button class="btn primary" data-act="receipt-camera">${icon('ti-camera')}レシートで給油登録</button>
      <button class="btn" data-act="add-fuel">${icon('ti-gas-station')}給油を手入力</button>
    </div>
    ${!hasData ? `<div class="card empty">${icon('ti-file-spreadsheet')}<p>まだ記録がありません</p>
      <div class="btn-row" style="justify-content:center"><button class="btn primary" data-act="import-xlsx">${icon('ti-upload')}Excelから取り込む</button>
      <button class="btn" data-act="add">${icon('ti-plus')}記録を追加</button></div></div>` : ''}
    <div class="grid-2"><div>
      <div class="card">
        <div class="h-row"><span class="muted">愛車に費やした総額</span><span class="tiny">ODO ${num(currentOdo())}km</span></div>
        <div class="big">${yen(t.grand)}</div>
        <div class="muted">ローン ${yen(t.loan)} ＋ 維持費 ${yen(t.upkeep)}</div>
        <div class="stack-bar">${bar}</div>
      </div>
      <div class="cat-grid">
        ${COST_TYPES.map(k => `<button class="cat-card" data-cat="${k}">
          <div class="lbl" style="color:${CATS[k].color}">${icon(CATS[k].icon)}<span style="color:var(--text2)">${CATS[k].label}</span></div>
          <div class="val">${yen(t.byType[k])}</div></button>`).join('')}
        <button class="cat-card" data-cat="plan">
          <div class="lbl" style="color:${CATS.plan.color}">${icon(CATS.plan.icon)}<span style="color:var(--text2)">カスタム計画（未購入）</span></div>
          <div class="val">${yen(t.plan)}</div></button>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="kpis">
          <div><div class="v">${fs.avgEconomy ? num(fs.avgEconomy, 1) : '—'}</div><div class="tiny">平均燃費 km/L</div></div>
          <div><div class="v">${cpk.fuel !== null ? '¥' + num(cpk.fuel, 1) : '—'}</div><div class="tiny">燃料費 /km</div></div>
          <div><div class="v">${cpk.upkeep !== null ? '¥' + num(cpk.upkeep, 1) : '—'}</div><div class="tiny">維持費 /km</div></div>
        </div>
        <div class="tiny" style="text-align:center;margin-top:6px">納車から ${num(Math.max(cpk.dist, 0))}km 走行</div>
      </div>
    </div><div>
      ${allVehiclesCard()}
      <div class="sec-title">次のメンテ目安</div>
      <div class="card">${remHtml}</div>
      <div class="sec-title h-row"><span>最近の記録</span><button class="btn" style="padding:3px 10px;font-size:12px" data-cat="all">すべて見る</button></div>
      ${recent.length ? recent.map(r => tlItem(r, fs)).join('') : '<div class="tiny" style="margin-left:4px">記録はまだありません</div>'}
    </div></div>`;
}

function allVehiclesCard() {
  const vs = vehicles();
  if (vs.length < 2) return '';
  const rows = vs.map(v => ({ v, t: totals(v.id) }));
  const sum = rows.reduce((a, r) => a + r.t.grand, 0);
  return `<div class="sec-title">全乗り物の合計</div><div class="card">
    ${rows.map(({ v, t }) => `<button class="veh-row ${v.id === state.vid ? 'active' : ''}" data-vid="${h(v.id)}">
      <span>${icon(v.kind === 'bike' ? 'ti-motorbike' : 'ti-car')} ${h(v.vehicleName)}</span>
      <span><b>${yen(t.grand)}</b><span class="tiny"> 維持費 ${yen(t.upkeep)}</span></span></button>`).join('')}
    <div class="h-row" style="margin-top:6px"><span class="muted">合計</span><b>${yen(sum)}</b></div></div>`;
}

// ---------- 記録（タブ＋タイムライン B） ----------
function renderRecords() {
  const fs = fuelStats();
  const tabs = [['all', 'すべて', 'ti-list'], ...Object.entries(CATS).map(([k, c]) => [k, c.short === '書類' ? '書類・保険' : c.label, c.icon])];
  let list = ui.cat === 'all' ? active().filter(r => r.type !== 'plan') : active(ui.cat);
  list = sortRecords(list);
  const total = list.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  // 月ごとにまとめる
  const groups = [];
  const idx = {};
  for (const r of list) {
    const key = ui.cat === 'plan' ? 'plan' : (r.date ? r.date.slice(0, 7) : 'none');
    if (!(key in idx)) { idx[key] = groups.length; groups.push({ key, items: [], sum: 0 }); }
    const g = groups[idx[key]]; g.items.push(r); g.sum += Number(r.amount) || 0;
  }
  groups.sort((a, b) => (a.key === 'none') - (b.key === 'none'));
  const label = k => k === 'none' ? '日付未設定' : k === 'plan' ? '欲しい物リスト' : `${k.slice(0, 4)}年${Number(k.slice(5, 7))}月`;

  let extra = '';
  if (ui.cat === 'fuel') {
    extra = `<div class="tiny">平均燃費 ${fs.avgEconomy ? num(fs.avgEconomy, 1) + 'km/L' : '—'} · 給油 ${list.length}回 · ${num(fs.totalLiters, 1)}L</div>`;
  }

  $main.innerHTML = `
    ${topbar('記録')}
    <div class="tabs" role="tablist">${tabs.map(([k, l, ic]) => `<button class="tab ${ui.cat === k ? 'active' : ''}" data-tab="${k}" role="tab">${icon(ic)}${l}</button>`).join('')}</div>
    <div class="tab-summary"><span class="muted">${list.length}件</span><span style="font-weight:700;font-size:18px">${yen(total)}</span></div>
    ${extra}
    ${groups.length ? groups.map(g => `<div class="month"><span>${label(g.key)}</span><span>${yen(g.sum)}</span></div>${g.items.map(r => tlItem(r, fs)).join('')}`).join('')
      : `<div class="empty">${icon(ui.cat === 'all' ? 'ti-list' : CATS[ui.cat].icon)}<p>${ui.cat === 'all' ? '記録' : CATS[ui.cat].label}はまだありません</p><button class="btn primary" data-act="add">${icon('ti-plus')}追加する</button></div>`}
  `;
  const at = $main.querySelector('.tab.active');
  if (at) at.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------- 集計 ----------
function barChart(months, data) {
  const W = 640, H = 210, L = 44, B = 22, T = 10;
  const totalsArr = months.map(m => COST_TYPES.reduce((a, k) => a + (data[m]?.[k] || 0), 0));
  const max = Math.max(1, ...totalsArr);
  const step = (W - L - 6) / Math.max(1, months.length);
  const bw = Math.min(28, step * 0.7);
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="月別の維持費">`;
  for (let i = 0; i <= 4; i++) {
    const y = T + (H - T - B) * (1 - i / 4);
    svg += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity=".1"/><text x="${L - 4}" y="${y + 3}" text-anchor="end">${Math.round(nice * i / 4 / 1000)}k</text>`;
  }
  months.forEach((m, i) => {
    const x = L + step * i + (step - bw) / 2;
    let y = H - B;
    for (const k of COST_TYPES) {
      const v = data[m]?.[k] || 0;
      if (!v) continue;
      const hgt = (H - T - B) * v / nice;
      y -= hgt;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${hgt}" fill="${CATS[k].color}"><title>${m} ${CATS[k].label} ${yen(v)}</title></rect>`;
    }
    const lbl = months.length > 14 ? (m.endsWith('-01') || i === 0 ? m.slice(2, 4) + '/' + Number(m.slice(5)) : '') : Number(m.slice(5)) + '月';
    svg += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${lbl}</text>`;
  });
  return svg + '</svg>';
}

function lineChart(points, unit) {
  if (points.length < 2) return '<div class="tiny">満タン給油が2回以上で表示します</div>';
  const W = 640, H = 170, L = 40, B = 22, T = 12;
  const ys = points.map(p => p.y);
  let min = Math.floor(Math.min(...ys) - 1), max = Math.ceil(Math.max(...ys) + 1);
  const sx = i => L + (W - L - 10) * (points.length === 1 ? 0.5 : i / (points.length - 1));
  const sy = v => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="燃費の推移">`;
  for (let i = 0; i <= 3; i++) {
    const v = min + (max - min) * i / 3;
    svg += `<line x1="${L}" x2="${W}" y1="${sy(v)}" y2="${sy(v)}" stroke="currentColor" stroke-opacity=".1"/><text x="${L - 4}" y="${sy(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  svg += `<polyline fill="none" stroke="#1D9E75" stroke-width="2" points="${points.map((p, i) => `${sx(i)},${sy(p.y)}`).join(' ')}"/>`;
  points.forEach((p, i) => {
    svg += `<circle cx="${sx(i)}" cy="${sy(p.y)}" r="3.5" fill="#1D9E75"><title>${p.label} ${p.y.toFixed(1)}${unit}</title></circle>`;
    if (points.length <= 16 || i % Math.ceil(points.length / 12) === 0) svg += `<text x="${sx(i)}" y="${H - 6}" text-anchor="middle">${h(p.label)}</text>`;
  });
  return svg + '</svg>';
}

function renderStats() {
  const mon = monthly();
  const yr = yearly();
  const years = Object.keys(yr).filter(y => y !== '日付なし').sort();
  if (ui.statsYear !== 'all' && !years.includes(ui.statsYear)) ui.statsYear = 'all';
  let months;
  if (ui.statsYear === 'all') {
    const keys = Object.keys(mon).sort();
    months = [];
    if (keys.length) {
      let [y, m] = keys[0].split('-').map(Number);
      const [ey, em] = keys[keys.length - 1].split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) { months.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
    }
  } else {
    months = Array.from({ length: 12 }, (_, i) => `${ui.statsYear}-${String(i + 1).padStart(2, '0')}`);
  }
  const fs = fuelStats();
  const ecoPts = fs.ordered.filter(r => fs.per[r.id]?.economy).map(r => ({ y: fs.per[r.id].economy, label: md(r.date) }));
  const pricePts = fs.ordered.filter(r => fs.per[r.id]?.unit).map(r => ({ y: fs.per[r.id].unit, label: md(r.date) }));
  const yearKeys = Object.keys(yr).sort((a, b) => (a === '日付なし') - (b === '日付なし') || a.localeCompare(b));
  const sumRow = k => yearKeys.reduce((a, y) => a + yr[y][k], 0);

  $main.innerHTML = `
    ${topbar('集計')}
    <div class="tabs">${['all', ...years].map(y => `<button class="tab ${ui.statsYear === y ? 'active' : ''}" data-year="${y}">${y === 'all' ? '全期間' : y + '年'}</button>`).join('')}</div>
    <div class="card"><div class="h-row"><span class="muted">月別の維持費</span><span class="tiny">日付のある記録のみ</span></div>
      ${months.length ? barChart(months, mon) : '<div class="tiny">データがありません</div>'}
      <div class="legend">${COST_TYPES.map(k => `<span style="--c:${CATS[k].color}">${CATS[k].label}</span>`).join('')}</div></div>
    <div class="card"><div class="muted" style="margin-bottom:6px">年別・カテゴリ別</div><div class="scroll-x"><table class="t">
      <tr><th>カテゴリ</th>${yearKeys.map(y => `<th>${h(y)}</th>`).join('')}<th>合計</th></tr>
      ${COST_TYPES.map(k => `<tr><td>${CATS[k].label}</td>${yearKeys.map(y => `<td>${yen(yr[y][k])}</td>`).join('')}<td>${yen(sumRow(k))}</td></tr>`).join('')}
      <tr><th>計</th>${yearKeys.map(y => `<th>${yen(COST_TYPES.reduce((a, k) => a + yr[y][k], 0))}</th>`).join('')}<th>${yen(COST_TYPES.reduce((a, k) => a + sumRow(k), 0))}</th></tr>
    </table></div></div>
    <div class="grid-2">
      <div class="card"><div class="h-row"><span class="muted">燃費の推移（満タン法）</span><span class="tiny">平均 ${fs.avgEconomy ? num(fs.avgEconomy, 1) : '—'} km/L</span></div>${lineChart(ecoPts, 'km/L')}</div>
      <div class="card"><div class="muted">ガソリン単価の推移（¥/L）</div>${lineChart(pricePts, '円/L')}</div>
    </div>`;
}

// ---------- 設定 ----------
function renderSettings() {
  const s = settings();
  const sy = state.sync;
  const last = sy.lastSyncAt ? new Date(sy.lastSyncAt).toLocaleString('ja-JP') : '未同期';
  $main.innerHTML = `
    ${topbar('設定')}
    <div class="sec-title">乗り物の設定（${h(s.vehicleName)}）</div>
    <div class="card" data-form="vehicle">
      <div class="two"><div class="field"><label>名前</label><input name="vehicleName" value="${h(s.vehicleName)}"></div>
      <div class="field"><label>種類</label><select name="kind"><option value="car" ${s.kind !== 'bike' ? 'selected' : ''}>車</option><option value="bike" ${s.kind === 'bike' ? 'selected' : ''}>バイク</option></select></div></div>
      <div class="two"><div class="field"><label>納車時の走行距離 (km)</label><input name="deliveryOdo" inputmode="numeric" value="${h(s.deliveryOdo)}"></div>
      <div class="field"><label>納車日</label><input name="deliveryDate" type="date" value="${h(s.deliveryDate)}"></div></div>
      <div class="two"><div class="field"><label>車両のみ支払総額（総額に加算）</label><input name="loanPaid" inputmode="numeric" value="${h(s.loanPaid)}"></div>
      <div class="field"><label>車両購入費用（参考）</label><input name="purchaseCost" inputmode="numeric" value="${h(s.purchaseCost)}"></div></div>
      <div class="btn-row"><button class="btn" data-act="add-vehicle">${icon('ti-plus')}乗り物を追加</button>
      ${vehicles().length > 1 ? `<button class="btn danger" data-act="delete-vehicle">${icon('ti-trash')}この乗り物を削除</button>` : ''}</div>
    </div>

    <div class="sec-title">メンテ時期のお知らせ</div>
    <div class="card">
      <div class="rem-row tiny"><span>表示名</span><span>記録名に含む語</span><span>km毎</span><span>か月毎</span><span></span></div>
      <div id="rems">${(s.reminders || []).map((r, i) => `<div class="rem-row" data-i="${i}">
        <input data-k="name" value="${h(r.name)}"><input data-k="keyword" value="${h(r.keyword)}">
        <input data-k="km" inputmode="numeric" value="${h(r.km || '')}"><input data-k="months" inputmode="numeric" value="${h(r.months || '')}">
        <button data-act="rem-del" aria-label="削除">${icon('ti-x')}</button></div>`).join('')}</div>
      <button class="btn" data-act="rem-add">${icon('ti-plus')}追加</button>
      <div class="tiny" style="margin-top:6px">「記録名に含む語」は | 区切りで複数指定できます（例: オイル交換|オイル・フィルター）</div>
    </div>

    <div class="sec-title">クラウド同期（Google スプレッドシート）</div>
    <div class="card" data-form="sync">
      <div class="field"><label>Apps Script の Web アプリ URL</label><input name="url" placeholder="https://script.google.com/macros/s/…/exec" value="${h(sy.url)}" autocomplete="off"></div>
      <div class="field"><label>合言葉（トークン）</label><div class="with-btn"><input name="token" value="${h(sy.token)}" autocomplete="off"><button data-act="gen-token" title="ランダム生成" aria-label="ランダム生成">${icon('ti-dice-5')}</button></div></div>
      <div class="h-row"><span class="tiny">最終同期: ${h(last)}${sy.status === 'error' ? `<br><span style="color:var(--danger-text)">${h(sy.error)}</span>` : ''}</span>
        <button class="btn primary" data-act="sync">${icon('ti-refresh')}今すぐ同期</button></div>
      <div class="tiny" style="margin-top:8px">設定方法はリポジトリの SETUP.md を参照。PC と iPhone で同じ URL と合言葉を入れると、記録が自動で揃います。</div>
    </div>

    <div class="sec-title">データ</div>
    <div class="card">
      <div class="btn-row">
        <button class="btn" data-act="import-xlsx">${icon('ti-file-import')}Excel 取り込み</button>
        <button class="btn" data-act="export-xlsx">${icon('ti-file-export')}Excel 書き出し</button>
        <button class="btn" data-act="export-json">${icon('ti-download')}バックアップ</button>
        <button class="btn" data-act="import-json">${icon('ti-upload')}バックアップから復元</button>
      </div>
      <div class="tiny" style="margin-top:8px">Excel の取り込み・書き出しは表示中の乗り物（${h(s.vehicleName)}）が対象です。ファイルは画面にドラッグ＆ドロップでも取り込めます。</div>
      <div class="tiny" style="margin-top:4px">${h(s.vehicleName)} の記録 ${active().length}件 / 全体 ${active(null, '*').length}件 · v${APP_VERSION}</div>
    </div>`;
}

// ---------- 入力フォーム ----------
function openForm(type, rec = null, opts = {}) {
  if (formCleanup) { const c = formCleanup; formCleanup = null; c(); }
  const isNew = !rec;
  const r = rec ? JSON.parse(JSON.stringify(rec)) : newRecord(type, opts.prefill || {});
  if (isNew && ['fuel', 'maint', 'custom', 'doc', 'coating'].includes(type) && !r.date) r.date = today();
  const s = settings();
  const fs = fuelStats();

  const amountField = (label = '金額（円）') => `<div class="field"><label>${label}</label><div class="with-btn">
    <input name="amount" inputmode="decimal" placeholder="例: 13800+1290" value="${h(r.extra?.expr || (r.amount || r.amount === 0 && !isNew ? r.amount : ''))}">
    <button type="button" data-act="plus" aria-label="＋を入力">＋</button></div><div class="err" data-err="amount"></div></div>`;
  const dateField = (label = '日付') => `<div class="field"><label>${label}</label><input name="date" type="date" value="${h(r.date)}"><div class="err" data-err="date"></div></div>`;
  const odoField = () => `<div class="field"><label>走行距離 ODO (km)</label><input name="odo" inputmode="numeric" placeholder="${num(currentOdo())}" value="${h(r.odo ?? '')}"><div class="err" data-err="odo"></div></div>`;
  const noteField = () => `<div class="field"><label>備考</label><textarea name="note">${h(r.note)}</textarea></div>`;
  const titleField = (label, list) => `<div class="field"><label>${label}</label><input name="title" value="${h(r.title)}" ${list ? 'list="presets"' : ''}>
    ${list ? `<datalist id="presets">${list.map(p => `<option value="${h(p)}">`).join('')}</datalist>` : ''}<div class="err" data-err="title"></div></div>`;

  const bodies = {
    fuel: () => `<div class="receipt-box" id="receipt-box">
        <div class="btn-row">
          <label class="btn primary">${icon('ti-camera')}レシートを撮影<input type="file" accept="image/*" capture="environment" data-receipt hidden></label>
          <label class="btn">${icon('ti-photo')}写真から選ぶ<input type="file" accept="image/*" data-receipt hidden></label>
        </div>
        <div class="tiny" id="receipt-status">金額・給油量・日付を自動で入力します（PC は画像をここへドロップ）</div>
      </div>
      <div class="two">${dateField('給油日')}${odoField()}</div>
      <div class="two">${amountField('金額（円）')}<div class="field"><label>給油量 (L)</label><input name="liters" inputmode="decimal" value="${h(r.liters ?? '')}"><div class="err" data-err="liters"></div></div></div>
      <label class="check"><input type="checkbox" name="full" ${r.full !== false ? 'checked' : ''}>満タン給油（燃費計算に使う）</label>
      <div class="calc-preview" id="fuel-preview"></div>${noteField()}`,
    maint: () => `<div class="receipt-box" id="doc-box">
        <div class="btn-row">
          <label class="btn primary">${icon('ti-camera')}整備記録を撮影<input type="file" accept="image/*" capture="environment" data-doc hidden></label>
          <label class="btn">${icon('ti-file-search')}PDF・写真から読み取る<input type="file" accept="application/pdf,image/*" data-doc hidden></label>
        </div>
        <div class="tiny" id="doc-status">ディーラーの整備記録・請求書から 日付・走行距離・金額・作業内容 を読み取り、ファイルも添付します（PC はここへドロップ）</div>
      </div>
      ${titleField('実施項目', [...new Set([...(s.maintPresets || []), ...active('maint').map(x => x.title)])])}
      <div class="two">${dateField('実施日')}${odoField()}</div>${amountField('費用（円）')}${noteField()}`,
    custom: () => `${titleField('商品名')}<div class="two">${dateField('購入日')}${amountField()}</div>${noteField()}`,
    doc: () => `${titleField('品名', ['任意保険', '自動車税', '車検', '重量税', '自賠責保険', '駐車場使用承諾書', '印鑑登録費用', '印鑑登録証発行費用'])}
      <div class="field"><label>区分・メモ（等級など）</label><input name="group" value="${h(r.group)}"></div>
      <div class="two">${dateField()}${amountField()}</div>${noteField()}`,
    coating: () => `${titleField('内容')}<div class="two">${dateField('施工日')}${amountField()}</div>${noteField()}`,
    plan: () => `${titleField('名称')}<div class="two"><div class="field"><label>ジャンル</label><input name="genre" value="${h(r.extra?.genre)}"></div>
      <div class="field"><label>メーカー名</label><input name="maker" value="${h(r.extra?.maker)}"></div></div>
      ${amountField('価格（円）')}<div class="field"><label>リンク</label><input name="link" type="url" value="${h(r.extra?.link)}"></div>${noteField()}`,
  };

  $sheet.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <h2>${isNew ? '記録を追加' : CATS[type].label + 'を編集'}</h2>
    ${isNew && !opts.lockType ? `<div class="seg">${Object.entries(CATS).map(([k, c]) => `<button type="button" style="--c:${c.color}" class="${k === type ? 'active' : ''}" data-type="${k}">${icon(c.icon)}${c.short}</button>`).join('')}</div>` : ''}
    <form id="rec-form" novalidate>${bodies[type]()}
      ${type !== 'plan' ? `<div class="field"><label>添付（PDF・写真）</label>
        <div class="att-list" id="att-list"></div>
        <div class="btn-row">
          <label class="btn">${icon('ti-paperclip')}ファイルを添付<input type="file" accept="application/pdf,image/*" multiple data-attach hidden></label>
          <label class="btn">${icon('ti-camera')}撮影して添付<input type="file" accept="image/*" capture="environment" data-attach hidden></label>
        </div><div class="err" data-err="files"></div></div>` : ''}
      <div class="btn-row" style="margin-top:6px">
        ${!isNew ? `<button type="button" class="btn danger" data-act="delete">${icon('ti-trash')}削除</button>` : ''}
        <span style="flex:1"></span>
        <button type="button" class="btn" data-act="close">キャンセル</button>
        <button type="submit" class="btn primary">${icon('ti-check')}保存</button>
      </div>
    </form></div>`;
  $sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  const form = $sheet.querySelector('#rec-form');

  const updatePreview = () => {
    const p = $sheet.querySelector('#fuel-preview');
    if (!p) return;
    const amt = evalAmount(form.amount.value).value;
    const lit = Number(form.liters.value);
    const odo = Number(form.odo.value);
    const bits = [];
    if (amt && lit) bits.push(`単価 ¥${num(amt / lit, 1)}/L`);
    const prevFull = fs.ordered.filter(x => x.id !== r.id && x.full !== false && x.odo < odo).pop();
    if (prevFull && odo && lit && form.full.checked) {
      const between = fs.ordered.filter(x => x.id !== r.id && x.odo > prevFull.odo && x.odo < odo).reduce((a, x) => a + (Number(x.liters) || 0), 0);
      bits.push(`燃費 ${num((odo - prevFull.odo) / (lit + between), 1)}km/L（前回満タンから${num(odo - prevFull.odo)}km）`);
    }
    p.textContent = bits.length ? bits.join(' · ') : 'ODO・金額・給油量を入れると単価と燃費を自動計算します';
  };
  const runReceipt = async file => {
    const st = $sheet.querySelector('#receipt-status');
    if (!st || !file) return;
    const box = $sheet.querySelector('#receipt-box');
    box.classList.add('busy');
    st.textContent = '読み取り中…（初回は部品のダウンロードに少し時間がかかります）';
    try {
      const res = await readReceipt(file, p => { st.textContent = `読み取り中… ${p}%`; });
      const got = [];
      if (res.amount) { form.amount.value = res.amount; got.push(`金額 ${yen(res.amount)}`); }
      if (res.liters) { form.liters.value = res.liters; got.push(`給油量 ${res.liters}L`); }
      if (res.date) { form.date.value = res.date; got.push(`日付 ${res.date}`); }
      if (res.unit) got.push(`単価 ¥${res.unit}/L`);
      st.innerHTML = got.length
        ? `${icon('ti-check')} ${h(got.join(' · '))}<br><span class="${res.consistent ? '' : 'warn-text'}">${res.consistent ? '金額＝給油量×単価で検算OK。' : '数字を確認してください。'}ODO は手入力してください。</span>`
        : `<span class="warn-text">読み取れませんでした。レシート全体を明るく正面から撮り直すか、手入力してください。</span>`;
      st.title = res.text;
      updatePreview();
      if (!form.odo.value) form.odo.focus();
    } catch (err) {
      console.error(err);
      st.innerHTML = `<span class="warn-text">${h(err.message)}</span>`;
    } finally { box.classList.remove('busy'); }
  };
  $sheet.querySelectorAll('[data-receipt]').forEach(inp => inp.addEventListener('change', () => { runReceipt(inp.files[0]); inp.value = ''; }));

  // ---- 添付 ----
  const origFiles = [...(r.extra?.files || [])];
  let att = [...origFiles];
  const added = [];          // このフォームで追加した分（キャンセル時に端末から消す）
  let saved = false;
  let closed = false;
  let storing = 0;           // 保存処理中のファイル数
  const thumbUrls = [];
  const renderAtt = async () => {
    const box = $sheet.querySelector('#att-list');
    if (!box) return;
    box.innerHTML = att.map(f => `<div class="att" data-file="${h(f.id)}">
      <button type="button" class="att-open" data-act="open-file" data-id="${h(f.id)}" title="開く">
        ${f.mime?.startsWith('image/') ? `<img alt="" data-thumb="${h(f.id)}">` : icon(f.mime === 'application/pdf' ? 'ti-file-type-pdf' : 'ti-file')}
        <span><span class="att-name">${h(f.name)}</span><span class="tiny">${fmtSize(f.size || 0)}${f.driveId ? ' · ドライブ保存済' : ''}</span></span>
      </button>
      <button type="button" class="att-del" data-act="del-file" data-id="${h(f.id)}" aria-label="添付を外す">${icon('ti-x')}</button></div>`).join('');
    for (const img of box.querySelectorAll('img[data-thumb]')) {
      const blob = await getBlob(img.dataset.thumb).catch(() => null);
      if (blob) { const u = URL.createObjectURL(blob); thumbUrls.push(u); img.src = u; } else img.replaceWith(Object.assign(document.createElement('i'), { className: 'ti ti-photo' }));
    }
  };
  const addFiles = async files => {
    const errEl = $sheet.querySelector('[data-err=files]');
    if (errEl) errEl.textContent = '';
    const metas = [];
    for (const file of files) {
      storing++;
      try {
        const m = await storeFile(file);
        if (closed) { if (!saved) delBlob(m.id).catch(() => {}); continue; }   // 保存中にフォームが閉じられた
        added.push(m); att.push(m); metas.push(m);
      } catch (err) { if (errEl) errEl.textContent = err.message; }
      finally { storing--; }
    }
    renderAtt();
    return metas;
  };
  $sheet.querySelectorAll('[data-attach]').forEach(inp => inp.addEventListener('change', () => { addFiles([...inp.files]); inp.value = ''; }));
  renderAtt();

  // ---- 整備記録の読み取り（メンテ） ----
  const runDoc = async file => {
    const st = $sheet.querySelector('#doc-status');
    if (!st || !file) return;
    const box = $sheet.querySelector('#doc-box');
    box.classList.add('busy');
    st.textContent = '読み取り中…（初回は部品のダウンロードに少し時間がかかります）';
    addFiles([file]);
    try {
      const res = await readMaintDoc(file, s.maintPresets || [], p => { st.textContent = `読み取り中… ${p}%`; });
      const got = [];
      if (res.title && !form.title.value.trim()) form.title.value = res.title;
      if (res.items.length) got.push(`作業 ${res.items.map(i => i.name).join('・')}`);
      if (res.date) { form.date.value = res.date; got.push(`日付 ${res.date}`); }
      if (res.odo) { form.odo.value = res.odo; got.push(`走行 ${num(res.odo)}km`); }
      if (res.amount) { form.amount.value = res.amount; got.push(`合計 ${yen(res.amount)}`); }
      const detail = res.items.filter(i => i.amount).map(i => `${i.name} ${yen(i.amount)}`);
      if (detail.length && !form.note.value.includes(detail[0])) form.note.value = [form.note.value.trim(), '【整備記録より】' + detail.join(' / ')].filter(Boolean).join('\n');
      st.innerHTML = got.length
        ? `${icon('ti-check')} ${h(got.join(' · '))}<br><span class="warn-text">内容を確認してから保存してください。</span>`
        : `<span class="warn-text">読み取れる項目がありませんでした（ファイルは添付済み）。手入力してください。</span>`;
      st.title = res.text;
    } catch (err) {
      console.error(err);
      st.innerHTML = `<span class="warn-text">${h(err.message)}（ファイルは添付済み）</span>`;
    } finally { box.classList.remove('busy'); }
  };
  $sheet.querySelectorAll('[data-doc]').forEach(inp => inp.addEventListener('change', () => { runDoc(inp.files[0]); inp.value = ''; }));
  if (opts.docFile) runDoc(opts.docFile);

  formReceiptHandler = type === 'fuel' ? runReceipt : null;
  formFileHandler = type === 'plan' ? null : file => {
    if (type === 'fuel' && isImage(file)) return runReceipt(file);
    if (type === 'maint') return runDoc(file);
    return addFiles([file]).then(m => { if (m.length) toast('添付しました'); });
  };
  formCleanup = () => {
    closed = true;
    thumbUrls.forEach(u => URL.revokeObjectURL(u));
    if (!saved) added.forEach(f => delBlob(f.id).catch(() => {}));
  };
  if (opts.receiptFile) runReceipt(opts.receiptFile);
  if (opts.openCamera) setTimeout(() => $sheet.querySelector('[data-receipt][capture]')?.click(), 0);

  form.addEventListener('input', e => {
    const err = $sheet.querySelector(`[data-err="${e.target.name}"]`);
    if (err) err.textContent = '';
    updatePreview();
  });
  updatePreview();

  $sheet.onclick = e => {
    if (e.target === $sheet) return closeForm();
    const t = e.target.closest('[data-type],[data-act]');
    if (!t) return;
    if (t.dataset.type) {
      const keep = { title: form.title?.value, date: form.date?.value, note: form.note?.value };
      const amt = evalAmount(form.amount?.value);
      return openForm(t.dataset.type, null, { prefill: { ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v)), ...(Number.isFinite(amt.value) && amt.value ? { amount: amt.value } : {}) } });
    }
    if (t.dataset.act === 'close') return closeForm();
    if (t.dataset.act === 'plus') { form.amount.value += '+'; form.amount.focus(); return; }
    if (t.dataset.act === 'open-file') { const f = att.find(x => x.id === t.dataset.id); if (f) openAttachment(f); return; }
    if (t.dataset.act === 'del-file') {
      const f = att.find(x => x.id === t.dataset.id);
      if (f && confirm(`添付「${f.name}」を外しますか？（保存すると削除されます）`)) { att = att.filter(x => x !== f); renderAtt(); }
      return;
    }
    if (t.dataset.act === 'delete') {
      if (confirm(`「${r.title || CATS[type].label}」を削除しますか？${origFiles.length ? '\n添付ファイルも削除されます。' : ''}`)) {
        remove(r.id); discardFiles([...origFiles, ...added]); saved = true; closeForm(); changed(); toast('削除しました');
      }
    }
  };

  form.onsubmit = e => {
    e.preventDefault();
    const err = (k, m) => { const el = $sheet.querySelector(`[data-err="${k}"]`); if (el) el.textContent = m; return false; };
    let ok = true;
    const amt = evalAmount(form.amount.value);
    if (Number.isNaN(amt.value)) ok = err('amount', '数字か計算式（例: 13800+1290）で入力してください');
    const out = { ...r, type, amount: Number.isNaN(amt.value) ? 0 : amt.value, note: form.note?.value.trim() ?? '', extra: { ...(r.extra || {}) } };
    if (amt.expr) out.extra.expr = amt.expr; else delete out.extra.expr;
    if (form.title) { out.title = form.title.value.trim(); if (!out.title) ok = err('title', '名前を入力してください'); }
    if (form.date) out.date = form.date.value;
    if (form.group) out.group = form.group.value.trim();
    if (form.odo) {
      const v = form.odo.value.replace(/[,\s]/g, '');
      out.odo = v ? Number(v) : null;
      if (v && !Number.isFinite(out.odo)) ok = err('odo', '数字で入力してください');
    }
    if (type === 'fuel') {
      out.title = '給油';
      out.liters = form.liters.value ? Number(form.liters.value) : null;
      out.full = form.full.checked;
      if (!out.date) ok = err('date', '給油日を入力してください');
      if (!out.odo) ok = err('odo', 'ODO を入力してください（距離・燃費の計算に使います）');
      if (!out.liters || !Number.isFinite(out.liters)) ok = err('liters', '給油量を入力してください');
    }
    if (type === 'plan') Object.assign(out.extra, { genre: form.genre.value.trim(), maker: form.maker.value.trim(), link: form.link.value.trim() });
    if (storing) ok = err('files', '添付ファイルを保存中です。少し待ってからもう一度「保存」を押してください');
    if (!ok) return;
    if (att.length) out.extra.files = att; else delete out.extra.files;
    discardFiles([...origFiles, ...added].filter(f => !att.includes(f)));
    saved = true;
    upsert(out);
    if (opts.fromPlan) remove(opts.fromPlan);
    closeForm();
    if (isNew && ui.view !== 'home') { ui.view = 'records'; ui.cat = type; }
    changed();
    toast(isNew ? '保存しました' : '更新しました');
  };
  setTimeout(() => { const f = form.querySelector(type === 'fuel' ? '[name=odo]' : '[name=title]'); if (f && isNew && window.innerWidth > 700) f.focus(); }, 50);
}
let formReceiptHandler = null;
let formFileHandler = null;
let formCleanup = null;
function closeForm() {
  formReceiptHandler = null; formFileHandler = null;
  if (formCleanup) { const c = formCleanup; formCleanup = null; c(); }
  $sheet.hidden = true; $sheet.innerHTML = ''; document.body.style.overflow = '';
}

// 添付を開く（写真はアプリ内で表示、PDF は新しいタブ）
async function openAttachment(f) {
  let blob;
  try { toast('開いています…', 1500); blob = await loadFile(f); }
  catch (err) { alert(err.message); return; }
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  if ((f.mime || blob.type).startsWith('image/')) {
    const v = document.createElement('div');
    v.className = 'viewer';
    v.innerHTML = `<img src="${url}" alt="${h(f.name)}"><div class="viewer-bar"><span>${h(f.name)}</span>
      <a class="btn" href="${url}" download="${h(f.name)}">${icon('ti-download')}保存</a><button class="btn" type="button">${icon('ti-x')}閉じる</button></div>`;
    v.addEventListener('click', e => { if (!e.target.closest('a')) v.remove(); });
    document.body.appendChild(v);
    return;
  }
  const w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$sheet.hidden) closeForm(); });

// ---------- 画面上の操作 ----------
function pickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

async function importXlsx(file) {
  const f = file || await pickFile('.xlsx,.xlsm');
  if (!f) return;
  const vname = settings().vehicleName;
  try {
    const res = await parseWorkbook(await f.arrayBuffer());
    const counts = Object.entries(CATS).map(([k, c]) => [c.label, res.records.filter(r => r.type === k).length]).filter(([, n]) => n).map(([l, n]) => `${l} ${n}件`).join('、');
    const sum = res.records.filter(r => COST_TYPES.includes(r.type)).reduce((a, r) => a + r.amount, 0);
    let msg = `取り込み先: ${vname}\n取り込み内容: ${counts || 'なし'}\n維持費合計 ${yen(sum)}${res.patch.loanPaid !== undefined ? ` / 車両支払総額 ${yen(res.patch.loanPaid)}` : ''}`;
    if (res.warnings.length) msg += '\n注意: ' + res.warnings.join(' / ');
    let replace = false;
    if (active().length) {
      if (!confirm(msg + `\n\n${vname} の今ある記録 ${active().length}件を、取り込む内容で置き換えますか？\n（他の乗り物の記録はそのまま。キャンセルで中止）`)) return;
      replace = true;
    } else if (!confirm(msg + '\n\n取り込みますか？')) return;
    applyImport(res, replace);
    changed();
    toast(`${res.records.length}件を取り込みました`);
  } catch (e) { console.error(e); alert('取り込めませんでした: ' + e.message); }
}

$main.addEventListener('click', async e => {
  if (e.target.closest('[data-stop]')) { e.stopPropagation(); return; }
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'bought') {
      e.stopPropagation();
      const p = state.records.find(x => x.id === act.dataset.id);
      openForm('custom', null, { lockType: true, fromPlan: p.id, prefill: { title: p.title, amount: p.amount, note: [p.extra?.maker, p.note].filter(Boolean).join(' / ') } });
      return;
    }
    if (a === 'add') return openForm(ui.view === 'records' && ui.cat !== 'all' ? ui.cat : 'fuel');
    if (a === 'to-settings') return go('settings');
    if (a === 'sync') {
      if (!syncConfigured()) return go('settings');
      try { const r = await syncNow(); fixCurrentVid(); render(); toast(`同期しました（送信${r.pushed}件・更新${r.pulled}件）`); } catch (err) { render(); toast(state.sync.error, 4000); }
      return;
    }
    if (a === 'import-xlsx') return importXlsx();
    if (a === 'receipt-camera') return openForm('fuel', null, { lockType: true, openCamera: true });
    if (a === 'add-fuel') return openForm('fuel', null, { lockType: true });
    if (a === 'add-vehicle') return openVehicleForm();
    if (a === 'delete-vehicle') {
      const s = settings();
      const n = active().length;
      if (!confirm(`「${s.vehicleName}」と、その記録 ${n}件を削除しますか？\n（他の端末からも消えます。元に戻せません）`)) return;
      deleteVehicle(state.vid); changed(); toast('削除しました'); return;
    }
    if (a === 'export-xlsx') { try { await exportWorkbook(); } catch (err) { alert(err.message); } return; }
    if (a === 'export-json') return exportJSON();
    if (a === 'import-json') {
      const f = await pickFile('.json,application/json');
      if (!f) return;
      if (!confirm('今の記録をバックアップの内容で置き換えますか？')) return;
      try { importJSON(await f.text()); changed(); toast('復元しました'); } catch (err) { alert('復元できませんでした: ' + err.message); }
      return;
    }
    if (a === 'gen-token') {
      const t = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('');
      const inp = $main.querySelector('[data-form="sync"] [name="token"]');
      inp.value = t; inp.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (a === 'rem-add') { const s = settings(); updateSettings({ reminders: [...s.reminders, { name: '', keyword: '', km: 0, months: 0 }] }); changed(); return; }
    if (a === 'rem-del') { const i = Number(act.closest('.rem-row').dataset.i); const s = settings(); updateSettings({ reminders: s.reminders.filter((_, j) => j !== i) }); changed(); return; }
  }
  const vt = e.target.closest('[data-vid]');
  if (vt) { setVehicle(vt.dataset.vid); render(); return; }
  const cat = e.target.closest('[data-cat]');
  if (cat) return go('records', { cat: cat.dataset.cat });
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.cat = tab.dataset.tab; go('records'); return; }
  const yr = e.target.closest('[data-year]');
  if (yr) { ui.statsYear = yr.dataset.year; render(); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { const r = state.records.find(x => x.id === ed.dataset.edit); if (r) openForm(r.type, r); }
});

$main.addEventListener('change', e => {
  const vf = e.target.closest('[data-form="vehicle"]');
  if (vf) {
    const k = e.target.name;
    const numeric = ['deliveryOdo', 'loanPaid', 'purchaseCost'];
    let v = e.target.value;
    if (numeric.includes(k)) { v = evalAmount(v).value; if (Number.isNaN(v)) { toast('数字で入力してください'); return; } }
    const patch = { [k]: v };
    if (k === 'kind' && active('maint').length === 0) Object.assign(patch, { reminders: remindersForKind(v), maintPresets: presetsForKind(v) });
    updateSettings(patch); scheduleSync(); toast('保存しました', 1200);
    if (k === 'vehicleName' || k === 'kind') render();
    return;
  }
  const rr = e.target.closest('.rem-row');
  if (rr) {
    const s = settings();
    const list = s.reminders.map(x => ({ ...x }));
    const i = Number(rr.dataset.i), k = e.target.dataset.k;
    list[i][k] = (k === 'km' || k === 'months') ? (Number(e.target.value) || 0) : e.target.value;
    updateSettings({ reminders: list }); scheduleSync();
    return;
  }
  const sf = e.target.closest('[data-form="sync"]');
  if (sf) {
    const url = sf.querySelector('[name=url]').value.trim();
    const token = sf.querySelector('[name=token]').value.trim();
    const changedConf = url !== state.sync.url || token !== state.sync.token;
    state.sync.url = url; state.sync.token = token;
    if (changedConf) state.sync.lastPush = 0; // 接続先が変わったら全件送り直す
    saveSync();
  }
});

// ---------- 乗り物の追加 ----------
function openVehicleForm() {
  $sheet.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h2>乗り物を追加</h2>
    <form id="veh-form" novalidate>
      <div class="field"><label>名前</label><input name="name" placeholder="例: FL5 シビック"><div class="err" data-err="name"></div></div>
      <div class="field"><label>種類</label><select name="kind"><option value="car">車</option><option value="bike">バイク</option></select></div>
      <div class="field"><label>納車時の走行距離 (km)</label><input name="odo" inputmode="numeric" placeholder="0"></div>
      <div class="btn-row"><span style="flex:1"></span><button type="button" class="btn" data-act="close">キャンセル</button>
      <button type="submit" class="btn primary">${icon('ti-check')}追加</button></div></form></div>`;
  $sheet.hidden = false;
  const f = $sheet.querySelector('#veh-form');
  $sheet.onclick = e => { if (e.target === $sheet || e.target.closest('[data-act=close]')) closeForm(); };
  f.oninput = () => { $sheet.querySelector('[data-err=name]').textContent = ''; };
  f.onsubmit = e => {
    e.preventDefault();
    const name = f.elements.name.value.trim();
    if (!name) { $sheet.querySelector('[data-err=name]').textContent = '名前を入力してください'; return; }
    const id = addVehicle(name, f.elements.kind.value);
    setVehicle(id);
    const odo = Number(String(f.elements.odo.value).replace(/[,\s]/g, ''));
    if (odo) updateSettings({ deliveryOdo: odo }, id);
    closeForm(); changed(); toast(`${name} を追加しました`);
  };
  setTimeout(() => f.elements.name.focus(), 50);
}

// ---------- ドラッグ＆ドロップ ----------
const $drop = document.getElementById('drop');
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $drop.hidden = false; });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $drop.hidden = true; });
window.addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $drop.hidden = true;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  await handleFile(file);
});
async function handleFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm)$/.test(name)) { closeForm(); return importXlsx(file); }
  if (/\.json$/.test(name)) {
    if (!confirm(`「${file.name}」の内容で、今の記録をすべて置き換えますか？`)) return;
    try { importJSON(await file.text()); fixCurrentVid(); changed(); toast('復元しました'); } catch (err) { alert('復元できませんでした: ' + err.message); }
    return;
  }
  const pdf = isPdf(file), img = isImage(file);
  if ((pdf || img) && formFileHandler && !$sheet.hidden) return formFileHandler(file);
  if (pdf) return openForm('maint', null, { lockType: true, docFile: file });
  if (img) {
    if (!$sheet.hidden) closeForm();
    return openForm('fuel', null, { lockType: true, receiptFile: file });
  }
  toast('Excel（.xlsx）、バックアップ（.json）、レシート・整備記録（画像/PDF）に対応しています', 3500);
}

function render() {
  document.querySelectorAll('#nav button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  ({ home: renderHome, records: renderRecords, stats: renderStats, settings: renderSettings }[ui.view] || renderHome)();
}

onSyncChange(() => {
  const pill = $main.querySelector('.sync-pill');
  if (pill) pill.outerHTML = syncPill();
});

// ---------- 起動 ----------
load();
render();
if (syncConfigured()) syncNow().then(r => { if (r?.pulled) { fixCurrentVid(); render(); } }).catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && syncConfigured()) syncNow().then(r => { if (r?.pulled) { fixCurrentVid(); render(); } }).catch(() => {});
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
// テスト・デバッグ用
window.__jb7 = { state, parseWorkbook, applyImport, render, syncNow };
