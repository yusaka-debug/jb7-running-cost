// 添付ファイル（PDF・写真）。本体は端末の IndexedDB、記録には extra.files = [{id,name,mime,size,driveId}] だけを持つ
import { uid } from './data.js';
import { fileToCanvas } from './receipt.js';

const DB_NAME = 'jb7rc-files';
const MAX_PDF = 15 * 1024 * 1024;
const DEL_KEY = 'jb7rc.fileDel';   // スプレッドシート側（Drive）で消す予定の driveId

let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('保存できませんでした（空き容量を確認してください）'));
  }));
}
export const putBlob = (id, blob) => tx('readwrite', s => s.put({ id, blob }));
export const getBlob = id => tx('readonly', s => s.get(id)).then(r => r?.blob || null);
export const delBlob = id => tx('readwrite', s => s.delete(id));

export const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
export const isImage = f => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '');

/** 選ばれたファイルを保存用に整えて IndexedDB に入れ、メタ情報を返す。写真は長辺2000pxのJPEGに縮小 */
export async function storeFile(file) {
  let blob = file, mime = file.type, name = file.name || 'file';
  if (isPdf(file)) {
    if (file.size > MAX_PDF) throw new Error(`PDF が大きすぎます（${Math.round(file.size / 1048576)}MB）。15MB までにしてください`);
    mime = 'application/pdf';
  } else if (isImage(file)) {
    const c = await fileToCanvas(file, 2000);
    blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    mime = 'image/jpeg';
    name = name.replace(/\.(heic|heif|png|webp)$/i, '.jpg');
  } else {
    throw new Error('PDF か写真を選んでください');
  }
  const meta = { id: 'f-' + uid(), name, mime, size: blob.size };
  await putBlob(meta.id, blob);
  return meta;
}

export function queueDriveDelete(driveId) {
  if (!driveId) return;
  const list = pendingDriveDeletes();
  if (!list.includes(driveId)) list.push(driveId);
  try { localStorage.setItem(DEL_KEY, JSON.stringify(list)); } catch {}
}
export function pendingDriveDeletes() {
  try { return JSON.parse(localStorage.getItem(DEL_KEY) || '[]'); } catch { return []; }
}
export function clearDriveDelete(driveId) {
  try { localStorage.setItem(DEL_KEY, JSON.stringify(pendingDriveDeletes().filter(x => x !== driveId))); } catch {}
}

/** 記録から外したファイルを片付ける（端末から削除、Drive は次の同期でゴミ箱へ） */
export async function discardFiles(list = []) {
  for (const f of list) {
    await delBlob(f.id).catch(() => {});
    queueDriveDelete(f.driveId);
  }
}

export const fmtSize = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
export function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
