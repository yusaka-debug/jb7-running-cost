// 同期設定（URL・合言葉）を QR コードで別の端末へ渡す
// QR の中身は「このアプリの URL#sync&u=…&t=…」。# 以降はサーバーへ送られないので、合言葉が外部に出ることはない
import { fileToCanvas } from './receipt.js';

const QRGEN_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

const loaders = {};
function loadScript(src, name) {
  if (window[name]) return Promise.resolve(window[name]);
  loaders[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window[name]);
    s.onerror = () => { delete loaders[src]; reject(new Error('QR コードの部品を取得できません（オンラインで再試行してください）')); };
    document.head.appendChild(s);
  });
  return loaders[src];
}

const appBase = () => location.origin + location.pathname;

/** 同期設定を入れたリンク */
export function syncLink(url, token) {
  const p = new URLSearchParams({ u: url, t: token });
  return `${appBase()}#sync&${p.toString()}`;
}

/** リンク（または #sync&… の部分）から {url, token} を取り出す。無ければ null */
export function parseSyncLink(text) {
  const s = String(text || '');
  const i = s.indexOf('#sync');
  if (i < 0) return null;
  const p = new URLSearchParams(s.slice(i + 5).replace(/^&/, ''));
  const url = (p.get('u') || '').trim(), token = (p.get('t') || '').trim();
  return url && token ? { url, token } : null;
}

/** QR コードの SVG 文字列 */
export async function qrSvg(text) {
  const qrcode = await loadScript(QRGEN_URL, 'qrcode');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

// 画像（canvas / video）の一部を切り出して縮小し、QR を探す
function decodeRegion(jsQR, src, sw, sh, frac, target, invert = 'attemptBoth') {
  const cw = sw * frac, ch = sh * frac;
  const sx = (sw - cw) / 2, sy = (sh - ch) / 2;
  const scale = Math.min(1, target / Math.max(cw, ch));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * scale)); c.height = Math.max(1, Math.round(ch * scale));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, cw, ch, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: invert })?.data || null;
}

/** 写真（画像ファイル）から QR コードを読み取り、中身の文字列を返す */
export async function readQrFromFile(file) {
  const jsQR = await loadScript(JSQR_URL, 'jsQR');
  const big = await fileToCanvas(file, 2600);
  // 画面を撮った写真は QR が小さく写ったり、モアレが出たりするので、切り出し範囲と大きさを変えて何度か試す
  for (const frac of [1, 0.7, 0.45]) {
    for (const target of [800, 1200, 1700]) {
      const text = decodeRegion(jsQR, big, big.width, big.height, frac, target);
      if (text) return text;
      await new Promise(r => setTimeout(r));   // 画面が固まらないように
    }
  }
  throw new Error('QR コードが見つかりません。QR コードが画面いっぱいに、ピントが合うように撮り直してください');
}

export const cameraAvailable = () => !!navigator.mediaDevices?.getUserMedia;

/**
 * カメラ映像から QR を探し続ける。見つかったら onFound(text)。
 * 戻り値の stop() でカメラを止める。カメラが使えないときは例外
 */
export async function scanWithCamera(video, onFound) {
  const jsQR = await loadScript(JSQR_URL, 'jsQR');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  let stopped = false, timer = null;
  const stop = () => { stopped = true; clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  const tick = () => {
    if (stopped) return;
    if (video.videoWidth) {
      const w = video.videoWidth, hh = video.videoHeight;
      const text = decodeRegion(jsQR, video, w, hh, 1, 720, 'dontInvert') || decodeRegion(jsQR, video, w, hh, 0.6, 600, 'dontInvert');
      // onFound が false を返したとき（別の QR など）は少し待って探し直す
      if (text) { if (onFound(text) !== false) return; timer = setTimeout(tick, 1500); return; }
    }
    timer = setTimeout(tick, 120);
  };
  tick();
  return stop;
}
