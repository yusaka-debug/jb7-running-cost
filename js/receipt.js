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

// 画像ファイルを最大 maxSide px の canvas に描く
export async function fileToCanvas(file, maxSide = 2000, minSide = 0) {
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
  // 小さい画像は文字認識のために拡大（最大2.5倍）
  const long = Math.max(w0, h0);
  const scale = long > maxSide ? maxSide / long : (minSide && long < minSide ? Math.min(2.5, minSide / long) : 1);
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return c;
}

// 写真を縮小・グレースケール化・コントラスト強調して認識しやすくする
async function preprocess(file) {
  return enhance(await fileToCanvas(file, 2000));
}
function enhance(c) {
  const w = c.width, h = c.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
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

/** 画像ファイルまたは canvas を文字認識して文字列を返す。 */
// psm: 文字の並びの解析方法。'6'=1つの文字ブロック（tesseract.js の既定。レシート向き）、'4'=表を含む1段組の文書（整備明細など）向き
export async function ocr(source, onProgress = () => {}, psm = '6') {
  progressCb = onProgress;
  onProgress(0, '準備中');
  const canvas = source instanceof HTMLCanvasElement ? enhance(source) : await preprocess(source);
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(canvas);
  return data.text;
}

export async function readReceipt(file, onProgress = () => {}) {
  const text = await ocr(file, onProgress);
  return { ...parseReceipt(text), text };
}

// ---------- 文字列から値を取り出す ----------
export function normalize(text) {
  // NFKC: PDF に多い部首文字（⽇⽉⾦ など）や半角カナ・全角英数を普通の文字に揃える
  return text.normalize('NFKC')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 日本語の文字間に入った空白（「数 量」など）を詰める
    .replace(/([^\x00-\x7F])[ \t]+(?=[^\x00-\x7F])/g, '$1').replace(/([^\x00-\x7F])[ \t]+(?=[^\x00-\x7F])/g, '$1')
    .replace(/[，、]/g, ',').replace(/[．。]/g, '.').replace(/[￥\\]/g, '¥').replace(/[ℓ]/g, 'L').replace(/[：]/g, ':').replace(/[／]/g, '/')
    // 数字の間に入った余計な空白（OCRでよく起きる）を詰める
    .replace(/(\d)[ \t]+(?=[,.]\d)/g, '$1').replace(/(\d[,.])[ \t]+(?=\d)/g, '$1')
    .replace(/[ \t]+/g, ' ');
}
const toNum = s => Number(String(s).replace(/[,.](?=\d{3}(?!\d))/g, '').replace(/,/g, ''));

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
  out.amount = pickTotal(lines, [/合\s*計|お買上|お買い上げ|ご請求|請求額|現計|お支払|支払金額|ご利用額|利用金額|TOTAL/i, /金\s*額|油種計|小計/]);

  // 数字どうしで補完・検算（給油量×単価 ≒ 金額）
  if (!out.liters && out.amount && out.unit) out.liters = Math.round(out.amount / out.unit * 100) / 100;
  if (!out.amount && out.liters && out.unit) out.amount = Math.round(out.liters * out.unit);
  out.consistent = !!(out.amount && out.liters && out.unit) && Math.abs(out.liters * out.unit - out.amount) / out.amount < 0.05;

  out.date = findDate(text);
  return out;
}

/** 行の最後にある金額（100〜max 円） */
export function amountOf(l, max = 100000) {
  // 「22.869」のように桁区切りがピリオドに化けたものも金額として扱う
  const ms = [...l.matchAll(/¥?\s*(\d{1,3}(?:[,.]\d{3})+|\d{2,7})(?![\d.,])/g)].map(m => toNum(m[1])).filter(v => v >= 100 && v <= max);
  return ms.length ? ms[ms.length - 1] : null;
}

/** 合計系の行から金額を拾う。prio は優先順の正規表現 */
export function pickTotal(lines, prio, max = 100000) {
  const bad = /お預|預り|預かり|釣|ポイント|税|内税|消費税|対象|残高|値引/;
  for (const re of prio) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!re.test(l) || bad.test(l)) continue;
      const v = amountOf(l, max) ?? (lines[i + 1] && !bad.test(lines[i + 1]) ? amountOf(lines[i + 1], max) : null);
      if (v) return v;
    }
  }
  const yenVals = lines.join('\n').match(/¥\s*(\d{1,3}(?:,\d{3})+|\d{3,7})/g)?.map(s => toNum(s.replace(/[¥\s]/g, ''))).filter(v => v >= 100 && v <= max) || [];
  return yenVals.length ? Math.max(...yenVals) : null;
}

/** 日付: 2026/11/12, 2026年11月12日, 26/11/12, 令和8年11月12日 */
export function findDate(text) {
  let m = text.match(/(20\d{2})\s*[\/年.\-]\s*(\d{1,2})\s*[\/月.\-]\s*(\d{1,2})/);
  let d = m ? ymd(+m[1], +m[2], +m[3]) : null;
  if (!d && (m = text.match(/(?:令和|R)\s*(\d{1,2})\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/))) d = ymd(2018 + +m[1], +m[2], +m[3]);
  if (!d && (m = text.match(/(?<!\d)(\d{2})\/(\d{1,2})\/(\d{1,2})(?!\d)/))) d = ymd(2000 + +m[1], +m[2], +m[3]);
  return d;
}
function ymd(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
