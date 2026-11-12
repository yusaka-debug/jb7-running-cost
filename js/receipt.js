// 給油レシートの読み取り（端末内で文字認識。外部APIや料金は不要）
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let libPromise = null;
let workerPromise = null;

function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  libPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { libPromise = null; reject(new Error('文字認識の部品を取得できません（初回はオンラインが必要です）')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

let progressCb = () => {};
async function getWorker() {
  workerPromise ??= (async () => {
    const T = await loadLib();
    return T.createWorker(['jpn', 'eng'], 1, {
      logger: m => { if (m.status === 'recognizing text') progressCb(Math.round(m.progress * 100)); },
    });
  })().catch(e => { workerPromise = null; throw e; });
  return workerPromise;
}

// 写真を縮小・グレースケール化・コントラスト強調して認識しやすくする
async function preprocess(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  let img = bmp;
  if (!img) {
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('画像を開けません（HEICの場合はJPEGで撮影してください）'));
      el.src = URL.createObjectURL(file);
    });
  }
  const w0 = img.width, h0 = img.height;
  const scale = Math.min(1, 2000 / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  // 明るさの分布から黒/白点を決めて伸ばす
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    px[i] = g; hist[g]++;
  }
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.02) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.02) break; }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    let v = (px[i] - lo) * 255 / range;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export async function readReceipt(file, onProgress = () => {}) {
  progressCb = onProgress;
  onProgress(0, '準備中');
  const canvas = await preprocess(file);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return { ...parseReceipt(data.text), text: data.text };
}

// ---------- 文字列から値を取り出す ----------
function normalize(text) {
  return text
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 日本語の文字間に入った空白（「数 量」など）を詰める
    .replace(/([^\x00-\x7F])[ \t]+(?=[^\x00-\x7F])/g, '$1').replace(/([^\x00-\x7F])[ \t]+(?=[^\x00-\x7F])/g, '$1')
    .replace(/[，、]/g, ',').replace(/[．。]/g, '.').replace(/[￥\\]/g, '¥').replace(/[ℓ]/g, 'L').replace(/[：]/g, ':').replace(/[／]/g, '/')
    // 数字の間に入った余計な空白（OCRでよく起きる）を詰める
    .replace(/(\d)[ \t]+(?=[,.]\d)/g, '$1').replace(/(\d[,.])[ \t]+(?=\d)/g, '$1')
    .replace(/[ \t]+/g, ' ');
}
const toNum = s => Number(String(s).replace(/,/g, ''));

export function parseReceipt(raw) {
  const text = normalize(raw || '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = { amount: null, liters: null, unit: null, date: null, odo: null };

  // 給油量: 「26.37L」「数量 26.37」「給油量:26.37」
  const litCands = [];
  for (const l of lines) {
    for (const m of l.matchAll(/(\d{1,3}[.,]\d{1,3})\s*(?:L|リットル|ﾘｯﾄﾙ)(?![a-z])/gi)) litCands.push({ v: Number(m[1].replace(',', '.')), w: 3 });
    if (/数量|給油量|油量|QTY/i.test(l)) {
      const m = l.match(/(\d{1,3}\.\d{1,3})/);
      if (m) litCands.push({ v: Number(m[1]), w: 4 });
    }
  }
  const lit = litCands.filter(c => c.v >= 0.5 && c.v <= 150).sort((a, b) => b.w - a.w)[0];
  if (lit) out.liters = lit.v;

  // 単価: 「164円/L」「@164」「単価 164.0」
  for (const l of lines) {
    let m = l.match(/(\d{2,3}(?:\.\d{1,2})?)\s*円?\s*\/\s*L/i) || l.match(/@\s*¥?(\d{2,3}(?:\.\d{1,2})?)/) || (/単価/.test(l) && l.match(/(\d{2,3}(?:\.\d{1,2})?)/));
    if (m) { const v = Number(m[1]); if (v >= 80 && v <= 400) { out.unit = v; break; } }
  }

  // 金額: 合計系の行を優先。小計・税・お預り・お釣りは除外
  const amountOf = l => {
    const ms = [...l.matchAll(/¥?\s*(\d{1,3}(?:,\d{3})+|\d{2,6})(?![\d.])/g)].map(m => toNum(m[1])).filter(v => v >= 100 && v <= 100000);
    return ms.length ? ms[ms.length - 1] : null;
  };
  const prio = [/合\s*計|お買上|お買い上げ|ご請求|請求額|現計|お支払|支払金額|ご利用額|利用金額|TOTAL/i, /金\s*額|油種計|小計/];
  const bad = /お預|預り|預かり|釣|ポイント|税|内税|消費税|対象|残高|値引/;
  outer: for (const re of prio) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!re.test(l) || bad.test(l)) continue;
      const v = amountOf(l) ?? (lines[i + 1] && !bad.test(lines[i + 1]) ? amountOf(lines[i + 1]) : null);
      if (v) { out.amount = v; break outer; }
    }
  }
  if (!out.amount) {
    const yenVals = [...text.matchAll(/¥\s*(\d{1,3}(?:,\d{3})+|\d{3,6})/g)].map(m => toNum(m[1])).filter(v => v >= 100 && v <= 100000);
    if (yenVals.length) out.amount = Math.max(...yenVals);
  }

  // 数字どうしで補完・検算（給油量×単価 ≒ 金額）
  if (!out.liters && out.amount && out.unit) out.liters = Math.round(out.amount / out.unit * 100) / 100;
  if (!out.amount && out.liters && out.unit) out.amount = Math.round(out.liters * out.unit);
  out.consistent = !!(out.amount && out.liters && out.unit) && Math.abs(out.liters * out.unit - out.amount) / out.amount < 0.05;

  // 日付: 2026/11/12, 2026年11月12日, 26/11/12, 令和8年11月12日
  let m = text.match(/(20\d{2})\s*[\/年.\-]\s*(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/);
  if (m) out.date = ymd(+m[1], +m[2], +m[3]);
  if (!out.date && (m = text.match(/(?:令和|R)\s*(\d{1,2})\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/))) out.date = ymd(2018 + +m[1], +m[2], +m[3]);
  if (!out.date && (m = text.match(/(?<!\d)(\d{2})\/(\d{1,2})\/(\d{1,2})(?!\d)/))) out.date = ymd(2000 + +m[1], +m[2], +m[3]);
  return out;
}
function ymd(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
