// ディーラーの整備記録・請求書（PDF / 写真）から 日付・走行距離・合計金額・作業項目 を読み取る
import { ocr, normalize, pickTotal, amountOf, findDate } from './receipt.js';
import { isPdf } from './files.js';

const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
let pdfPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  pdfPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_BASE + 'build/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'build/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfPromise = null; reject(new Error('PDF を読む部品を取得できません（初回はオンラインが必要です）')); };
    document.head.appendChild(s);
  });
  return pdfPromise;
}

const MAX_PAGES = 4;

// PDF の文字を行ごとに取り出す（座標で行をまとめる）
async function pdfText(doc) {
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < Math.max(2, (it.height || 10) * 0.4));
      if (!row) rows.push(row = { y, items: [] });
      row.items.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) out.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' '));
  }
  return out.join('\n');
}

/** file: PDF か画像。presets: 乗り物のメンテ項目名（一致したらその名前を使う） */
export async function readMaintDoc(file, presets = [], onProgress = () => {}) {
  let text = '';
  let how = 'ocr';
  if (isPdf(file)) {
    onProgress(0, 'PDF を開いています');
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: PDFJS_BASE + 'cmaps/', cMapPacked: true,
      standardFontDataUrl: PDFJS_BASE + 'standard_fonts/',
    }).promise;
    text = await pdfText(doc);
    how = 'pdf';
    // 文字が入っていない（スキャンした）PDF はページを画像にして文字認識
    if (text.replace(/\s/g, '').length < 30) {
      how = 'ocr';
      const parts = [];
      const n = Math.min(doc.numPages, 3);
      for (let p = 1; p <= n; p++) {
        const page = await doc.getPage(p);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(3, 2000 / Math.max(vp0.width, vp0.height)) });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        // intent:'print' は画面描画の待ち合わせ（requestAnimationFrame）を使わないので、裏に回っても止まらない
        await page.render({ canvasContext: c.getContext('2d', { willReadFrequently: true }), viewport: vp, intent: 'print' }).promise;
        parts.push(await ocr(c, pct => onProgress(Math.round(((p - 1) + pct / 100) / n * 100)), '4'));
      }
      text = parts.join('\n');
    }
  } else {
    text = await ocr(file, onProgress, '4');
  }
  return { ...parseMaintDoc(text, presets), text, how };
}

// よく出る作業名 → 表示名。乗り物のメンテ項目に同じ作業があればそちらの名前を使う
const ITEMS = [
  ['車検', /車検|継続検査/],
  ['12か月点検', /(12|十二)\s*(ヶ|カ|ケ|か|箇)?\s*月\s*(点検|定期)|法定\s*12|法定点検/],
  ['6か月点検', /(6|六)\s*(ヶ|カ|ケ|か|箇)?\s*月\s*点検/],
  ['オイル交換', /エンジン\s*オイル|ｴﾝｼﾞﾝｵｲﾙ|オイル交換|E\/?G?\s*OIL/i],
  ['オイルフィルター交換', /オイル\s*(エレメント|フィルタ)|ｵｲﾙｴﾚﾒﾝﾄ|オイルフィルター/],
  ['ATF/CVTフルード交換', /CVT\s*(フルード|オイル|F)|ATF|オートマ.{0,4}(オイル|フルード)/i],
  ['MTオイル交換', /MT\s*オイル|ミッション\s*オイル|ギヤ\s*オイル|ギア\s*オイル/i],
  ['デフオイル交換', /デフ\s*オイル/],
  ['ブレーキフルード交換', /ブレーキ\s*(フルード|オイル|液)/],
  ['ブレーキパッド交換', /ブレーキ\s*パッド|ﾌﾞﾚｰｷﾊﾟｯﾄﾞ|(フロント|リヤ|リア)\s*パッド/],
  ['クーラント交換', /クーラント|冷却水|LLC/i],
  ['エアクリーナー交換', /エア\s*クリーナ|エア\s*エレメント|エアクリ/],
  ['エアコンフィルター交換', /エアコン\s*フィルタ|クリーン\s*(エア)?\s*フィルタ|花粉\s*フィルタ/],
  ['スパークプラグ交換', /スパーク\s*プラグ|点火\s*プラグ|プラグ交換/],
  ['ワイパーゴム交換', /ワイパー/],
  ['バッテリー交換', /バッテリ/],
  ['タイヤローテーション', /ローテーション/],
  ['タイヤ交換', /タイヤ(?!.*ローテーション)/],
  ['チェーン調整', /チェーン/],
  ['洗車', /洗車/],
];

export function parseMaintDoc(raw, presets = []) {
  const text = normalize(raw || '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const future = /次回|有効期限|満了|期限|予定|推奨/;
  const out = { date: null, odo: null, amount: null, items: [], title: '' };

  // 日付: 入庫日・作業日などの行を優先。次回点検日などは除外
  const dateKey = /入庫|作業|実施|点検日|整備|完了|納車|受付|伝票|請求日|発行日|日付/;
  for (const pass of [true, false]) {
    for (const l of lines) {
      if (future.test(l) || (pass && !dateKey.test(l))) continue;
      const d = findDate(l);
      if (d) { out.date = d; break; }
    }
    if (out.date) break;
  }

  // 走行距離: 「走行距離 61,234km」「ODO 61234」
  const odoNum = s => Number(String(s).replace(/[,.]/g, ''));
  const odoCands = [];
  lines.forEach((l, i) => {
    if (future.test(l)) return;
    const key = /走行\s*距離|走行|ODO|メーター|距離計/i.test(l);
    for (const m of l.matchAll(/(\d{1,3}(?:[,.]\d{3})+|\d{2,7})\s*(?:km|ｋｍ|KM|キロ)/gi)) odoCands.push({ v: odoNum(m[1]), w: key ? 3 : 1 });
    if (key) {
      const m = l.match(/(\d{1,3}(?:[,.]\d{3})+|\d{3,7})(?![\d.,])/) || (lines[i + 1] || '').match(/^(\d{1,3}(?:[,.]\d{3})+|\d{3,7})(?![\d.,])/);
      if (m) odoCands.push({ v: odoNum(m[1]), w: 2 });
    }
  });
  const odo = odoCands.filter(c => c.v >= 10 && c.v < 2000000).sort((a, b) => b.w - a.w || b.v - a.v)[0];
  if (odo) out.odo = odo.v;

  // 合計金額
  out.amount = pickTotal(lines, [
    /総\s*合\s*計|請\s*求\s*.?\s*額|お\s*支\s*払|合\s*計\s*金\s*額|税\s*込\s*合\s*計/,
    /合\s*計|TOTAL/i, /小\s*計/,
  ], 3000000);

  // 作業項目（行の末尾の金額も拾う）。点検記録簿の「点検した項目」だけの行は拾わない
  const seen = new Set();
  const usedLines = new Set();
  const isWork = (name, line, amount) => /車検|点検/.test(name) || !!amount || /交換|取替|取り替え|補充|工賃|作業|部品/.test(line);
  for (const [name, re] of ITEMS) {
    for (const line of lines) {
      if (!re.test(line) || future.test(line)) continue;
      const amount = amountOf(line, 3000000);
      if (!isWork(name, line, amount)) continue;
      const matches = presets.filter(p => re.test(p));
      const label = matches.length === 1 ? matches[0] : name;
      if (!seen.has(label)) { seen.add(label); usedLines.add(line); out.items.push({ name: label, amount, line }); }
      break;
    }
  }
  // 乗り物のメンテ項目名がそのまま書かれている場合
  for (const p of presets) {
    if (seen.has(p) || p.length < 3) continue;
    const key = p.replace(/[（）()、・\s]/g, '');
    const line = lines.find(l => !usedLines.has(l) && !future.test(l) && l.replace(/\s/g, '').includes(key));
    const amount = line ? amountOf(line, 3000000) : null;
    if (line && isWork(p, line, amount)) { seen.add(p); usedLines.add(line); out.items.push({ name: p, amount, line }); }
  }
  out.title = out.items.map(i => i.name).join('・');
  return out;
}
