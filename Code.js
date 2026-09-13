/**
 * 単語帳 — Google Sheets をデータベースに使う日本語向けフラッシュカード。
 *
 * 1 行 = 1 カード。学習履歴もすべて `cards` シートに保存するため、
 * Mac / iPhone から同じ Web アプリを開けば同じ状態を共有できます。
 */

var APP_VERSION = '2.0.0-ja';
var SHEET_NAME = 'cards';

var HEADERS = [
  'id', 'type', 'front_side', 'back_side', 'notes',
  'box', 'due', 'last_seen', 'right', 'wrong', 'added', 'flag', 'exclude', 'last_wrong'
];

var BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
var MAX_BOX = 5;
var NEW_PER_SESSION = 10;
var SESSION_LIMIT = 50;
var PRACTICE_LIMIT = 20;
var ERROR_DRILL_LIMIT = 50;
var FLAG_MARK = '⚑';
var EXCLUDE_MARK = 'x';

var COL = {};
for (var i = 0; i < HEADERS.length; i++) COL[HEADERS[i]] = i + 1;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('単語帳')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
}

// -----------------------------------------------------------------------------
// Google Sheets メニュー
// -----------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎴 単語帳')
    .addItem('アプリを開く ↗', 'menuOpenApp_')
    .addSeparator()
    .addItem('シートを診断', 'menuCheckSheet_')
    .addItem('IDを振り直す', 'menuRenumberIds_')
    .addSeparator()
    .addItem('この単語帳について', 'menuAbout_')
    .addToUi();
}

function menuOpenApp_() {
  var ui = SpreadsheetApp.getUi();
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert(
      '🎴 単語帳',
      'まだ Web アプリとしてデプロイされていません。\n\nApps Script の「デプロイ」→「新しいデプロイ」から Web アプリとして公開してください。',
      ui.ButtonSet.OK
    );
    return;
  }

  var safeUrl = escapeHtmlAttribute_(url);
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;padding:10px">' +
      '<p style="margin:0 0 14px">単語帳を新しいタブで開きます。</p>' +
      '<a href="' + safeUrl + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;background:#4f8cff;color:#fff;text-decoration:none;' +
        'font-weight:700;padding:10px 16px;border-radius:10px">🎴 単語帳を開く ↗</a>' +
    '</div>'
  ).setWidth(320).setHeight(135);

  ui.showModalDialog(html, '🎴 単語帳');
}

function menuCheckSheet_() {
  SpreadsheetApp.getUi().alert(
    '🎴 シート診断',
    checkSheetHealth(),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function menuRenumberIds_() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    '🎴 IDを振り直す',
    'cards シートの id を上から 1, 2, 3… と振り直します。\n\n学習履歴やカード本文は変更しません。実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;
  ui.alert('🎴 IDを振り直す', renumberIds(), ui.ButtonSet.OK);
}

function menuAbout_() {
  SpreadsheetApp.getUi().alert(
    '🎴 単語帳',
    '日本語向け Flashcards v' + APP_VERSION + '\n\nカードと学習履歴は、この Google スプレッドシートだけに保存されます。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// -----------------------------------------------------------------------------
// 公開 API（Index.html から google.script.run で呼び出す）
// -----------------------------------------------------------------------------

function getSession() {
  var sheet = getSheet_();
  var cards = readCards_(sheet);
  var today = today_();

  var active = cards.filter(function (card) {
    return !card.exclude && card.front_side && card.back_side;
  });

  var due = active.filter(function (card) {
    return card.box !== '' && isDue_(card.due, today);
  });

  var fresh = active.filter(function (card) {
    return card.box === '';
  });

  due.sort(function (a, b) {
    return String(a.due || '').localeCompare(String(b.due || ''));
  });
  shuffle_(fresh);

  var queue = due.slice(0, SESSION_LIMIT);
  var room = Math.max(0, SESSION_LIMIT - queue.length);
  if (room > 0) queue = queue.concat(fresh.slice(0, Math.min(NEW_PER_SESSION, room)));

  var mistakesToday = active.filter(function (card) {
    return normalizeDate_(card.last_wrong) === today;
  }).length;

  var boxCounts = {};
  for (var box = 1; box <= MAX_BOX; box++) boxCounts[box] = 0;
  active.forEach(function (card) {
    var n = Number(card.box);
    if (n >= 1 && n <= MAX_BOX) boxCounts[n]++;
  });

  return {
    appVersion: APP_VERSION,
    today: today,
    queue: queue,
    counts: {
      total: active.length,
      due: due.length,
      fresh: fresh.length,
      mistakesToday: mistakesToday,
      flagged: active.filter(function (card) { return card.flag === FLAG_MARK; }).length,
      box: boxCounts
    },
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
  };
}

function getTodaysMistakes(limit) {
  var max = clampLimit_(limit, ERROR_DRILL_LIMIT);
  var today = today_();
  var cards = readCards_(getSheet_()).filter(function (card) {
    return !card.exclude && card.front_side && card.back_side &&
      normalizeDate_(card.last_wrong) === today;
  });
  shuffle_(cards);
  return cards.slice(0, max);
}

function getWeakCards(limit) {
  var max = clampLimit_(limit, PRACTICE_LIMIT);
  var cards = readCards_(getSheet_()).filter(function (card) {
    return !card.exclude && card.front_side && card.back_side && card.box !== '';
  });

  cards.forEach(function (card) {
    var right = Number(card.right) || 0;
    var wrong = Number(card.wrong) || 0;
    var attempts = right + wrong;
    var errorRate = attempts ? wrong / attempts : 0;
    var box = Number(card.box) || 1;
    card._weakScore = (errorRate * 100) + ((MAX_BOX - box) * 12) + Math.min(wrong, 10);
  });

  cards.sort(function (a, b) {
    return b._weakScore - a._weakScore;
  });

  return cards.slice(0, max).map(function (card) {
    delete card._weakScore;
    return card;
  });
}

/**
 * 通常学習ではスケジュールと正誤回数を更新します。
 * practice=true のときは「今日の間違い」「苦手カード」用の復習なので、
 * 学習スケジュールを変更しません。
 */
function gradeCard(rowNumber, correct, practice) {
  var row = validateRow_(rowNumber);
  if (practice) return { ok: true, practice: true };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    if (row > sheet.getLastRow()) throw new Error('カードの行が見つかりません。アプリを再読み込みしてください。');

    var values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    if (!String(values[COL.front_side - 1] || '').trim()) {
      throw new Error('この行にはカードがありません。アプリを再読み込みしてください。');
    }

    var currentBox = Number(values[COL.box - 1]) || 0;
    var newBox = correct ? Math.min(MAX_BOX, currentBox > 0 ? currentBox + 1 : 2) : 1;
    var today = today_();
    var due = addDays_(today, BOX_INTERVALS[newBox]);
    var right = Number(values[COL.right - 1]) || 0;
    var wrong = Number(values[COL.wrong - 1]) || 0;

    sheet.getRange(row, COL.box).setValue(newBox);
    sheet.getRange(row, COL.due).setValue(due);
    sheet.getRange(row, COL.last_seen).setValue(today);

    if (correct) {
      sheet.getRange(row, COL.right).setValue(right + 1);
    } else {
      sheet.getRange(row, COL.wrong).setValue(wrong + 1);
      sheet.getRange(row, COL.last_wrong).setValue(today);
    }

    return { ok: true, box: newBox, due: due };
  } finally {
    lock.releaseLock();
  }
}

function updateCard(rowNumber, patch) {
  var row = validateRow_(rowNumber);
  patch = patch || {};
  var allowed = ['front_side', 'back_side', 'notes', 'flag', 'exclude'];

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    if (row > sheet.getLastRow()) throw new Error('カードの行が見つかりません。アプリを再読み込みしてください。');

    allowed.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
      var value = patch[key] == null ? '' : String(patch[key]);
      var range = sheet.getRange(row, COL[key]);
      // `=`, `+`, `-`, `@` で始まる内容が数式として解釈されないよう、
      // 編集可能なテキスト列は明示的にプレーンテキスト形式へ固定します。
      range.setNumberFormat('@');
      range.setValue(value);
    });

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function checkSheetHealth() {
  var sheet = getSheet_();
  var width = Math.min(sheet.getMaxColumns(), HEADERS.length);
  var got = sheet.getRange(1, 1, 1, width).getValues()[0];
  var problems = [];

  for (var i = 0; i < HEADERS.length; i++) {
    var actual = i < got.length ? String(got[i] || '').trim() : '';
    if (actual !== HEADERS[i]) {
      problems.push('列 ' + columnName_(i + 1) + ': 「' + (actual || '空欄') + '」→ 正しくは「' + HEADERS[i] + '」');
    }
  }

  if (problems.length) {
    return '❌ cards シートの列名または順番に問題があります。\n\n' + problems.join('\n');
  }

  return '✅ 問題ありません。\n\ncards シートの列名と順番は正しい状態です。';
}

function renumberIds() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 'カードがありません。';

    var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    var ids = [];
    var next = 0;

    values.forEach(function (row) {
      var blank = row.every(function (cell) { return cell === '' || cell === null; });
      ids.push([blank ? '' : ++next]);
    });

    sheet.getRange(2, COL.id, ids.length, 1).setValues(ids);
    return next + ' 件のカードを 1〜' + next + ' に振り直しました。';
  } finally {
    lock.releaseLock();
  }
}

// -----------------------------------------------------------------------------
// シート読み書き
// -----------------------------------------------------------------------------

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  ensureSchema_(sheet);
  return sheet;
}

function ensureSchema_(sheet) {
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }

  var row = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var completelyBlank = row.every(function (value) { return value === '' || value === null; });

  if (completelyBlank) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  var changed = false;
  for (var i = 0; i < HEADERS.length; i++) {
    if (row[i] === '' || row[i] === null) {
      row[i] = HEADERS[i];
      changed = true;
    }
  }
  if (changed) sheet.getRange(1, 1, 1, HEADERS.length).setValues([row]);
}

function readCards_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var cards = [];

  for (var r = 0; r < rows.length; r++) {
    var values = rows[r];
    var card = { _row: r + 2 };
    var hasData = false;

    for (var c = 0; c < HEADERS.length; c++) {
      var key = HEADERS[c];
      var value = values[c];
      if (value !== '' && value !== null) hasData = true;
      card[key] = serializeCell_(key, value);
    }

    if (hasData) cards.push(card);
  }

  return cards;
}

function serializeCell_(key, value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (key === 'right' || key === 'wrong' || key === 'box') {
    if (value === '' || value === null) return '';
    return Number(value) || 0;
  }
  return value == null ? '' : String(value);
}

// -----------------------------------------------------------------------------
// 日付・ユーティリティ
// -----------------------------------------------------------------------------

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizeDate_(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var text = String(value).trim();
  var match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return text;
  return match[1] + '-' + ('0' + match[2]).slice(-2) + '-' + ('0' + match[3]).slice(-2);
}

function addDays_(iso, days) {
  var parts = iso.split('-').map(Number);
  var date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + Number(days || 0));
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function isDue_(due, today) {
  var normalized = normalizeDate_(due);
  return !normalized || normalized <= today;
}

function shuffle_(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function clampLimit_(value, fallback) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), fallback);
}

function validateRow_(value) {
  var row = Number(value);
  if (!isFinite(row) || row < 2 || Math.floor(row) !== row) {
    throw new Error('不正なカード行です。');
  }
  return row;
}

function columnName_(number) {
  var result = '';
  var n = number;
  while (n > 0) {
    var rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function escapeHtmlAttribute_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
