/**
 * Flashcards update-check collector — MAINTAINER-ONLY.
 *
 * This is NOT part of the app and is never pushed to user copies (both
 * .claspignore files are whitelist-only). It is the endpoint the app's
 * checkForUpdate_() in Index.html calls once a day: it answers "what is the
 * latest version?" and, as a side effect, logs the ping so the author can
 * count active users. Deploy steps + how to read the numbers: README.md
 * in this directory.
 *
 * Bound to its own PRIVATE Google Sheet, which holds:
 *  - `pings`    — one row per ping: timestamp, date, app version, install id.
 *  - `settings` — key/value rows: latest_version, release_url. Edit these
 *                 cells to announce a release; no redeploy needed.
 *
 * What a ping contains: an app version string and a random install id the
 * app made up locally. Apps Script does not expose the caller's IP or any
 * account identity to this script, so there is nothing more to log even by
 * accident.
 */

var PINGS_SHEET = 'pings';
var PINGS_HEADERS = ['ts', 'date', 'version', 'install_id'];

var SETTINGS_SHEET = 'settings';
var SETTINGS_HEADERS = ['key', 'value', 'description'];
var SETTINGS_DEFAULTS = [
  ['latest_version', '1.0.0',
    'The newest released app version. Bump this (to match APP_VERSION in the repo\'s Code.js) when you release — every copy older than this shows the update hint.'],
  ['release_url', 'https://github.com/Yc-Chen/flashcards/blob/main/UPGRADE.md',
    'Where the update hint links to.']
];

/**
 * GET /exec?v=<app version>&id=<random install id>
 * Always answers { latest, url }, even if logging fails — the version check
 * is the user-facing feature, counting is the side effect.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var version = String(p.v || '').slice(0, 24);
  var id = String(p.id || '').slice(0, 64);
  try {
    logPing_(version, id);
  } catch (err) {
    // Never let a logging hiccup break the version answer.
  }
  var s = readSettings_();
  return ContentService
    .createTextOutput(JSON.stringify({ latest: s.latest_version, url: s.release_url }))
    .setMimeType(ContentService.MimeType.JSON);
}

function logPing_(version, id) {
  // Concurrent pings racing appendRow can interleave; skip logging rather
  // than stall the response when the sheet is busy.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    var sheet = getOrCreateSheet_(PINGS_SHEET, PINGS_HEADERS);
    var now = new Date();
    sheet.appendRow([now, Utilities.formatDate(now, 'UTC', 'yyyy-MM-dd'), version, id]);
  } finally {
    lock.releaseLock();
  }
}

function readSettings_() {
  var out = {};
  for (var i = 0; i < SETTINGS_DEFAULTS.length; i++) out[SETTINGS_DEFAULTS[i][0]] = SETTINGS_DEFAULTS[i][1];
  var sheet = getOrCreateSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  ensureSettingsRows_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var r = 0; r < values.length; r++) {
    var key = String(values[r][0]).trim();
    if (key) out[key] = String(values[r][1]).trim();
  }
  return out;
}

/** Appends any SETTINGS_DEFAULTS key missing from the tab; never overwrites. */
function ensureSettingsRows_(sheet) {
  var have = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) have[String(keys[i][0]).trim()] = true;
  }
  var missing = [];
  for (var d = 0; d < SETTINGS_DEFAULTS.length; d++) {
    if (!have[SETTINGS_DEFAULTS[d][0]]) missing.push(SETTINGS_DEFAULTS[d]);
  }
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, SETTINGS_HEADERS.length)
      .setValues(missing);
  }
}

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
