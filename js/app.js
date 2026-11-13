import {
  APP_VERSION, CATS, COST_TYPES, state, load, save, saveSync, settings, updateSettings, active, upsert, remove, newRecord,
  evalAmount, today, totals, currentOdo, fuelStats, costPerKm, reminders, monthly, yearly, yen, num,
  wareki, fmtYear, fmtYM, fmtDate, warekiOf,
  vehicles, setVehicle, addVehicle, deleteVehicle, fixCurrentVid, presetsForKind, remindersForKind, shakenInfo, shakenRequired,
} from './data.js';
import { readReceipt } from './receipt.js';
import { syncNow, scheduleSync, onSyncChange, syncConfigured, loadFile } from './sync.js';
import { storeFile, delBlob, discardFiles, fmtSize, isPdf, isImage, getBlob } from './files.js';
import { readMaintDoc } from './docread.js';
import { helpHtml } from './help.js';
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

// 日付入力欄の下に和暦を添える（入力に合わせて更新）
const warekiHint = v => `<div class="tiny wareki-hint" data-wareki-hint>${h(warekiOf(v))}</div>`;
document.addEventListener('input', e => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || !['date', 'month'].includes(t.type)) return;
  const hint = t.parentElement?.querySelector('[data-wareki-hint]');
  if (hint) hint.textContent = warekiOf(t.value);
});

function changed() { render(); scheduleSync(); }

// ---------- 同期の結果表示（設定画面） ----------
function syncMsgHtml() {
  const m = ui.syncMsg;
  if (!m) return '<div class="sync-msg" data-sync-msg hidden></div>';
  const ic = { ok: 'ti-circle-check', error: 'ti-alert-triangle', busy: 'ti-loader-2 spin' }[m.kind];
  return `<div class="sync-msg ${m.kind}" data-sync-msg role="status">${icon(ic)}<span>${h(m.text)}</span></div>`;
}
function setSyncMsg(kind, text) {
  ui.syncMsg = kind ? { kind, text } : null;
  const el = $main.querySelector('[data-sync-msg]');
  if (el) el.outerHTML = syncMsgHtml();
}
// 設定画面の入力欄の URL・合言葉を保存して、足りないものがあればそのメッセージを返す
function applySyncForm(sf) {
  const url = sf.querySelector('[name=url]').value.trim();
  const token = sf.querySelector('[name=token]').value.trim();
  const changedConf = url !== state.sync.url || token !== state.sync.token;
  state.sync.url = url; state.sync.token = token;
  if (changedConf) state.sync.lastPush = 0; // 接続先が変わったら全件送り直す
  saveSync();
  if (!url && !token) return { msg: 'URL と合言葉が入っていません。両方を入れてから「今すぐ同期」を押してください', field: 'url' };
  if (!url) return { msg: 'Apps Script の Web アプリ URL が入っていません', field: 'url' };
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url)) return { msg: 'URL の形が違います。https://script.google.com/macros/s/…/exec の形の URL を貼り付けてください', field: 'url' };
  if (!token) return { msg: '合言葉（トークン）が入っていません', field: 'token' };
  return null;
}

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
function topbar(title, tabs = true) {
  return `<div class="topbar"><h1>${h(title)}</h1>${syncPill()}</div>${tabs ? vehicleTabs() : ''}`;
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
      <div class="btn-row" style="margin-top:6px"><span class="btn" data-act="bought" data-id="${h(r.id)}">${icon('ti-check')}購入済みにする</span><span class="btn danger" data-act="del-plan" data-id="${h(r.id)}">${icon('ti-trash')}削除</span></div>`;
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

// ---------- 交換・点検の目安 ----------
function remLeft(r) {
  const bits = [];
  if (r.remainKm !== null) bits.push(r.remainKm >= 0 ? `あと${num(r.remainKm)}km` : `${num(-r.remainKm)}km超過`);
  if (r.remainDays !== null) bits.push(r.remainDays >= 0 ? `あと${num(r.remainDays)}日` : `${num(-r.remainDays)}日超過`);
  return bits.join('・');
}
function remSort(list) {
  const rank = { over: 0, soon: 1, ok: 2, unknown: 3 };
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || (b.progress ?? 0) - (a.progress ?? 0));
}
function remRow(r) {
  const ic = { over: 'ti-alert-triangle', soon: 'ti-bell', ok: 'ti-circle-check', unknown: 'ti-help-circle' }[r.status];
  if (r.status === 'unknown') {
    const rule = [r.rule.km ? `${num(r.rule.km)}km` : '', r.rule.months ? `${r.rule.months}か月` : ''].filter(Boolean).join('・');
    return `<div class="rem unknown">${icon(ic)}<div class="rem-b"><div class="rem-top"><span class="rem-name">${h(r.rule.name)}</span>
      <button class="link" data-act="rem-record" data-name="${h(r.rule.name)}">${icon('ti-plus')}記録</button></div>
      <div class="tiny">記録なし（目安 ${rule || '未設定'}ごと）</div></div></div>`;
  }
  const pct = Math.min(100, Math.round((r.progress ?? 0) * 100));
  const next = [r.dueOdo ? `${num(r.dueOdo)}km` : '', r.dueDate ? fmtDate(r.dueDate) : ''].filter(Boolean).join(' / ');
  return `<div class="rem ${r.status}">${icon(ic)}<div class="rem-b">
    <div class="rem-top"><span class="rem-name">${h(r.rule.name)}</span><span class="rem-left">${remLeft(r)}</span></div>
    <div class="rem-bar"><span style="width:${pct}%"></span></div>
    <div class="tiny">前回 ${fmtDate(r.last.date) || '日付なし'}${r.last.odo ? '・' + num(r.last.odo) + 'km' : ''}${next ? ' → 次回 ' + next : ''}</div></div></div>`;
}
// ---------- 車検 ----------
function shakenNote(vid = state.vid) {
  const k = shakenInfo(vid);
  if (!k.required) return '車検の対象外です（記録・登録のみ）。お知らせはしません。';
  if (!k.expiry) return '初度登録年月か満了日を入れると、車検を受けられる2か月前から予約のお知らせを出します。';
  return `次の車検満了日：<b>${fmtDate(k.expiry)}</b>${k.approx ? '（初度登録からの目安。車検証の満了日を入れると正確になります）' : ''}・${fmtDate(k.canFrom)} から受けられます`;
}
function shakenMessage(k) {
  if (k.status === 'over') return `満了日（${fmtDate(k.expiry)}）を${num(-k.daysLeft)}日過ぎています。車検証を確認してください`;
  if (k.status === 'now') return `車検を受けられる期間です。予約しましょう（満了日 ${fmtDate(k.expiry)}・あと${num(k.daysLeft)}日）`;
  if (k.status === 'soon') return `${fmtDate(k.canFrom)} から車検を受けられます。そろそろ予約の準備を（満了日 ${fmtDate(k.expiry)}）`;
  return `満了日 ${fmtDate(k.expiry)}・${fmtDate(k.canFrom)} から受けられます`;
}
function shakenRow(vid = state.vid) {
  const k = shakenInfo(vid);
  if (!k.required) return '';
  if (!k.expiry) return `<div class="rem unknown">${icon('ti-calendar-event')}<div class="rem-b"><div class="rem-top"><span class="rem-name">車検</span>
    <button class="link" data-act="to-settings">${icon('ti-settings')}設定</button></div><div class="tiny">初度登録年月を設定すると時期をお知らせします</div></div></div>`;
  const cls = { over: 'over', now: 'soon', soon: 'soon', ok: 'ok' }[k.status];
  const pct = Math.max(0, Math.min(100, Math.round((1 - k.daysLeft / 730) * 100)));
  return `<div class="rem ${cls}">${icon('ti-calendar-event')}<div class="rem-b">
    <div class="rem-top"><span class="rem-name">車検${k.approx ? '（目安）' : ''}</span><span class="rem-left">${k.daysLeft >= 0 ? `あと${num(k.daysLeft)}日` : `${num(-k.daysLeft)}日超過`}</span></div>
    <div class="rem-bar"><span style="width:${pct}%"></span></div>
    <div class="tiny">${shakenMessage(k)}</div>
    <div class="btn-row" style="margin-top:4px;gap:4px 12px"><button class="link" data-act="shaken-cal" data-cal="${h(vid)}">${icon('ti-calendar-plus')}Google カレンダーに登録</button>
      <button class="link" data-act="shaken-ics" data-cal="${h(vid)}">${icon('ti-download')}iPhone のカレンダー用</button></div></div></div>`;
}
// ホーム上部：全乗り物の車検のお知らせ（3か月前から）
function shakenBanners() {
  return vehicles().map(v => ({ v, k: shakenInfo(v.id) })).filter(x => x.k.required && x.k.expiry && x.k.status !== 'ok')
    .map(({ v, k }) => `<div class="alert ${k.status === 'over' ? 'over' : 'soon'} shaken-alert" role="button" data-vid="${h(v.id)}">${icon(k.status === 'over' ? 'ti-alert-triangle' : 'ti-calendar-event')}
      <span><b>${h(v.vehicleName)} の車検</b>：${shakenMessage(k)}</span></div>`).join('');
}
const ymdCompact = s => s.replace(/-/g, '');
function nextDay(ymd) { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
function shakenEvent(vid) {
  const v = vehicles().find(x => x.id === vid), k = shakenInfo(vid);
  return { name: v.vehicleName, title: `${v.vehicleName} 車検の予約`, date: k.canFrom, expiry: k.expiry,
    details: `${v.vehicleName} の車検満了日は ${fmtDate(k.expiry)}${k.approx ? '（初度登録からの目安）' : ''}。この日から車検を受けられます。予約しましょう。（のりもの維持費）` };
}
function openShakenCalendar(vid) {
  const ev = shakenEvent(vid);
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${ymdCompact(ev.date)}/${nextDay(ev.date)}&details=${encodeURIComponent(ev.details)}`;
  window.open(url, '_blank', 'noopener');
}
function downloadShakenIcs(vid) {
  const ev = shakenEvent(vid);
  const esc = t => t.replace(/[\\,;]/g, m => '\\' + m);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//norimono-ijihi//JP', 'BEGIN:VEVENT',
    `UID:shaken-${vid}-${ymdCompact(ev.expiry)}@norimono-ijihi`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${ymdCompact(ev.date)}`, `DTEND;VALUE=DATE:${nextDay(ev.date)}`, `SUMMARY:${esc(ev.title)}`, `DESCRIPTION:${esc(ev.details)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, 'TRIGGER:PT9H', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}（2週間後から受けられます）`, 'TRIGGER:-P14DT-9H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `車検の予約_${ev.name}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
// アプリを開いたとき、車検の時期なら端末の通知を出す（許可済みのとき・1日1回）
async function notifyShaken() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  let sent = {};
  try { sent = JSON.parse(localStorage.getItem('jb7rc.notified') || '{}'); } catch {}
  const now = today();
  for (const v of vehicles()) {
    const k = shakenInfo(v.id);
    if (!k.required || !k.expiry || k.status === 'ok' || sent[v.id] === now) continue;
    const title = `${v.vehicleName} の車検`, body = shakenMessage(k);
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.showNotification) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'shaken-' + v.id });
      else new Notification(title, { body, icon: 'icons/icon-192.png' });
      sent[v.id] = now;
    } catch (e) { console.warn('notify', e); }
  }
  try { localStorage.setItem('jb7rc.notified', JSON.stringify(sent)); } catch {}
}

function reminderPanel() {
  const rems = remSort(reminders());
  return `<div class="card rem-panel">
    <div class="h-row" style="margin-bottom:8px"><b>${icon('ti-tool')} 交換・点検の目安</b><span class="tiny">今 ${num(currentOdo())}km</span></div>
    ${shakenRow()}
    ${rems.length ? rems.map(remRow).join('') : '<div class="tiny">目安が設定されていません</div>'}
    <div class="btn-row" style="margin-top:10px">
      <button class="btn primary sm" data-act="add-maint">${icon('ti-plus')}メンテを記録</button>
      <button class="btn sm" data-act="to-settings">${icon('ti-adjustments')}目安を編集</button>
    </div>
    <div class="tiny" style="margin-top:6px">距離と期間のうち、先に来る方で判定。メンテ記録の「実施項目」の言葉で前回を探します。</div>
  </div>`;
}

// ---------- ホーム（A） ----------
// ---------- 愛車の写真 ----------
const photoUrls = new Map();   // 写真 id → blob URL（再描画のたびに読み直さない）
function photoBox(v, cls = '') {
  const url = v.photo?.id ? photoUrls.get(v.photo.id) : null;
  return `<div class="vphoto ${cls} ${url ? 'has' : ''}" data-photo-id="${h(v.photo?.id || '')}" style="${url ? `background-image:url('${url}')` : ''}">
    ${url ? '' : icon(v.kind === 'bike' ? 'ti-motorbike' : 'ti-car')}</div>`;
}
// 画面に出た写真を IndexedDB（無ければドライブ）から読み込む
function hydratePhotos(root = document) {
  const metas = new Map(vehicles().filter(v => v.photo?.id).map(v => [v.photo.id, v.photo]));
  root.querySelectorAll('.vphoto[data-photo-id]:not(.has)').forEach(async el => {
    const meta = metas.get(el.dataset.photoId);
    if (!meta) return;
    try {
      let url = photoUrls.get(meta.id);
      if (!url) { url = URL.createObjectURL(await loadFile(meta)); photoUrls.set(meta.id, url); }
      el.style.backgroundImage = `url('${url}')`; el.classList.add('has'); el.querySelector('.ti')?.remove();
    } catch { /* 他の端末の写真で未同期など */ }
  });
}
async function setVehiclePhoto(file) {
  const vid = state.vid;   // 保存中に乗り物を切り替えても、選んだ時の乗り物に付ける
  try {
    toast('写真を保存中…', 1500);
    const meta = await storeFile(file, 1200);
    const old = settings(vid).photo;
    updateSettings({ photo: meta }, vid);
    if (old?.id) discardFiles([old]);
    scheduleSync(); render(); toast('写真を登録しました');
  } catch (err) { alert(err.message); }
}

// 期限を過ぎた・近いお知らせ（写真のバッジと長押しプレビュー用）
function alertsOf(vid) {
  const rems = reminders(vid).filter(r => r.status === 'over' || r.status === 'soon');
  const k = shakenInfo(vid);
  const shaken = k.required && k.expiry && k.status !== 'ok' ? k : null;
  const over = rems.filter(r => r.status === 'over').length + (shaken?.status === 'over' ? 1 : 0);
  return { rems: remSort(rems), shaken, count: rems.length + (shaken ? 1 : 0), over };
}

// ---------- ホーム ----------
function renderHome() {
  const vs = vehicles();
  const hasData = active(null, '*').length > 0;
  const all = vs.map(v => ({ v, t: totals(v.id) }));
  const sum = all.reduce((a, x) => a + x.t.grand, 0);

  const detail = (v, t) => {
    const cpk = costPerKm(v.id);
    const f = fuelStats(v.id);
    const bar = COST_TYPES.filter(k => t.byType[k] > 0).map(k => `<span style="width:${(t.byType[k] / (t.upkeep || 1) * 100).toFixed(2)}%;background:${CATS[k].color}" title="${CATS[k].label}"></span>`).join('');
    return `<div class="g-detail">
      <div class="h-row"><span class="muted">ローン ${yen(t.loan)} ＋ 維持費 ${yen(t.upkeep)}</span><span class="tiny">ODO ${num(currentOdo(v.id))}km</span></div>
      <div class="stack-bar">${bar}</div>
      <div class="g-body"><div class="mini-cats">
        ${COST_TYPES.map(k => `<button class="mini-cat" data-cat="${k}"><span class="lbl"><i class="ti ${CATS[k].icon}" style="color:${CATS[k].color}" aria-hidden="true"></i>${CATS[k].short === '書類' ? '書類・保険' : CATS[k].label}</span><b>${yen(t.byType[k])}</b></button>`).join('')}
        <button class="mini-cat" data-cat="plan"><span class="lbl"><i class="ti ${CATS.plan.icon}" style="color:${CATS.plan.color}" aria-hidden="true"></i>カスタム計画</span><b>${yen(t.plan)}</b></button>
      </div>
      <div class="kpis g-kpis">
        <div><div class="v">${f.avgEconomy ? num(f.avgEconomy, 1) : '—'}</div><div class="tiny">平均燃費 km/L</div></div>
        <div><div class="v">${cpk.fuel !== null ? '¥' + num(cpk.fuel, 1) : '—'}</div><div class="tiny">燃料費 /km</div></div>
        <div><div class="v">${cpk.upkeep !== null ? '¥' + num(cpk.upkeep, 1) : '—'}</div><div class="tiny">維持費 /km</div></div>
      </div></div>
      <div class="tiny g-foot"><span>納車から ${num(Math.max(cpk.dist, 0))}km 走行</span>
        ${v.photo?.id ? `<span>${icon('ti-hand-finger')}写真を長押しでメンテのお知らせ</span>` : `<label class="link">${icon('ti-photo-plus')}写真を登録<input type="file" accept="image/*" data-vphoto hidden></label>`}</div>
    </div>`;
  };

  $main.innerHTML = `
    ${topbar('のりもの維持費', false)}
    ${shakenBanners()}
    ${!hasData ? `<div class="card empty">${icon('ti-file-spreadsheet')}<p>まだ記録がありません</p>
      <div class="btn-row" style="justify-content:center"><button class="btn primary" data-act="import-xlsx">${icon('ti-upload')}Excelから取り込む</button>
      <button class="btn" data-act="add">${icon('ti-plus')}記録を追加</button></div></div>` : ''}
    <div class="quick">
      <button class="btn primary" data-act="receipt-camera">${icon('ti-camera')}レシートで給油登録</button>
      <button class="btn" data-act="add-fuel">${icon('ti-gas-station')}給油を手入力</button>
    </div>
    <div class="garage card">
        ${all.map(({ v, t }) => {
          const al = alertsOf(v.id);
          const on = v.id === state.vid;
          return `<div class="g-item ${on ? 'active' : ''}">
            <div class="g-row" role="button" tabindex="0" data-vid="${h(v.id)}" aria-expanded="${on}">
              <div class="g-photo" data-peek="${h(v.id)}">${photoBox(v)}
                ${al.count ? `<span class="g-badge ${al.over ? 'over' : 'soon'}" data-act="peek" data-peek-vid="${h(v.id)}" title="お知らせ ${al.count}件">${al.count}</span>` : ''}</div>
              <div class="g-name"><b>${h(v.vehicleName)}</b><span class="tiny">${al.count ? `${al.over ? '期限超過あり' : '期限が近いものあり'}（${al.count}件）` : 'メンテ期限 OK'}</span></div>
              <div class="g-meta"><b>${yen(t.upkeep)}</b><span class="tiny">維持費</span></div>
              <div class="g-meta"><b>${num(currentOdo(v.id))}<small>km</small></b><span class="tiny">ODO</span></div>
              <div class="g-total"><b>${yen(t.grand)}</b><span class="tiny">総額</span></div>
              ${icon(on ? 'ti-chevron-up' : 'ti-chevron-down', 'class="g-chev"')}
            </div>
            ${on ? detail(v, t) : ''}
          </div>`;
        }).join('')}
        <div class="g-sum"><button class="link" data-act="add-vehicle">${icon('ti-plus')}乗り物を追加</button>
          ${vs.length > 1 ? `<span><span class="muted">全乗り物の合計</span> <b>${yen(sum)}</b></span>` : ''}</div>
    </div>`;
  hydratePhotos($main);
}

// ---------- 長押しプレビュー ----------
function openPeek(vid) {
  closePeek();
  const v = vehicles().find(x => x.id === vid);
  if (!v) return;
  const al = alertsOf(vid);
  const upcoming = remSort(reminders(vid).filter(r => r.status === 'ok')).slice(0, 3);
  const el = document.createElement('div');
  el.className = 'peek';
  el.innerHTML = `<div class="peek-card" role="dialog" aria-label="${h(v.vehicleName)} のお知らせ">
    <div class="peek-head">${photoBox(v, 'big')}<div><b>${h(v.vehicleName)}</b><div class="tiny">ODO ${num(currentOdo(vid))}km・${al.count ? `お知らせ ${al.count}件` : '期限を過ぎたものはありません'}</div></div></div>
    <div class="peek-body">
      ${al.shaken ? shakenRow(vid) : ''}
      ${al.rems.map(remRow).join('')}
      ${!al.count ? `<div class="tiny" style="margin:4px 0 6px">次に来るもの</div>${upcoming.map(remRow).join('') || '<div class="tiny">メンテ記録が入ると目安を表示します</div>'}` : ''}
    </div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:8px">
      <button class="btn sm" data-peek-act="all">${icon('ti-list')}すべての目安</button>
      <button class="btn sm primary" data-peek-act="close">閉じる</button></div>
  </div>`;
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-peek-act],[data-act]');
    if (e.target === el || t?.dataset.peekAct === 'close') return closePeek();
    if (t?.dataset.peekAct === 'all') { closePeek(); setVehicle(vid); go('records', { cat: 'maint' }); return; }
    if (t?.dataset.act === 'shaken-cal') return openShakenCalendar(t.dataset.cal);
    if (t?.dataset.act === 'shaken-ics') return downloadShakenIcs(t.dataset.cal);
  });
  document.body.appendChild(el);
  hydratePhotos(el);
  if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
}
function closePeek() { document.querySelectorAll('.peek').forEach(x => x.remove()); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePeek(); });

// 写真の長押し（スマホ）・右クリック（PC）
let pressTimer = null, pressStart = null, suppressClick = false;
$main.addEventListener('pointerdown', e => {
  const ph = e.target.closest('[data-peek]');
  if (!ph) return;
  pressStart = { x: e.clientX, y: e.clientY };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { suppressClick = true; openPeek(ph.dataset.peek); }, 450);
});
$main.addEventListener('pointermove', e => {
  if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) { clearTimeout(pressTimer); pressTimer = null; }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => $main.addEventListener(t, () => { clearTimeout(pressTimer); pressTimer = null; }));
$main.addEventListener('contextmenu', e => {
  const ph = e.target.closest('[data-peek]');
  if (!ph) return;
  e.preventDefault();
  if (!suppressClick) openPeek(ph.dataset.peek);
});

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
  const label = k => k === 'none' ? '日付未設定' : k === 'plan' ? '欲しい物リスト' : fmtYM(k);

  let extra = '';
  if (ui.cat === 'fuel') {
    extra = `<div class="tiny">平均燃費 ${fs.avgEconomy ? num(fs.avgEconomy, 1) + 'km/L' : '—'} · 給油 ${list.length}回 · ${num(fs.totalLiters, 1)}L</div>`;
  }

  $main.innerHTML = `
    ${topbar('記録')}
    <div class="tabs" role="tablist">${tabs.map(([k, l, ic]) => `<button class="tab ${ui.cat === k ? 'active' : ''}" data-tab="${k}" role="tab">${icon(ic)}${l}</button>`).join('')}</div>
    <div class="rec-layout"><div class="rec-main">
    <div class="tab-summary"><span class="muted">${list.length}件</span>
      <span class="h-row" style="gap:12px"><span style="font-weight:700;font-size:18px">${yen(total)}</span>
      <button class="btn primary sm" data-act="add">${icon('ti-plus')}${ui.cat === 'all' ? '記録' : CATS[ui.cat].short}を追加</button></span></div>
    ${extra}
    ${groups.length ? groups.map(g => `<div class="month"><span>${label(g.key)}</span><span>${yen(g.sum)}</span></div>${g.items.map(r => tlItem(r, fs)).join('')}`).join('')
      : `<div class="empty">${icon(ui.cat === 'all' ? 'ti-list' : CATS[ui.cat].icon)}<p>${ui.cat === 'all' ? '記録' : CATS[ui.cat].label}はまだありません</p><button class="btn primary" data-act="add">${icon('ti-plus')}追加する</button></div>`}
    </div><aside class="rec-aside ${ui.cat === 'maint' ? 'narrow-show' : ''}">${reminderPanel()}</aside></div>
  `;
  const at = $main.querySelector('.tab.active');
  if (at) at.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ---------- ヘルプ ----------
function renderHelp() {
  $main.innerHTML = `<div class="topbar"><h1>ヘルプ</h1>${syncPill()}</div>${helpHtml()}<div class="tiny" style="text-align:center;margin:8px 0 20px">のりもの維持費 v${APP_VERSION}</div>`;
}

// ---------- 集計 ----------
// 目盛り: 1・2・2.5・3・4・5 ×10^n で切りの良い最大値と間隔
function niceScale(max, ticks = 4) {
  const raw = Math.max(1, max) / ticks;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 3, 4, 5, 10].map(f => f * p).find(v => v >= raw);
  return { step, top: step * ticks };
}
const man = v => { const x = v / 10000; return (Number.isInteger(x) ? x : x < 1 ? +x.toFixed(2) : +x.toFixed(1)) + '万'; };

function barChart(months, data, cat = 'all') {
  const W = 640, H = 220, L = 50, B = 22, T = 18;
  const keys = cat === 'all' ? COST_TYPES : [cat];
  const totalsArr = months.map(m => keys.reduce((a, k) => a + (data[m]?.[k] || 0), 0));
  const { step: tick, top } = niceScale(Math.max(...totalsArr, 0));
  const step = (W - L - 6) / Math.max(1, months.length);
  const bw = Math.min(28, step * 0.7);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="月別の${cat === 'all' ? '維持費' : CATS[cat].label}">`;
  svg += `<text x="4" y="10">（万円）</text>`;
  for (let i = 0; i <= 4; i++) {
    const y = T + (H - T - B) * (1 - i / 4);
    svg += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity=".1"/><text x="${L - 4}" y="${y + 3}" text-anchor="end">${i ? man(tick * i) : '0'}</text>`;
  }
  months.forEach((m, i) => {
    const x = L + step * i + (step - bw) / 2;
    let y = H - B;
    for (const k of keys) {
      const v = data[m]?.[k] || 0;
      if (!v) continue;
      const hgt = (H - T - B) * v / top;
      y -= hgt;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${hgt}" fill="${CATS[k].color}"><title>${fmtYM(m)} ${CATS[k].label} ${yen(v)}</title></rect>`;
    }
    if (cat !== 'all' && totalsArr[i] && months.length <= 14) svg += `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${man(totalsArr[i])}</text>`;
    const lbl = months.length > 14 ? (m.endsWith('-01') || (i === 0 && Number(m.slice(5)) <= 8) ? fmtYear(m.slice(0, 4)) : '') : Number(m.slice(5)) + '月';
    svg += `<text x="${months.length > 14 ? x : x + bw / 2}" y="${H - 6}" text-anchor="${months.length > 14 ? 'start' : 'middle'}">${lbl}</text>`;
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

  const sc = COST_TYPES.includes(ui.statsCat) ? ui.statsCat : 'all';
  const keys = sc === 'all' ? COST_TYPES : [sc];
  const perMonth = months.map(m => ({ m, v: keys.reduce((a, k) => a + (mon[m]?.[k] || 0), 0) }));
  const periodSum = perMonth.reduce((a, x) => a + x.v, 0);
  const usedMonths = perMonth.filter(x => x.v > 0);
  const maxM = usedMonths.reduce((a, x) => (x.v > (a?.v || 0) ? x : a), null);
  const monthLabel = fmtYM;

  $main.innerHTML = `
    ${topbar('集計')}
    <div class="tabs">${['all', ...years].map(y => `<button class="tab ${ui.statsYear === y ? 'active' : ''}" data-year="${y}">${y === 'all' ? '全期間' : fmtYear(y)}</button>`).join('')}</div>
    <div class="tabs cat-tabs">${['all', ...COST_TYPES].map(k => `<button class="tab ${sc === k ? 'active' : ''}" data-scat="${k}">${k === 'all' ? icon('ti-stack-2') + '全体（合算）' : `<i class="ti ${CATS[k].icon}" style="color:${CATS[k].color}" aria-hidden="true"></i>` + CATS[k].label}</button>`).join('')}</div>
    <div class="card"><div class="h-row"><span class="muted">月別の${sc === 'all' ? '維持費（合算）' : CATS[sc].label}</span><span class="tiny">日付のある記録のみ</span></div>
      <div class="kpis stat-kpis">
        <div><div class="v">${yen(periodSum)}</div><div class="tiny">${ui.statsYear === 'all' ? '全期間' : fmtYear(ui.statsYear)}の合計</div></div>
        <div><div class="v">${months.length ? yen(Math.round(periodSum / months.length)) : '—'}</div><div class="tiny">月平均（${months.length}か月）</div></div>
        <div><div class="v">${maxM ? yen(maxM.v) : '—'}</div><div class="tiny">最も多い月${maxM ? '：' + fmtYM(maxM.m) : ''}</div></div>
      </div>
      ${months.length ? barChart(months, mon, sc) : '<div class="tiny">データがありません</div>'}
      ${sc === 'all' ? `<div class="legend">${COST_TYPES.map(k => `<button class="legend-btn" data-scat="${k}" style="--c:${CATS[k].color}">${CATS[k].label}</button>`).join('')}</div><div class="tiny" style="margin-top:4px">項目名を押すと、その項目だけの月別合計を表示します</div>` : ''}
      ${sc !== 'all' && usedMonths.length ? `<details class="month-list"><summary>月ごとの金額（${usedMonths.length}か月）</summary><table class="t">
        ${[...usedMonths].reverse().map(x => `<tr><td>${monthLabel(x.m)}</td><td>${yen(x.v)}</td></tr>`).join('')}</table></details>` : ''}
    </div>
    <div class="card"><div class="muted" style="margin-bottom:6px">年別・カテゴリ別</div><div class="scroll-x"><table class="t">
      <tr><th>カテゴリ</th>${yearKeys.map(y => `<th>${h(y === '日付なし' ? y : fmtYear(y))}</th>`).join('')}<th>合計</th></tr>
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
  const lastD = sy.lastSyncAt ? new Date(sy.lastSyncAt) : null;
  const last = lastD ? `${lastD.toLocaleString('ja-JP')}（${wareki(lastD.getFullYear(), lastD.getMonth() + 1, lastD.getDate())}）` : '未同期';
  $main.innerHTML = `
    ${topbar('設定')}
    <div class="sec-title">乗り物の設定（${h(s.vehicleName)}）</div>
    <div class="card" data-form="vehicle">
      <div class="photo-edit">${photoBox(vehicles().find(v => v.id === state.vid) || {}, 'big')}
        <div class="btn-row">
          <label class="btn">${icon('ti-photo')}写真を選ぶ<input type="file" accept="image/*" data-vphoto hidden></label>
          <label class="btn">${icon('ti-camera')}撮影<input type="file" accept="image/*" capture="environment" data-vphoto hidden></label>
          ${s.photo?.id ? `<button class="btn danger" data-act="del-vphoto">${icon('ti-trash')}削除</button>` : ''}
        </div></div>
      <div class="two"><div class="field"><label>名前</label><input name="vehicleName" value="${h(s.vehicleName)}"></div>
      <div class="field"><label>種類</label><select name="kind"><option value="car" ${s.kind !== 'bike' ? 'selected' : ''}>車</option><option value="bike" ${s.kind === 'bike' ? 'selected' : ''}>バイク</option></select></div></div>
      <div class="two"><div class="field"><label>納車時の走行距離 (km)</label><input name="deliveryOdo" inputmode="numeric" value="${h(s.deliveryOdo)}"></div>
      <div class="field"><label>納車日</label><input name="deliveryDate" type="date" value="${h(s.deliveryDate)}">${warekiHint(s.deliveryDate)}</div></div>
      <div class="two"><div class="field"><label>初度登録年月（車検証）</label><input name="firstReg" type="month" value="${h(s.firstReg || '')}">${warekiHint(s.firstReg)}</div>
      <div class="field"><label>車検の満了日（車検証。分かれば）</label><input name="shakenExpiry" type="date" value="${h(s.shakenExpiry || '')}">${warekiHint(s.shakenExpiry)}</div></div>
      <div class="two"><div class="field"><label>排気量 (cc)</label><input name="displacement" inputmode="numeric" placeholder="${s.kind === 'bike' ? '例: 250' : '例: 658'}" value="${h(s.displacement ?? '')}"></div>
      <div class="field"><label>車検</label><select name="shaken">
        <option value="" ${!s.shaken ? 'selected' : ''}>自動（${s.kind === 'bike' && !(Number(s.displacement) > 250) ? 'なし：250cc以下のバイク' : 'あり'}）</option>
        <option value="yes" ${s.shaken === 'yes' ? 'selected' : ''}>あり（お知らせする）</option>
        <option value="no" ${s.shaken === 'no' ? 'selected' : ''}>なし（登録のみ）</option></select></div></div>
      <div class="tiny" style="margin:-4px 0 12px">${shakenNote()}
        ${shakenRequired() ? `<br>${'Notification' in window && Notification.permission === 'granted' ? '端末の通知：許可済み（アプリを開いたときに通知）' : `<button class="link" data-act="notify-perm">${icon('ti-bell')}端末の通知を許可する</button>（アプリを開いたときに通知）`}` : ''}</div>
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
      <div class="h-row"><span class="tiny">最終同期: ${h(last)}</span>
        <button class="btn primary" data-act="sync">${icon('ti-refresh')}今すぐ同期</button></div>
      ${syncMsgHtml()}
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
  const dateField = (label = '日付') => `<div class="field"><label>${label}</label><input name="date" type="date" value="${h(r.date)}">${warekiHint(r.date)}<div class="err" data-err="date"></div></div>`;
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
      if (res.date) { form.date.value = res.date; form.date.dispatchEvent(new Event('input', { bubbles: true })); got.push(`日付 ${fmtDate(res.date)}`); }
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
      if (res.date) { form.date.value = res.date; form.date.dispatchEvent(new Event('input', { bubbles: true })); got.push(`日付 ${fmtDate(res.date)}`); }
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
  if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
  if (e.target.closest('[data-stop]')) { e.stopPropagation(); return; }
  if (e.target.closest('input[data-vphoto]')) return;
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'bought') {
      e.stopPropagation();
      const p = state.records.find(x => x.id === act.dataset.id);
      openForm('custom', null, { lockType: true, fromPlan: p.id, prefill: { title: p.title, amount: p.amount, note: [p.extra?.maker, p.note].filter(Boolean).join(' / ') } });
      return;
    }
    if (a === 'del-plan') {
      e.stopPropagation();
      const p = state.records.find(x => x.id === act.dataset.id);
      if (p && confirm(`「${p.title || 'カスタム計画'}」を削除しますか？`)) { remove(p.id); changed(); toast('削除しました'); }
      return;
    }
    if (a === 'add') return openForm(ui.view === 'records' && ui.cat !== 'all' ? ui.cat : 'fuel');
    if (a === 'add-maint') return openForm('maint');
    if (a === 'peek') { e.stopPropagation(); return openPeek(act.dataset.peekVid); }
    if (a === 'del-vphoto') {
      const old = settings().photo;
      if (old?.id && confirm('この乗り物の写真を削除しますか？')) { updateSettings({ photo: null }); discardFiles([old]); scheduleSync(); render(); }
      return;
    }
    if (a === 'shaken-cal') return openShakenCalendar(act.dataset.cal);
    if (a === 'shaken-ics') return downloadShakenIcs(act.dataset.cal);
    if (a === 'notify-perm') {
      if (!('Notification' in window)) { alert('この端末・ブラウザでは通知が使えません。カレンダーへの登録を使ってください。'); return; }
      const r = await Notification.requestPermission();
      toast(r === 'granted' ? '通知を許可しました' : '通知は許可されませんでした');
      if (r === 'granted') notifyShaken();
      render(); return;
    }
    if (a === 'rem-record') return openForm('maint', null, { prefill: { title: act.dataset.name } });
    if (a === 'help-to') { const el = $main.querySelector('#' + act.dataset.to); if (el) el.scrollIntoView({ behavior: 'smooth' }); return; }
    if (a === 'to-settings') return go('settings');
    if (a === 'sync') {
      const sf = act.closest('[data-form="sync"]');
      if (sf) {
        const bad = applySyncForm(sf);
        if (bad) { setSyncMsg('error', bad.msg); toast(bad.msg, 4000); sf.querySelector(`[name=${bad.field}]`)?.focus(); return; }
      } else if (!syncConfigured()) {
        ui.syncMsg = { kind: 'error', text: '同期するには、下の「クラウド同期」に URL と合言葉を入れてください' };
        go('settings'); toast('URL と合言葉を入れてください', 3000);
        $main.querySelector('[data-form="sync"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (act.disabled) return;
      act.disabled = true; act.innerHTML = `${icon('ti-loader-2 spin')}同期中…`;
      setSyncMsg('busy', '同期中です。件数が多いと数十秒かかります…');
      try {
        const r = await syncNow();
        const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        ui.syncMsg = { kind: 'ok', text: `同期が完了しました（${time}）。送信 ${r.pushed ?? 0}件・受信 ${r.pulled ?? 0}件` };
        fixCurrentVid(); render(); toast('同期が完了しました');
      } catch (err) {
        ui.syncMsg = { kind: 'error', text: `同期できませんでした：${state.sync.error || err.message}` };
        render(); toast('同期できませんでした', 4000);
      }
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
      if (s.photo?.id) discardFiles([s.photo]);
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
  const scat = e.target.closest('[data-scat]');
  if (scat) { ui.statsCat = scat.dataset.scat; try { sessionStorage.setItem('jb7.ui', JSON.stringify(ui)); } catch {} render(); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { const r = state.records.find(x => x.id === ed.dataset.edit); if (r) openForm(r.type, r); }
});

$main.addEventListener('change', e => {
  if (e.target.matches('[data-vphoto]')) { const f = e.target.files[0]; e.target.value = ''; if (f) setVehiclePhoto(f); return; }
  const vf = e.target.closest('[data-form="vehicle"]');
  if (vf) {
    const k = e.target.name;
    const numeric = ['deliveryOdo', 'loanPaid', 'purchaseCost', 'displacement'];
    let v = e.target.value;
    if (numeric.includes(k)) { v = evalAmount(v).value; if (Number.isNaN(v)) { toast('数字で入力してください'); return; } }
    const patch = { [k]: v };
    if (k === 'kind' && active('maint').length === 0) Object.assign(patch, { reminders: remindersForKind(v), maintPresets: presetsForKind(v) });
    updateSettings(patch); scheduleSync(); toast('保存しました', 1200);
    if (['vehicleName', 'kind', 'firstReg', 'shakenExpiry', 'displacement', 'shaken'].includes(k)) render();
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
  if (sf) { applySyncForm(sf); setSyncMsg(null); }
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
  $main.className = 'view-' + ui.view;
  ({ home: renderHome, records: renderRecords, stats: renderStats, settings: renderSettings, help: renderHelp }[ui.view] || renderHome)();
  hydratePhotos($main);
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
setTimeout(() => notifyShaken(), 1500);
// テスト・デバッグ用
window.__jb7 = { state, parseWorkbook, applyImport, render, syncNow };
