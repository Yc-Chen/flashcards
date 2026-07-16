/**
 * Flashcards — Google Sheets–backed Leitner web app.
 *
 * The bound spreadsheet is the database. One row per card in the `cards` tab.
 * All proficiency state lives in plain columns so it can be inspected / fixed
 * by hand in the sheet.
 */

// ---- Tunable constants -----------------------------------------------------

var SHEET_NAME = 'cards';

// Leitner boxes 1..5 and how many days until a card in each box is due again.
var BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };
var MAX_BOX = 5;

// "Already knew it" on a brand-new card jumps straight to this box.
var KNOWN_START_BOX = 4;

// How many never-studied cards to introduce per session.
var NEW_PER_SESSION = 10;

// How many weak (low-box) cards to serve in a schedule-neutral practice drill.
var PRACTICE_LIMIT = 20;

// Column order in the sheet. Keep in sync with the header row.
// front_side / back_side / notes all support Markdown.
// `flag`    holds a marker (FLAG_MARK) when you flag a card for later editing.
// `exclude` holds a marker (any non-empty value) to drop a card from practice.
var HEADERS = [
  'id', 'type', 'front_side', 'back_side', 'notes',
  'box', 'due', 'last_seen', 'right', 'wrong', 'added', 'flag', 'exclude'
];

// Value written to the `flag` column when a card is flagged for review/editing.
var FLAG_MARK = '⚑';
// Value written to the `exclude` column to remove a card from practice.
var EXCLUDE_MARK = 'x';

// Fields the client is allowed to edit / write back to the sheet.
var EDITABLE_FIELDS = ['front_side', 'back_side', 'notes', 'flag', 'exclude'];

// ---- Web app entry point ---------------------------------------------------

function doGet(e) {
  // One-off maintenance action: open <url>?action=seed to load the starter deck.
  if (e && e.parameter && e.parameter.action === 'seed') {
    return ContentService.createTextOutput(seedCards());
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Flashcards')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- Spreadsheet menu ------------------------------------------------------
// Runs when the bound Sheet is opened; adds a "🎴 Flashcards" menu so the deck
// can be seeded (and the app deployed) without touching the Apps Script editor.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎴 Flashcards')
    .addItem('Open the app ↗', 'menuOpenApp_')
    .addItem('Set app URL…', 'menuSetAppUrl_')
    .addSeparator()
    .addItem('Load starter deck', 'menuSeed_')
    .addItem('Reset & reload starter deck…', 'menuResetAndReseed_')
    .addSeparator()
    .addItem('How to deploy as an app', 'menuDeployHelp_')
    .addToUi();
}

/**
 * Resolves the web-app URL to open. Prefers the URL you saved via
 * "Set app URL…" (stored in Script Properties, so it points at YOUR stable
 * versioned deployment). Falls back to ScriptApp.getService().getUrl(), which
 * returns the HEAD deployment — a different /exec URL from a clasp-versioned
 * deployment, which is exactly why we let you pin the real one.
 */
function getWebAppUrl_() {
  var stored = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
  return (stored && stored.trim()) || ScriptApp.getService().getUrl() || '';
}

/** Menu: prompt for and save the canonical web-app URL. */
function menuSetAppUrl_() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var current = props.getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl() || '(none)';
  var resp = ui.prompt('Set app URL',
    'Paste the web-app URL you actually use — the .../exec link of your stable ' +
    'deployment (e.g. from your Home Screen icon).\n\nCurrently: ' + current,
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var url = resp.getResponseText().trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec\b/.test(url)) {
    ui.alert('Flashcards', 'That doesn\'t look like a /exec web-app URL, so it was not saved.', ui.ButtonSet.OK);
    return;
  }
  props.setProperty('WEBAPP_URL', url);
  ui.alert('Flashcards', 'Saved. "Open the app ↗" will now use this link.', ui.ButtonSet.OK);
}

/** Menu: pop a dialog with a link to this script's deployed web app. */
function menuOpenApp_() {
  var ui = SpreadsheetApp.getUi();
  var url = getWebAppUrl_();
  if (!url) {
    ui.alert('Flashcards',
      'No web-app URL yet. Deploy the script as a web app (see "How to deploy ' +
      'as an app"), then use "Set app URL…" to pin the link you use.',
      ui.ButtonSet.OK);
    return;
  }
  var safe = url.replace(/"/g, '&quot;');
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 4px">' +
      '<p style="margin:0 0 14px">Open the Flashcards app in a new tab:</p>' +
      '<p style="margin:0"><a href="' + safe + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;background:#4f8cff;color:#fff;text-decoration:none;' +
        'font-weight:700;padding:10px 16px;border-radius:10px">🎴 Open Flashcards ↗</a></p>' +
    '</div>'
  ).setWidth(300).setHeight(130);
  ui.showModalDialog(html, '🎴 Flashcards');
}

/** Menu: seed the starter deck (no-op if the sheet already has cards). */
function menuSeed_() {
  SpreadsheetApp.getUi().alert('Flashcards', seedCards(), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Menu: wipe the `cards` sheet and reload the starter deck (asks first). */
function menuResetAndReseed_() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Reset & reload starter deck',
    'This DELETES everything in the "cards" sheet and reloads the starter deck. Continue?',
    ui.ButtonSet.YES_NO);
  if (resp === ui.Button.YES) {
    ui.alert('Flashcards', resetAndReseed(), ui.ButtonSet.OK);
  }
}

/** Menu: show the one-time steps to deploy this Sheet's script as a web app. */
function menuDeployHelp_() {
  var msg =
    'Deploy this as a phone/laptop web app:\n\n' +
    '1. Extensions → Apps Script → Deploy → New deployment.\n' +
    '2. Type: Web app. Execute as: Me. Who has access: your choice\n' +
    '   (Only myself / Anyone). Click Deploy.\n' +
    '3. Authorize when prompted — it is your own script, so the\n' +
    '   "unverified app" warning is expected (Advanced → Go to …).\n' +
    '4. Copy the Web app URL. On iOS: Share → Add to Home Screen.\n\n' +
    'To load the starter deck, use the "Load starter deck" menu item above.';
  SpreadsheetApp.getUi().alert('Flashcards — how to deploy', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---- Sheet helpers ---------------------------------------------------------

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  // Make sure the header row exists even if the sheet was created empty.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  ensureSchema_(sheet);
  return sheet;
}

/**
 * Makes the sheet safe to read/write with the current HEADERS: guarantees at
 * least HEADERS.length columns exist and fills any missing header labels
 * (e.g. adds the `flag` column to a sheet imported before it existed).
 * Only fills EMPTY header cells, so it never clobbers a label you set.
 */
function ensureSchema_(sheet) {
  var need = HEADERS.length;
  if (sheet.getMaxColumns() < need) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
  }
  var header = sheet.getRange(1, 1, 1, need).getValues()[0];
  var changed = false;
  for (var i = 0; i < need; i++) {
    if (header[i] === '' || header[i] === null) { header[i] = HEADERS[i]; changed = true; }
  }
  if (changed) sheet.getRange(1, 1, 1, need).setValues([header]);
}

/** Reads all cards as objects, tagging each with its 1-based sheet row. */
function readCards_() {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sheet: sheet, cards: [] };

  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var cards = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue; // skip blank rows
    var card = {};
    for (var c = 0; c < HEADERS.length; c++) card[HEADERS[c]] = row[c];
    card._row = i + 2; // actual sheet row number
    cards.push(card);
  }
  return { sheet: sheet, cards: cards };
}

function todayStr_() {
  var tz = Session.getScriptTimeZone() || 'Europe/Amsterdam';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function addDaysStr_(days) {
  var tz = Session.getScriptTimeZone() || 'Europe/Amsterdam';
  var d = new Date();
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/** Normalizes whatever the sheet holds (Date or string) into 'yyyy-MM-dd'. */
function normDate_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var tz = Session.getScriptTimeZone() || 'Europe/Amsterdam';
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return String(v).slice(0, 10);
}

function isNew_(card) {
  return card.box === '' || card.box === null || card.box === undefined;
}

// ---- Public API (called from the client via google.script.run) -------------

/** Returns the cards due today + a batch of new cards, plus summary counts. */
function getSession() {
  var data = readCards_();
  var cards = data.cards;
  var today = todayStr_();

  var due = [];
  var newCards = [];
  var boxCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  var flaggedCount = 0;
  var excludedCount = 0;

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (String(card.exclude || '').trim() !== '') { excludedCount++; continue; } // dropped from practice
    if (String(card.flag || '').trim() !== '') flaggedCount++;
    if (isNew_(card)) {
      newCards.push(card);
      continue;
    }
    var box = Number(card.box);
    if (boxCounts[box] !== undefined) boxCounts[box]++;
    var dueDate = normDate_(card.due);
    if (!dueDate || dueDate <= today) due.push(card);
  }

  shuffle_(due);
  shuffle_(newCards);
  var newBatch = newCards.slice(0, NEW_PER_SESSION);

  // Payload the client needs — strip nothing, but shape it explicitly.
  var queue = due.concat(newBatch).map(toClientCard_);

  return {
    today: today,
    dueCount: due.length,
    newCount: newCards.length,
    newInSession: newBatch.length,
    totalCards: cards.length,
    activeCards: cards.length - excludedCount,
    boxCounts: boxCounts,
    flaggedCount: flaggedCount,
    excludedCount: excludedCount,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    queue: queue
  };
}

function toClientCard_(card) {
  return {
    row: card._row,
    id: card.id,
    type: card.type,
    front_side: card.front_side,
    back_side: card.back_side,
    notes: card.notes,
    flag: String(card.flag || '').trim(),
    box: isNew_(card) ? null : Number(card.box),
    isNew: isNew_(card)
  };
}

/**
 * Returns weak cards (lowest Leitner boxes first) for a schedule-neutral
 * practice drill. The client grades these purely to advance the queue — no
 * write happens, so box/due/right/wrong are never touched. Only already-started
 * cards are eligible (a brand-new card has no box); excluded cards are skipped.
 * @param {number} [limit] Max cards to return (defaults to PRACTICE_LIMIT).
 * @return {Object} { cards: [clientCard, ...] } sorted box 1 → up.
 */
function getWeakCards(limit) {
  var cards = readCards_().cards;
  var eligible = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (String(card.exclude || '').trim() !== '') continue; // dropped from practice
    if (isNew_(card)) continue;                              // never-studied, no box yet
    eligible.push(card);
  }
  // Shuffle first, then a stable sort by box gives variety within each box.
  shuffle_(eligible);
  eligible.sort(function (a, b) { return Number(a.box) - Number(b.box); });
  var cap = limit || PRACTICE_LIMIT;
  return { cards: eligible.slice(0, cap).map(toClientCard_) };
}

/**
 * Grades one card and writes the new state back immediately.
 * @param {number} row      1-based sheet row of the card.
 * @param {boolean} correct Whether the user got it right.
 * @return {Object} The updated box/due for optimistic UI confirmation.
 */
function gradeCard(row, correct) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var range = sheet.getRange(row, 1, 1, HEADERS.length);
    var values = range.getValues()[0];
    var card = {};
    for (var c = 0; c < HEADERS.length; c++) card[HEADERS[c]] = values[c];

    var wasNew = isNew_(card);
    var oldBox = wasNew ? 0 : Number(card.box);
    var newBox;

    if (wasNew) {
      // First encounter: "correct" == already knew it, "wrong" == didn't know.
      newBox = correct ? KNOWN_START_BOX : 1;
    } else if (correct) {
      newBox = Math.min(oldBox + 1, MAX_BOX);
    } else {
      newBox = 1;
    }

    var interval = BOX_INTERVALS[newBox] || 1;

    card.box = newBox;
    card.due = addDaysStr_(interval);
    card.last_seen = todayStr_();
    card.right = (Number(card.right) || 0) + (correct ? 1 : 0);
    card.wrong = (Number(card.wrong) || 0) + (correct ? 0 : 1);

    var out = [];
    for (var h = 0; h < HEADERS.length; h++) out.push(card[HEADERS[h]]);
    range.setValues([out]);

    return { row: row, box: newBox, due: card.due };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Edits one card's content and/or flag, writing straight back to the sheet.
 * Only whitelisted fields (front_side, back_side, notes, flag) are touched;
 * proficiency columns are never changed here.
 * @param {number} row     1-based sheet row of the card.
 * @param {Object} fields  Any subset of {front_side, back_side, notes, flag}.
 * @return {Object} { row, updated } echoing what was written.
 */
function updateCard(row, fields) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var updated = {};
    for (var i = 0; i < EDITABLE_FIELDS.length; i++) {
      var key = EDITABLE_FIELDS[i];
      if (fields && Object.prototype.hasOwnProperty.call(fields, key)) {
        var col = HEADERS.indexOf(key) + 1; // 1-based column
        var val = fields[key] == null ? '' : String(fields[key]);
        sheet.getRange(row, col).setValue(val);
        updated[key] = val;
      }
    }
    return { row: row, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

/** Toggles the flag marker on a card. Returns the new flag value. */
function toggleFlag(row, flagged) {
  return updateCard(row, { flag: flagged ? FLAG_MARK : '' });
}

// ---- Utilities -------------------------------------------------------------

function shuffle_(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/**
 * One-time helper: sets up the header row and (optionally) demo data.
 * Run manually from the Apps Script editor if you created the sheet by hand.
 */
function setupSheet() {
  var sheet = getSheet_();
  var header = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (header.join('') === '') {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return 'Sheet ready. Header: ' + HEADERS.join(', ');
}
