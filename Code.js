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

// Columns resetForFork wipes: everything the app writes as you study.
// `exclude` is deliberately not here — it marks cards as bad, which is deck
// curation worth inheriting, not personal progress.
var PROGRESS_FIELDS = ['box', 'due', 'last_seen', 'right', 'wrong', 'flag'];

// ---- Config tab ------------------------------------------------------------
// A second tab holds user settings as key/value rows. It exists so that using
// this app for another language means editing one cell — not editing code and
// pushing it. Someone who copied the Sheet may never open the Apps Script
// editor at all.

var CONFIG_SHEET_NAME = 'config';
var CONFIG_HEADERS = ['key', 'value', 'description'];

// key, default value, description. The description column is the only
// documentation a Sheet-copier is guaranteed to see, so it has to stand alone.
var DEFAULT_CONFIG = [
  ['target_language', 'nl-NL',
    'The language you are studying. BCP-47 tag, e.g. nl-NL, zh-CN, fr-FR, de-DE.'],
  ['speech_rate', '0.9',
    'Speaking speed. 0.5 = slow, 1 = normal.'],
  ['auto_speak', 'yes',
    'Speak the example sentence when you reveal an answer? yes / no'],
  ['autoplay_speak', 'translate',
    'Hands-free autoplay: "translate" (word, then meaning, then example) or "target" (word + example only).'],
  ['native_language', '',
    'Your own language, for spoken meanings in hands-free translate mode. Blank = use the device language.'],
  ['update_check', 'yes',
    'Check for app updates on startup? Sends one anonymous ping a day (random id + app version, nothing else) that also lets the author count active users. yes / no'],
  ['webapp_url', '',
    'The /exec link of your own deployment. Leave blank to auto-detect.']
];

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
    .addSeparator()
    .addItem('Load starter deck', 'menuSeed_')
    .addItem('Reset & reload starter deck…', 'menuResetAndReseed_')
    .addSeparator()
    .addItem('View on GitHub ↗', 'menuGitHub_')
    .addToUi();
}

/**
 * Resolves the web-app URL to open. Prefers `webapp_url` from the config tab,
 * which points at YOUR stable versioned deployment. Falls back to
 * ScriptApp.getService().getUrl(), which returns the HEAD deployment — a
 * different /exec URL from a clasp-versioned one, which is exactly why the cell
 * is worth pinning.
 *
 * The fallback is also what makes a copied Sheet work: `resetForFork` blanks
 * the cell, so a fork resolves to its own deployment rather than the original's.
 */
function getWebAppUrl_() {
  var stored = readConfig_().webapp_url;
  return (stored && stored.trim()) || ScriptApp.getService().getUrl() || '';
}

/** Menu: pop a dialog with a link to this script's deployed web app. */
function menuOpenApp_() {
  var ui = SpreadsheetApp.getUi();
  var url = getWebAppUrl_();
  if (!url) {
    ui.alert('Flashcards',
      'No web-app URL yet. Deploy the script as a web app, then paste the /exec ' +
      'link into the `webapp_url` row of the "config" tab. Full deploy steps are ' +
      'in the GitHub repo (see "View on GitHub ↗").',
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

/** Menu: pop a dialog with a link to the project's GitHub repo (setup + source). */
function menuGitHub_() {
  var url = 'https://github.com/Yc-Chen/flashcards';
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 4px">' +
      '<p style="margin:0 0 14px">Source code, setup and deploy instructions:</p>' +
      '<p style="margin:0"><a href="' + url + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;background:#4f8cff;color:#fff;text-decoration:none;' +
        'font-weight:700;padding:10px 16px;border-radius:10px">View on GitHub ↗</a></p>' +
    '</div>'
  ).setWidth(320).setHeight(130);
  SpreadsheetApp.getUi().showModalDialog(html, '🎴 Flashcards');
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

// ---- Config helpers --------------------------------------------------------
// Deliberately parallel to getSheet_/ensureSchema_ rather than a generalization
// of them: getSheet_ is hardcoded to `cards` and five files (including the
// one-off maintenance scripts) depend on that exact signature.

function getConfigSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  // Insert at the end so `cards` stays the tab you land on.
  if (!sheet) sheet = ss.insertSheet(CONFIG_SHEET_NAME, ss.getNumSheets());
  ensureConfigSchema_(sheet);
  return sheet;
}

/**
 * Self-heals the config tab the way ensureSchema_ does for `cards`: writes the
 * header if absent and appends any DEFAULT_CONFIG key that isn't there yet, so
 * a newly added setting shows up without the user recreating the tab.
 * Never overwrites a value that is already set.
 */
function ensureConfigSchema_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([CONFIG_HEADERS]);
    sheet.setFrozenRows(1);
    // At the default 100px, `value` truncates a /exec URL and `description` —
    // the only documentation a Sheet-copier is guaranteed to see — is unreadable.
    sheet.setColumnWidth(2, 320);
    sheet.setColumnWidth(3, 460);
  }
  var have = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) have[String(keys[i][0]).trim()] = true;
  }
  var missing = [];
  for (var d = 0; d < DEFAULT_CONFIG.length; d++) {
    var key = DEFAULT_CONFIG[d][0];
    if (!have[key]) missing.push([key, seedConfigValue_(d), DEFAULT_CONFIG[d][2]]);
  }
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, CONFIG_HEADERS.length)
      .setValues(missing);
  }
}

/**
 * The value to seed a config key with when it first appears in the tab.
 *
 * Everything takes its DEFAULT_CONFIG default except `webapp_url`: before this
 * tab existed a pinned URL lived in Script Properties, so carry that across
 * instead of silently dropping it. Script Properties do NOT travel with a Sheet
 * copy but cells do, which is exactly why `resetForFork` exists.
 */
function seedConfigValue_(index) {
  var key = DEFAULT_CONFIG[index][0];
  var def = DEFAULT_CONFIG[index][1];
  if (key === 'webapp_url' && !def) {
    var legacy = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
    if (legacy && legacy.trim()) return legacy.trim();
  }
  return def;
}

/**
 * Reads the config tab into a plain object, filling in defaults for anything
 * missing.
 *
 * This never throws, which breaks the rule everywhere else in this file. Other
 * server functions let exceptions reach the client's failure handler, which
 * swaps the whole UI for the error screen — right for card data, wrong for a
 * speech setting. A typo in a config cell must not take the app down.
 */
function readConfig_() {
  var cfg = {};
  for (var i = 0; i < DEFAULT_CONFIG.length; i++) cfg[DEFAULT_CONFIG[i][0]] = DEFAULT_CONFIG[i][1];
  try {
    var sheet = getConfigSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return cfg;
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var r = 0; r < values.length; r++) {
      var key = String(values[r][0]).trim();
      if (key) cfg[key] = String(values[r][1]).trim();
    }
  } catch (err) {
    // Defaults are already in place — a broken config tab must not break the app.
  }
  return cfg;
}

// Config keys the app UI may write. `webapp_url` is deliberately excluded — it
// is deploy/fork plumbing, and letting the in-app Settings screen change it would
// be a footgun (point your own app at nowhere). It stays Sheet-only.
var CLIENT_CONFIG_KEYS = ['target_language', 'speech_rate', 'auto_speak', 'autoplay_speak',
  'native_language', 'update_check'];

/**
 * Writes one setting from the app's Settings screen. Whitelisted so the client
 * can only touch known preference keys, never arbitrary cells.
 * @return {Object} { key, value } as written.
 */
function setConfig(key, value) {
  if (CLIENT_CONFIG_KEYS.indexOf(key) === -1) {
    throw new Error('Not a settable config key: ' + key);
  }
  var val = String(value == null ? '' : value).trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    writeConfigValue_(key, val);
  } finally {
    lock.releaseLock();
  }
  return { key: key, value: val };
}

/** Writes one config value, appending the row if the key isn't there yet. */
function writeConfigValue_(key, value) {
  var sheet = getConfigSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sheet.appendRow([key, value, '']);
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
    // Same spreadsheet, but deep-linked to the `cards` tab via its gid. Used for
    // the "open the Sheet" links — landing on `cards` matters for import, where
    // "Append to current sheet" targets whatever tab happens to be active.
    cardsUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + data.sheet.getSheetId(),
    // Settings from the `config` tab. The client caches this for the page's
    // lifetime, which is why getWeakCards() doesn't need to return it too.
    config: readConfig_(),
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
 * Cards for the hands-free autoplay drill: every active (non-excluded) card,
 * shuffled. Unlike getWeakCards this includes brand-new cards — listening is
 * exactly when you want exposure to words you haven't studied yet. Purely for
 * playback; nothing is written. The client re-calls this each loop for a fresh
 * shuffle, so a cap keeps the payload sane on a big deck.
 * @param {number} [limit] Max cards to return (defaults to 200).
 * @return {Object} { cards: [clientCard, ...] } shuffled.
 */
function getAutoplayCards(limit) {
  var cards = readCards_().cards.filter(function (c) {
    return String(c.exclude || '').trim() === '';
  });
  shuffle_(cards);
  var cap = limit || 200;
  return { cards: cards.slice(0, cap).map(toClientCard_) };
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
 * Makes a freshly-copied Sheet genuinely the copier's own. Run once, by hand
 * from the Apps Script editor (Extensions → Apps Script → select resetForFork →
 * Run), after copying a template. No longer surfaced in the 🎴 menu — copiers
 * are guided to edit the Sheet directly (see README) — but kept as a shortcut.
 *
 * Copying a Sheet copies its cells, so a fork inherits both the original's
 * `webapp_url` (pointing "Open the app ↗" at someone else's deployment, which
 * they cannot open) and whatever study progress the template shipped with. This
 * clears both. Cards, `target_language` and the rest of the config survive.
 *
 * Idempotent — running it twice is harmless.
 */
function resetForFork() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    writeConfigValue_('webapp_url', '');

    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    var cleared = 0;
    if (lastRow > 1) {
      // One bulk read + one bulk write: per-cell writes time out on a deck of
      // a few thousand cards.
      var range = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
      var values = range.getValues();
      for (var r = 0; r < values.length; r++) {
        var row = values[r];
        if (row.every(function (c) { return c === '' || c === null; })) continue; // blank row
        for (var f = 0; f < PROGRESS_FIELDS.length; f++) {
          row[HEADERS.indexOf(PROGRESS_FIELDS[f])] = '';
        }
        cleared++;
      }
      range.setValues(values);
    }
    return 'This copy is now yours. Cleared the saved app URL and reset progress on ' +
      cleared + ' card' + (cleared === 1 ? '' : 's') + '.';
  } finally {
    lock.releaseLock();
  }
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
