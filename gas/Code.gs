/**
 * JB7 ランニングコスト 同期サーバー（Google Apps Script）
 * 設定手順は SETUP.md を参照。
 * スクリプトプロパティ TOKEN に、アプリの設定画面と同じ「合言葉」を登録すること。
 */
const SHEET_NAME = 'records';
const COLS = ['id', 'type', 'date', 'title', 'amount', 'odo', 'liters', 'full', 'note', 'group', 'extra', 'updatedAt', 'deleted'];
const TEXT_COLS = ['id', 'type', 'date', 'title', 'note', 'group', 'extra'];

function doGet() {
  return json_({ ok: true, app: 'jb7-running-cost' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || body.token !== token) return json_({ ok: false, error: 'unauthorized' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const values = sh.getDataRange().getValues();
    const rows = values.slice(1);            // 1行目は見出し
    const index = {};
    rows.forEach((row, i) => { index[String(row[0])] = i; });

    let dirty = false;
    (body.changes || []).forEach(rec => {
      if (!rec || !rec.id) return;
      const row = toRow_(rec);
      const i = index[String(rec.id)];
      if (i === undefined) {
        index[String(rec.id)] = rows.length;
        rows.push(row);
        dirty = true;
      } else if (Number(rows[i][COLS.indexOf('updatedAt')]) < Number(rec.updatedAt || 0)) {
        rows[i] = row;
        dirty = true;
      }
    });

    if (dirty && rows.length) {
      const need = rows.length + 1 - sh.getMaxRows();
      if (need > 0) {
        sh.insertRowsAfter(sh.getMaxRows(), need + 200);
        setTextFormat_(sh);
      }
      sh.getRange(2, 1, rows.length, COLS.length).setValues(rows);
    }
    const records = rows.map(fromRow_);
    return json_({ ok: true, records: records, serverTime: Date.now() });
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    setTextFormat_(sh);
  }
  return sh;
}

// 日付やIDが自動変換されないよう文字列書式にする
function setTextFormat_(sh) {
  TEXT_COLS.forEach(c => {
    const col = COLS.indexOf(c) + 1;
    sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

function toRow_(r) {
  return COLS.map(c => {
    const v = r[c];
    if (c === 'extra') return JSON.stringify(v || {});
    if (c === 'full' || c === 'deleted') return v === true || v === 'true';
    if (v === null || v === undefined) return '';
    return v;
  });
}

function fromRow_(row) {
  const o = {};
  COLS.forEach((c, i) => { o[c] = row[i]; });
  // 文字列書式でないシートで日付が Date 型になった場合の保険
  if (o.date instanceof Date) o.date = Utilities.formatDate(o.date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return o;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 動作確認用: エディタから実行するとシートを作成する */
function setup() {
  sheet_();
  if (!PropertiesService.getScriptProperties().getProperty('TOKEN')) {
    Logger.log('スクリプトプロパティ TOKEN を設定してください');
  }
}
