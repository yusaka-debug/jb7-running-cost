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

/** 写真（画像ファイル）から QR コードを読み取り、中身の文字列を返す */
export async function readQrFromFile(file) {
  const jsQR = await loadScript(JSQR_URL, 'jsQR');
  // 大きすぎると遅く、小さすぎると読めないので 2 段階で試す
  for (const side of [1200, 2000]) {
    const c = await fileToCanvas(file, side);
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (res?.data) return res.data;
  }
  throw new Error('QR コードが見つかりません。QR コードが画面いっぱいに、ピントが合うように撮り直してください');
}
