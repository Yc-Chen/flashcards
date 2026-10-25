/**
 * Flashcards — Google Sheets–backed Leitner web app.
 *
 * The bound spreadsheet is the database. One row per card in the `cards` tab.
 * All proficiency state lives in plain columns so it can be inspected / fixed
 * by hand in the sheet.
 */

// ---- Tunable constants -----------------------------------------------------

// The released version of this app. Single source of truth: the web app shows
// it in ⚙ Settings, the Sheet menu shows it in About, and the daily update
// check compares it against the collector's `latest_version`. Bump it here (and
// nowhere else) when you release — see collector/README.md.
var APP_VERSION = '1.3.1';

var SHEET_NAME = 'cards';

// Leitner boxes 1..7 and how many days until a card in each box is due again.
// Boxes 6 and 7 exist because a mature deck is mostly top-box cards: a few
// hundred cards sitting in a 16-day box means dozens of reviews a day forever,
// however well you know them. Doubling twice more thins that tail out while
// leaving the shaky end of the ladder exactly as it was.
var BOX_INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32, 7: 64 };
var MAX_BOX = 7;

// From this box up a card counts as mastered and is left out of the weak-cards
// drill. Held at 5 as the ladder grew, so that drill's pool is unchanged.
var MASTERED_BOX = 5;

// Due dates are scattered by up to ±15%, so cards graded on the same day don't
// march back in lockstep. Without it a 100-card study day returns as a 100-card
// wall exactly one interval later; with it the wave fans out, and fans out
// further every time those cards are seen again.
var BOX_JITTER = 0.15;

// "Already knew it" on a brand-new card jumps straight to this box.
var KNOWN_START_BOX = 4;

// How many never-studied cards to introduce per DAY — not per sitting. Come
// back a second time and the day's allowance is already spent, however well the
// box-1 gate below reads: three sittings must not mean thirty new words.
var NEW_PER_DAY = 10;

// Boxes 1..PRIORITY_BOX are served first, as one block, before anything else.
// A mature deck is mostly top-box cards, and sprinkling the shaky ones through
// that tail means the work that actually matters waits for the end of a long
// sitting. Inside the block the boxes still interleave.
var PRIORITY_BOX = 2;

// With this many cards or more sitting in box 1, new cards wait: there is
// already more than enough shaky material in rotation, and adding to it only
// grows the pile. Checked after the box-1/box-2 block, against what you just
// graded, so a session that clears box 1 can still earn its new cards.
// Fallback for a missing or unparseable `box1_new_gate` in the config tab.
var BOX1_NEW_GATE = 20;

// Most cards one DAY will serve, across however many sittings — fallback for a
// missing or unparseable `daily_limit`. Cards graded earlier today are already
// spent against it; 0 (in the config tab) means no limit.
var DAILY_LIMIT = 80;

// How much flatter the scheduled session's draw is than the weak drill's. 1
// would hand you a session that is almost entirely box 1 after a break; 2 keeps
// shaky cards well ahead while leaving room for steadier ones to come along.
var SESSION_MIX_SCALE = 2;

// How hard a session front-loads its weak cards. The deal lets a box run ahead
// of an even spread by box^this, so 0 deals every box evenly across the
// session, 0.5 gets the box-1 work done by roughly three-quarters of the way
// through, and 1 starts packing box 1 into blocks again.
var BOX_FRONT_LOAD = 0.5;

// How many weak (low-box) cards to serve in a schedule-neutral practice drill.
var PRACTICE_LIMIT = 20;

// Cap for the "today's mistakes" drill. A day's errors are naturally few; this
// is only a runaway guard.
var ERROR_DRILL_LIMIT = 50;

// Column order in the sheet. Keep in sync with the header row.
// front_side / back_side / notes all support Markdown.
// `flag`      holds a marker (FLAG_MARK) when you flag a card for later editing.
// `exclude`   holds a marker (any non-empty value) to drop a card from practice.
// `last_wrong` is the date ('yyyy-MM-dd') a card was most recently answered
//   wrong — used to surface recently-missed cards. New columns MUST be appended
//   at the end: reads/writes are positional, so inserting mid-list would shift
//   existing data under the wrong headers.
var HEADERS = [
  'id', 'type', 'front_side', 'back_side', 'notes',
  'box', 'due', 'last_seen', 'right', 'wrong', 'added', 'flag', 'exclude', 'last_wrong'
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
var PROGRESS_FIELDS = ['box', 'due', 'last_seen', 'right', 'wrong', 'flag', 'last_wrong'];

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
  ['sentence_gap', '1.5',
    'Seconds of silence after each sentence in the 🎧 Soak player. 0 = no pause.'],
  ['sentence_repeat', '1',
    'How many times each sentence is spoken before the 🎧 Soak player moves on.'],
  ['new_card_order', 'random',
    'How a study session picks its new cards: "random" (shuffle the deck) or "recent" (most recently added first, by the `added` date).'],
  ['daily_limit', '80',
    'Most cards one day will ever serve you, counting everything you already graded today. The rest wait for tomorrow. 0 = no limit.'],
  ['box1_new_gate', '20',
    'New cards wait while box 1 holds this many cards or more — checked after the box-1/box-2 block, so a session that clears box 1 still earns them. Raise it to see new words sooner, lower it to finish the shaky pile first. 0 = never introduce new cards.'],
  ['update_check', 'yes',
    'Check for app updates on startup? Sends one anonymous ping a day (an unrecognizable fingerprint of this copy + app version, nothing else) that also lets the author count active users. yes / no'],
  ['ai_endpoint', 'https://generativelanguage.googleapis.com/v1beta',
    'Where “AI assist” sends a card. Google’s Gemini API only, for now. Leave it at the version (…/v1beta) and the model below is appended, or paste the whole URL from Google’s docs (…/v1beta/models/{model}:generateContent) and the model comes from the URL.'],
  ['ai_model', 'gemini-flash-latest',
    'Which model “AI assist” asks, e.g. gemini-flash-latest or gemini-pro-latest. Ignored when ai_endpoint already names a model in its path.'],
  ['webapp_url', '',
    'The /exec link of your own deployment. Leave blank to auto-detect.']
];

// ---- Sentences tab ---------------------------------------------------------
// A third tab holds whole sentences, kept for their *shape* — tense, clause
// order, tempo — rather than for a word you don't know. The 🎧 Soak player
// reads them aloud one at a time with a silence after each. Nothing here is
// ever graded, scheduled or written back: it is a player, not a drill.

var SENTENCE_SHEET_NAME = 'sentences';

// Column order in the sentences tab. Positional like HEADERS — new columns
// MUST be appended at the end.
// `text`    the sentence itself, and the ONLY thing ever spoken.
// `note`    your translation, or the thing to notice. Never spoken — exactly
//           as the native-language gloss on a card is never spoken.
// `tag`     optional label (`perfectum`, `bijzin`, …), shown as a badge.
// `exclude` non-empty (`x`) drops the row from the player, as it does in `cards`.
//
// There is deliberately NO language column, now or later: `text` is in
// `target_language` from the config tab, the same setting the cards are read
// in. One study language per Sheet — which is also what lets scriptMismatch_
// guard this tab for free.
var SENTENCE_HEADERS = ['id', 'text', 'note', 'tag', 'added', 'exclude'];

// Payload guard only; a soak list is normally a few dozen rows.
var SENTENCE_LIMIT = 500;

// ---- Web app entry point ---------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Flashcards')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- Spreadsheet menu ------------------------------------------------------
// Runs when the bound Sheet is opened; adds a "🎴 Flashcards" menu so the app
// can be opened (and the Sheet checked) without touching the Apps Script editor.

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🎴 Flashcards')
    .addItem('Open the app ↗', 'menuOpenApp_')
    .addSeparator()
    .addItem('Check Sheet health', 'menuCheckSheet_')
    .addItem('Renumber id column', 'menuRenumberIds_')
    .addSubMenu(ui.createMenu('AI assist')
      .addItem('Fill in new + flagged cards', 'menuAiFill_')
      .addSeparator()
      .addItem('Set the API key…', 'menuAiKey_')
      .addItem('Test the connection', 'menuAiTest_'))
    .addSeparator()
    .addItem('View on GitHub ↗', 'menuGitHub_')
    .addItem('About Flashcards (v' + APP_VERSION + ')', 'menuAbout_')
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

/** Menu: report whether the tab and column names match what the code expects. */
function menuCheckSheet_() {
  SpreadsheetApp.getUi().alert('🎴 Sheet health', checkSheetHealth(), SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Read-only sanity check of the spreadsheet layout: are the `cards` and
 * `config` tabs there, and does every header cell say what the code expects?
 * Reads and writes are positional, so a renamed or reordered column silently
 * lands data in the wrong place — this is the diagnostic for that, typically
 * after a File → Import with "Replace current sheet" mangled the header.
 *
 * Deliberately fixes nothing: ensureSchema_ already fills EMPTY header cells
 * on every app load, so what this mostly catches is a wrong (non-empty)
 * label — and whether the label or the data underneath it should move is a
 * call only the owner can make.
 */
function checkSheetHealth() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var problems = [];

  var cards = ss.getSheetByName(SHEET_NAME);
  if (!cards) {
    problems.push('❌ No "' + SHEET_NAME + '" tab found. If your cards live under ' +
      'another name, rename that tab to "' + SHEET_NAME + '" — otherwise the app ' +
      'creates an empty one on next load.');
  } else {
    problems = problems.concat(checkHeaderRow_(cards, HEADERS));
  }

  var config = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!config) {
    problems.push('⚠️ No "' + CONFIG_SHEET_NAME + '" tab — the app recreates it ' +
      'with defaults on next load, so this fixes itself.');
  } else {
    problems = problems.concat(checkHeaderRow_(config, CONFIG_HEADERS));
  }

  // The sentences tab is read positionally too, so a mangled header there fails
  // exactly as silently as one in `cards` — it belongs in this diagnostic.
  var sentences = ss.getSheetByName(SENTENCE_SHEET_NAME);
  if (!sentences) {
    problems.push('⚠️ No "' + SENTENCE_SHEET_NAME + '" tab — the app recreates it ' +
      'with headers on next load, so this fixes itself.');
  } else {
    problems = problems.concat(checkHeaderRow_(sentences, SENTENCE_HEADERS));
  }

  if (problems.length) return problems.join('\n\n');
  var rows = cards.getLastRow() - 1;
  var lines = sentences.getLastRow() - 1;
  return '✅ All good.\n\n"' + SHEET_NAME + '", "' + CONFIG_SHEET_NAME + '" and "' +
    SENTENCE_SHEET_NAME + '" tabs found and every column name is correct.\n\n' +
    rows + ' card row' + (rows === 1 ? '' : 's') + ' · ' +
    lines + ' sentence row' + (lines === 1 ? '' : 's') + '.';
}

/** Compares a sheet's header row against `expected`; returns problem strings. */
function checkHeaderRow_(sheet, expected) {
  var problems = [];
  var width = Math.min(sheet.getMaxColumns(), expected.length);
  var header = width > 0 ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
  for (var i = 0; i < expected.length; i++) {
    var got = i < width ? String(header[i]).trim() : '';
    if (got === expected[i]) continue;
    problems.push('❌ "' + sheet.getName() + '" tab, column ' +
      String.fromCharCode(65 + i) + ': header is ' +
      (got ? '"' + got + '"' : 'blank') + ' but should be "' + expected[i] + '".');
  }
  return problems;
}

/** Menu: confirm, then renumber the `id` column 1…N in row order. */
function menuRenumberIds_() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('🎴 Renumber ids',
    'Rewrite the "id" column so cards are numbered 1, 2, 3 … in the order they ' +
    'sit in the sheet, closing the gaps left by deleted rows.\n\n' +
    'Your cards and your progress are untouched: the app finds a card by its ' +
    'row, never by its id. But the old numbers are gone for good — anything ' +
    'outside the Sheet that refers to a card by id (an export, a note, a ' +
    'one-off script) will point at a different card afterwards.\n\n' +
    'Renumber now?',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  ui.alert('🎴 Renumber ids', renumberIds(), ui.ButtonSet.OK);
}

/**
 * Rewrites column A as 1…N in sheet order, so ids stay contiguous after rows
 * are deleted and blank ids on hand-added rows get filled.
 *
 * Safe by construction: `id` is a human-facing handle only — every read and
 * write in this file addresses a card by its 1-based sheet row (`_row`), so
 * renumbering cannot touch scheduling, stats or the queue.
 *
 * Fully blank rows keep a blank id (matching readCards_, which skips them), so
 * spacer rows don't consume a number. One bulk read + one bulk write: per-cell
 * writes time out on a deck of a few thousand cards.
 */
function renumberIds() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 'No cards to renumber.';

    // Read every column, not just A: whether a row is a card depends on the
    // rest of it, and a row whose only content is a stale id is still a card.
    var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    var ids = [];
    var n = 0;
    for (var r = 0; r < values.length; r++) {
      var blank = values[r].every(function (c) { return c === '' || c === null; });
      ids.push([blank ? '' : ++n]);
    }
    sheet.getRange(2, 1, ids.length, 1).setValues(ids);
    return n
      ? 'Renumbered ' + n + ' card' + (n === 1 ? '' : 's') + ': id 1…' + n + '.'
      : 'No cards to renumber.';
  } finally {
    lock.releaseLock();
  }
}

// ---- AI card filling -------------------------------------------------------
// "AI assist" in the Sheet menu sends cards to Google's Gemini API and writes
// the answer back into `back_side` / `notes` — nothing else. It is the one job
// in this app that is genuinely tedious by hand: a new card's front is a word
// you met somewhere, and its back is a dictionary lookup plus an example
// sentence that follows this deck's bold-gloss / italic-example convention
// (see "Writing cards that are actually good" in AGENTS.md).
//
// One provider, deliberately. Every API has its own request shape, its own way
// of carrying the key and its own way of reporting a refusal, and supporting
// several of them means three code paths that can only ever be tested one at a
// time. Gemini is the one with a free tier, so it is the one that works for
// someone who has not bought anything.
//
// Three settings, and only the first is secret:
//   • the API key   — Script Properties, set from the menu. NOT a config cell:
//                     the Sheet gets copied, exported and shared, and a key in
//                     a cell travels with it.
//   • ai_endpoint   — config tab. Google's URL, up to the version or including
//                     the model: .../v1beta, or the whole
//                     .../v1beta/models/{model}:generateContent as their docs
//                     print it.
//   • ai_model      — config tab. Used when the URL stops at the version.
//                     Google names the model in the PATH, so a URL pasted whole
//                     already carries it and this row is then ignored.
//
// Note for anyone reading this with a chat subscription in mind: a Gemini
// Advanced (or Claude, or ChatGPT) plan is not an API key. API access is a
// separate thing with its own key, from aistudio.google.com/apikey. Gemini's
// free tier covers filling cards; the paid tier costs a fraction of a cent a
// card.

/** Script Property holding the API key. Never written to the Sheet. */
var AI_KEY_PROPERTY = 'AI_API_KEY';

// A menu function gets about six minutes before Apps Script kills it, and one
// card is one request. So a run takes a bounded bite, writes each card as it
// goes, and tells you what is left — running it again picks up where it
// stopped. Nothing is batched into a single request on purpose: one card per
// call means one card can fail without taking the others with it.
var AI_PER_RUN_LIMIT = 15;
var AI_TIME_BUDGET_MS = 4 * 60 * 1000;

// Google answers 5xx under load often enough that one is not news. Try again a
// couple of times, pausing a little longer each time.
var AI_MAX_ATTEMPTS = 3;
var AI_RETRY_PAUSE_MS = 2000;

/**
 * Reports an outcome without blocking the execution.
 *
 * ui.alert() does not return until someone clicks OK, so a dialog that is never
 * answered — or never rendered, which happens when the Sheet is not the tab in
 * front of you — holds the run open until Apps Script kills it at six minutes
 * ("Exceeded maximum execution time"), taking the account of what happened with
 * it. A modeless dialog shows the same text and returns immediately, and the
 * line is logged first, so the Executions log is the record either way.
 */
function aiShowResult_(text) {
  var body = String(text);
  console.log('AI assist — ' + body.replace(/\s*\n\s*/g, ' · ').slice(0, 500));
  var safe = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var html = HtmlService.createHtmlOutput(
    '<div style="font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;' +
      'padding:10px 6px;white-space:pre-wrap;word-break:break-word">' +
      safe + '</div>'
  ).setWidth(440).setHeight(300);
  SpreadsheetApp.getUi().showModelessDialog(html, '🎴 AI assist');
}

/** Menu: set, replace or clear the API key. */
function menuAiKey_() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var current = props.getProperty(AI_KEY_PROPERTY);
  var response = ui.prompt('AI assist — API key',
    (current
      ? 'A key is already set (ending ' + current.slice(-4) + ').\n\n'
      : 'No key set yet.\n\n') +
    'Paste a Gemini API key from aistudio.google.com/apikey. It is stored in this ' +
    'script’s own properties, not in the Sheet, so copying or sharing the ' +
    'Sheet does not carry it along.\n\n' +
    'Leave the box empty and press OK to remove the key.',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var key = String(response.getResponseText() || '').trim();
  if (!key) {
    props.deleteProperty(AI_KEY_PROPERTY);
    aiShowResult_('Key removed. AI assist is off until you set one again.');
    return;
  }
  props.setProperty(AI_KEY_PROPERTY, key);
  var cfg = readConfig_();
  aiShowResult_(
    'Key saved (ending ' + key.slice(-4) + ').\n\n' +
    'Endpoint: ' + (cfg.ai_endpoint || '(blank)') + '\n' +
    'Model: ' + (cfg.ai_model || '(blank)') + '\n\n' +
    'Both of those live in the config tab. Use "Test the connection" next.');
}

/** Menu: one cheap round-trip, to prove the key / endpoint / model agree. */
function menuAiTest_() {
  var ai;
  try {
    ai = aiConfig_();
  } catch (err) {
    aiShowResult_('Not set up yet.\n\n' + String((err && err.message) || err));
    return;
  }
  try {
    var reply = aiCall_(ai, 'Reply with the single word: ready.', 'Say it.');
    aiShowResult_('Working.\n\n' +
      'URL: ' + ai.url + '\n' +
      'Model: ' + ai.model + ' (from ' + ai.modelFrom + ')\n' +
      'Reply: ' + reply.slice(0, 120));
  } catch (err2) {
    aiShowResult_(String((err2 && err2.message) || err2));
  }
}

/** Menu: confirm what will change, fill the cards, report what happened. */
function menuAiFill_() {
  var ui = SpreadsheetApp.getUi();
  var ai;
  try {
    ai = aiConfig_();
  } catch (err) {
    aiShowResult_('Not set up yet.\n\n' + String((err && err.message) || err));
    return;
  }

  var targets = aiTargets_(readCards_().cards);
  var total = targets.length;
  if (!total) {
    aiShowResult_(
      'Nothing to fill. This looks for two things:\n\n' +
      '• new cards (blank `box`) whose `back_side` is empty\n' +
      '• cards you flagged (' + FLAG_MARK + ') in the app\n\n' +
      'Add some fronts, or flag a card you were unhappy with, and run it again.');
    return;
  }

  var blanks = targets.filter(function (t) { return t.job === 'fill'; }).length;
  var batch = Math.min(total, AI_PER_RUN_LIMIT);
  var answer = ui.alert('AI assist',
    total + ' card' + (total === 1 ? '' : 's') + ' to work on: ' +
      blanks + ' with an empty back side, ' +
      (total - blanks) + ' flagged (notes only).\n\n' +
    'This run will do the first ' + batch + '. Each card is one request to ' +
      ai.model + ', charged to your own API account.\n\n' +
    'What gets written:\n' +
    '• a card with no back side gets `back_side` and `notes`\n' +
    '• a flagged card gets `notes` only — its `back_side` is the answer you ' +
      'have been grading against, so it is left alone (unless it is empty)\n\n' +
    'Nothing else is touched: box, due date, counts and flags stay exactly as ' +
    'they are, so no card’s schedule moves.\n\n' +
    'Go ahead?',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  // aiFillCards can run for minutes; its summary must not be able to hold the
  // execution open afterwards, so it is reported, not asked.
  aiShowResult_(aiFillCards());
}

/**
 * The two kinds of card worth sending, in the order they are worth sending:
 * unanswered new cards first (a card with no back side cannot be studied at
 * all), then the ones the owner flagged.
 * @return {Array<Object>} Each { card, job: 'fill' | 'improve' }.
 */
function aiTargets_(cards) {
  var fill = [], improve = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (String(card.exclude || '').trim() !== '') continue;   // soft-deleted
    if (String(card.front_side || '').trim() === '') continue; // nothing to go on
    var hasBack = String(card.back_side || '').trim() !== '';
    if (!hasBack && isNew_(card)) fill.push({ card: card, job: 'fill' });
    else if (String(card.flag || '').trim() !== '') {
      improve.push({ card: card, job: hasBack ? 'improve' : 'fill' });
    }
  }
  return fill.concat(improve);
}

/**
 * Fills as many cards as fit in one run and reports in plain words. Writes each
 * card as its answer arrives rather than at the end, so a timeout or a dropped
 * connection costs the current card and nothing else.
 * @return {string} A summary fit to show in a dialog.
 */
function aiFillCards() {
  var cfg = readConfig_();
  var ai = aiConfig_(cfg);
  var lang = String(cfg.target_language || 'nl-NL').trim();
  var data = readCards_();
  var targets = aiTargets_(data.cards);
  var started = Date.now();
  var done = 0, filled = 0, improved = 0, stopped = '';
  var problems = [];

  for (var i = 0; i < targets.length; i++) {
    if (done >= AI_PER_RUN_LIMIT) { stopped = 'run limit'; break; }
    if (Date.now() - started > AI_TIME_BUDGET_MS) { stopped = 'time limit'; break; }

    var target = targets[i];
    var fields;
    try {
      fields = aiParseFields_(aiCall_(ai,
        aiSystemPrompt_(lang), aiUserPrompt_(target)));
    } catch (err) {
      // A bad key or a wrong endpoint fails identically on every card, so stop
      // rather than spend fifteen requests proving it.
      if (err && err.fatal) { stopped = 'error'; problems.push(String(err.message)); break; }
      problems.push('id ' + (target.card.id || target.card._row) + ': ' +
        String((err && err.message) || err));
      continue;
    }

    var wrote = aiWriteCard_(data.sheet, target, fields);
    if (wrote === 'moved') {
      problems.push('id ' + (target.card.id || target.card._row) +
        ': row changed while running — skipped');
      continue;
    }
    if (!wrote) {
      problems.push('id ' + (target.card.id || target.card._row) +
        ': the model returned nothing usable');
      continue;
    }
    done++;
    if (target.job === 'fill') filled++; else improved++;
  }

  var lines = [];
  lines.push(done
    ? 'Wrote ' + done + ' card' + (done === 1 ? '' : 's') + ': ' +
      filled + ' filled in, ' + improved + ' with improved notes.'
    : 'No cards were written.');

  var left = targets.length - done - problems.length;
  if (stopped === 'run limit' || stopped === 'time limit') {
    lines.push(left + ' still waiting — run it again to carry on (one run stops ' +
      'at ' + AI_PER_RUN_LIMIT + ' cards, or four minutes, because Apps Script ' +
      'cuts a menu action off at six).');
  } else if (stopped === 'error') {
    lines.push('Stopped early — the same failure would hit every remaining card.');
  }
  if (problems.length) {
    lines.push('');
    lines.push('Problems:');
    lines.push(problems.slice(0, 6).join('\n'));
    if (problems.length > 6) lines.push('…and ' + (problems.length - 6) + ' more.');
  }
  if (improved) {
    lines.push('');
    lines.push('Flags are left on, so you can read the new notes in the app and ' +
      'unflag the ones you are happy with.');
  }
  return lines.join('\n');
}

/**
 * Writes one card's generated fields, guarding the one way this can go wrong:
 * row numbers. A card is addressed by its sheet row, and the row was read
 * before the request went out — so re-read `front_side` and refuse to write if
 * it no longer matches. Rewriting someone's answers onto the wrong card is the
 * single unrecoverable outcome here, and it costs one cell read to prevent.
 * @return {boolean|string} true if written, false if nothing usable, 'moved'
 *     if the row is no longer the card we asked about.
 */
function aiWriteCard_(sheet, target, fields) {
  var card = target.card;
  var backCol = HEADERS.indexOf('back_side') + 1;
  var notesCol = HEADERS.indexOf('notes') + 1;
  var frontCol = HEADERS.indexOf('front_side') + 1;

  var back = String(fields.back_side == null ? '' : fields.back_side).trim();
  var notes = String(fields.notes == null ? '' : fields.notes).trim();
  // `back_side` is only ever written when the card has none: on a flagged card
  // it is the answer the owner has been graded against, and silently rewriting
  // it changes what they have been learning.
  var writeBack = target.job === 'fill' && back !== '';
  if (!writeBack && !notes) return false;

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (String(sheet.getRange(card._row, frontCol).getValue()) !==
        String(card.front_side)) {
      return 'moved';
    }
    if (writeBack) setTextValue_(sheet.getRange(card._row, backCol), back);
    if (notes) setTextValue_(sheet.getRange(card._row, notesCol), notes);
  } finally {
    lock.releaseLock();
  }
  return true;
}

/** The deck's own conventions, stated once, as the model's instructions. */
function aiSystemPrompt_(lang) {
  return [
    'You write flashcards for a spaced-repetition app. The learner is studying ' +
      'the language with BCP-47 tag ' + lang + '. Their prompts are in that ' +
      'language; explain in English.',
    '',
    'Answer with one JSON object and nothing else, no code fence:',
    '{"back_side": "...", "notes": "..."}',
    '',
    'back_side is the answer the learner is graded on, so it holds ONE fact. ' +
      'Bold the core gloss with **asterisks**. Add one short example sentence ' +
      'in ' + lang + ' on its own line, in _underscore italics_, and nothing ' +
      'else. The app speaks italic spans aloud in ' + lang + ' and never speaks ' +
      'the bold gloss, so an un-italicised example is one the learner never ' +
      'hears, and an italicised English gloss is read aloud in the wrong ' +
      'language. If a word has two unrelated senses, take the more common one ' +
      'and mention the other in notes.',
    '',
    'notes is a short hint shown under the answer: register, how it differs ' +
      'from a near-synonym, an irregular form, or a second example. Two ' +
      'sentences at most. Use "" when there is nothing worth saying.',
    '',
    'Both fields are Markdown. No headings, no bullet lists, no preamble.'
  ].join('\n');
}

/** What is being asked of this particular card. */
function aiUserPrompt_(target) {
  var card = target.card;
  var lines = [];
  if (target.job === 'fill') {
    lines.push('Fill in this card.');
  } else {
    lines.push('This card is flagged for review. Improve its notes only — ' +
      'back_side is the answer the learner is already being graded on and must ' +
      'not be rewritten. Return {"notes": "..."}.');
  }
  lines.push('');
  if (String(card.type || '').trim() !== '') lines.push('type: ' + card.type);
  lines.push('front_side: ' + card.front_side);
  if (String(card.back_side || '').trim() !== '') lines.push('back_side: ' + card.back_side);
  lines.push('notes so far: ' + (String(card.notes || '').trim() || '(empty)'));
  return lines.join('\n');
}

/**
 * Pulls the two fields out of the model's reply. Models wrap JSON in prose or a
 * code fence often enough that insisting on a clean parse would fail cards for
 * no reason, so take the outermost braces and parse those.
 */
function aiParseFields_(text) {
  var body = String(text || '');
  var start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('the reply was not JSON: ' + body.slice(0, 80));
  }
  var parsed;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new Error('the reply was not valid JSON: ' + body.slice(start, start + 80));
  }
  return parsed || {};
}

/**
 * The settings, validated together — every failure here is a setup mistake,
 * and saying which one is wrong is the whole job.
 *
 * `url` is what actually gets POSTed and `model` is what is actually asked,
 * which are not always the two cells as typed: Google names the model in the
 * path (`/models/{model}:generateContent`), so the URL may carry it and the
 * `ai_model` row is then not needed.
 * @return {Object} { endpoint, url, model, modelFrom, key }.
 */
function aiConfig_(config) {
  var cfg = config || readConfig_();
  var endpoint = String(cfg.ai_endpoint || '').trim();
  var model = String(cfg.ai_model || '').trim();
  var key = String(PropertiesService.getScriptProperties()
    .getProperty(AI_KEY_PROPERTY) || '').trim();

  if (!key) {
    throw new Error('No API key set. Use “AI assist → Set the API ' +
      'key…” first.\n\nGet one from aistudio.google.com/apikey — a Gemini ' +
      'Advanced subscription is not an API key and will not work here.');
  }
  if (!endpoint) {
    throw new Error('The `ai_endpoint` row of the config tab is empty. It wants ' +
      'Google’s URL:\nhttps://generativelanguage.googleapis.com/v1beta');
  }
  if (!/^https:\/\//i.test(endpoint)) {
    throw new Error('`ai_endpoint` must be an https:// URL. It currently says: ' +
      endpoint);
  }
  if (!aiIsGemini_(endpoint)) {
    throw new Error('AI assist only speaks Google’s Gemini API for now, and ' +
      'that is not one of its URLs:\n' + endpoint + '\n\nUse\n' +
      'https://generativelanguage.googleapis.com/v1beta\nor the full ' +
      '…/v1beta/models/{model}:generateContent as Google’s own docs print it.');
  }

  var urlModel = aiUrlModel_(endpoint);
  if (!model && !urlModel) {
    throw new Error('The `ai_model` row of the config tab is empty. Put a model ' +
      'id there, e.g. gemini-flash-latest — or end `ai_endpoint` with ' +
      '/models/{model}:generateContent and it comes from the URL instead.');
  }

  return {
    endpoint: endpoint,
    url: aiGeminiUrl_(endpoint, model, urlModel),
    model: urlModel || model,
    modelFrom: urlModel ? 'the endpoint URL' : 'the `ai_model` row',
    key: key
  };
}

/**
 * Whether this URL is Google's generative-language API. The `:generateContent`
 * form is accepted on any host so that a proxy in front of it still works — it
 * is the same request either way.
 */
function aiIsGemini_(endpoint) {
  return /(^|\.)googleapis\.com\//i.test(endpoint) ||
    /:(stream)?generateContent/i.test(endpoint);
}

/** The model named in Google's path, or '' if the URL names none. */
function aiUrlModel_(endpoint) {
  var m = endpoint.match(/\/models\/([^\/:?]+):(?:stream)?generateContent/i);
  return m ? m[1] : '';
}

/**
 * The URL to POST. A URL that already names a model is used exactly as pasted —
 * that is how Google's docs give it, and it is the one case where `ai_model` has
 * nothing to add. A bare version or `…/models` base gets the model appended.
 * Anything else is refused rather than guessed at: a composed-wrong URL 404s
 * with a message about models, which would send someone looking in the wrong
 * place.
 */
function aiGeminiUrl_(endpoint, model, urlModel) {
  if (urlModel) return endpoint;
  var base = endpoint.replace(/\/+$/, '');
  if (/\/models$/i.test(base)) return base + '/' + model + ':generateContent';
  if (/\/v1[a-z0-9]*$/i.test(base)) return base + '/models/' + model + ':generateContent';
  throw new Error('That is a Google URL, but not one this can complete:\n' +
    endpoint + '\n\nEither paste the full URL from Google’s docs, which ends ' +
    '…/models/{model}:generateContent, or end it at the version (…/v1beta) ' +
    'and let the `ai_model` row fill in the rest.');
}

/**
 * One request, one answer. Errors are thrown with a dialog-ready message; the
 * ones that would repeat identically on every card are marked `fatal` so the
 * caller can stop.
 * @return {string} The model's reply text.
 */
function aiCall_(ai, system, user) {
  // The instructions ride along in the one user part rather than in
  // `systemInstruction`, and nothing sets a generationConfig: this has to work
  // against whatever version and model someone pasted, and a field an older
  // endpoint does not know is a 400 that reads like a model problem. The
  // request stays the shape Google's own quickstart prints.
  var payload = {
    contents: [{ role: 'user', parts: [{ text: system + '\n\n' + user }] }]
  };

  // Everything about a run is logged as it happens, and never only reported in
  // a dialog: ui.alert() blocks the execution until someone clicks OK, so a
  // dialog that is never answered ends the run with "Exceeded maximum execution
  // time" and takes the only account of what happened with it. The Executions
  // log is the record; the dialog is a convenience. (The URL is safe to log —
  // the key travels in a header, never in the path.)
  // A 5xx from Google is routinely "this model is experiencing high demand",
  // which is over in seconds — so it is worth waiting out rather than failing a
  // card on. Short, bounded and linear: the point is to ride out a blip, not to
  // hammer an outage, and the whole run shares one six-minute ceiling.
  var code, text, body;
  for (var attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
    console.log('AI request → ' + ai.url +
      (attempt > 1 ? ' (attempt ' + attempt + ')' : ''));
    var started = Date.now();
    var response;
    try {
      response = UrlFetchApp.fetch(ai.url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-goog-api-key': ai.key },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (err) {
      console.log('AI request failed after ' + (Date.now() - started) + 'ms: ' +
        String((err && err.message) || err));
      throw aiError_('could not reach ' + ai.url + ' — ' +
        String((err && err.message) || err), true);
    }

    code = response.getResponseCode();
    text = response.getContentText();
    console.log('AI response ' + code + ' in ' + (Date.now() - started) + 'ms, ' +
      text.length + ' bytes');
    body = {};
    try { body = JSON.parse(text) || {}; } catch (err2) { /* an HTML error page */ }

    if (code < 500 || attempt === AI_MAX_ATTEMPTS) break;
    Utilities.sleep(AI_RETRY_PAUSE_MS * attempt);
  }

  if (code < 200 || code >= 300) throw aiHttpError_(code, body, text, ai);
  return aiGeminiText_(body);
}

/**
 * Google: text parts out of the first candidate. Both ways this comes back
 * empty are worth naming rather than reporting as "no text": a prompt the
 * safety filter stopped before generation (`promptFeedback.blockReason`), and a
 * candidate cut short (`finishReason`).
 */
function aiGeminiText_(body) {
  var blocked = body.promptFeedback && body.promptFeedback.blockReason;
  if (blocked) throw aiError_('the request was blocked (' + blocked + ')', false);

  var candidate = (body.candidates || [])[0];
  var reason = candidate && candidate.finishReason;
  var parts = (candidate && candidate.content && candidate.content.parts) || [];
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].text) out.push(parts[i].text);
  }
  if (!out.length) {
    throw aiError_('the reply had no text in it' +
      (reason ? ' (' + reason + ')' : ''), false);
  }
  if (reason && reason !== 'STOP') {
    throw aiError_('the reply stopped early (' + reason + ')', false);
  }
  return out.join('');
}

/** An Error carrying whether the caller should give up on the whole run. */
function aiError_(message, fatal) {
  var err = new Error(message);
  err.fatal = !!fatal;
  return err;
}

/**
 * HTTP failures, translated. The status says who should fix what: 401/403 is
 * the key, 404 the endpoint, 400 usually the model id, 429 the account — all of
 * which would repeat on every remaining card, so all of them stop the run.
 */
function aiHttpError_(code, body, text, ai) {
  var detail = (body.error && (body.error.message || body.error.type)) ||
    body.message || String(text || '').slice(0, 200) || '(no details)';
  if (code === 401 || code === 403) {
    return aiError_('Google rejected the API key (HTTP ' + code + '). Set it ' +
      'again with “AI assist → Set the API key…”, from ' +
      'aistudio.google.com/apikey.\n\n' + detail, true);
  }
  if (code === 404) {
    return aiError_('Nothing at that URL (HTTP 404):\n' + ai.url +
      '\n\nUsually this is the model rather than the URL — on Google’s API the ' +
      'model name is part of the path. It is asking for “' + ai.model +
      '”, taken from ' + ai.modelFrom + '.\n\n' + detail, true);
  }
  if (code === 400) {
    return aiError_('Google refused the request (HTTP 400), which usually means ' +
      'the model name is wrong or not available to this key. It is asking for ' +
      '“' + ai.model + '”, taken from ' + ai.modelFrom + '.\n\n' +
      detail, true);
  }
  if (code === 429) {
    return aiError_('Rate-limited or out of quota (HTTP 429). Gemini’s free ' +
      'tier has a per-minute limit, so waiting a minute and running it again is ' +
      'often enough — the cards already written are saved.\n\n' + detail, true);
  }
  if (code >= 500) {
    return aiError_('Google is overloaded or down (HTTP ' + code + '), after ' +
      AI_MAX_ATTEMPTS + ' tries. Nothing is wrong with your setup — try again ' +
      'in a few minutes.\n\n' + detail, true);
  }
  return aiError_('Google failed (HTTP ' + code + '): ' + detail, false);
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

/**
 * Menu: which version this copy is running, and how to update it.
 *
 * The version is worth surfacing here and not only in the app because updating
 * is a Sheet-side job (Extensions → Apps Script → redeploy), so this is where
 * someone stands when they need to know what they've got.
 */
function menuAbout_() {
  var repo = 'https://github.com/Yc-Chen/flashcards';
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;padding:8px 4px">' +
      '<p style="margin:0 0 6px;font-size:16px"><strong>🎴 Flashcards</strong></p>' +
      '<p style="margin:0 0 14px;color:#5f6368">Version <strong>' + APP_VERSION + '</strong></p>' +
      '<p style="margin:0 0 14px">This copy is yours — it never updates itself. ' +
        'The app tells you on its home screen when a newer version is out.</p>' +
      '<p style="margin:0">' +
        '<a href="' + repo + '/blob/main/UPGRADE.md" target="_blank" rel="noopener" ' +
          'style="display:inline-block;background:#4f8cff;color:#fff;text-decoration:none;' +
          'font-weight:700;padding:9px 14px;border-radius:10px">How to update ↗</a>' +
        '&nbsp;&nbsp;<a href="' + repo + '" target="_blank" rel="noopener" ' +
          'style="color:#4f8cff;text-decoration:none;font-weight:600">GitHub ↗</a>' +
      '</p>' +
    '</div>'
  ).setWidth(340).setHeight(210);
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
var CLIENT_CONFIG_KEYS = ['target_language', 'speech_rate', 'auto_speak',
  'sentence_gap', 'sentence_repeat', 'update_check', 'daily_limit'];

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

// ---- Sentences helpers -----------------------------------------------------
// Deliberately parallel to getConfigSheet_/ensureConfigSchema_ rather than a
// generalization of them: getSheet_ is hardcoded to `cards` and the one-off
// maintenance scripts depend on that exact signature.

function getSentencesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SENTENCE_SHEET_NAME);
  // Insert at the end so `cards` stays the tab you land on.
  if (!sheet) sheet = ss.insertSheet(SENTENCE_SHEET_NAME, ss.getNumSheets());
  ensureSentenceSchema_(sheet);
  return sheet;
}

/**
 * Self-heals the sentences tab the way ensureSchema_ does for `cards`: writes
 * the header row when the tab is empty and fills any header cell left blank
 * later, so the tab appears on its own and a future column needs no migration.
 * Only fills EMPTY cells — a wrong label is checkSheetHealth's job to report,
 * not this function's to silently overwrite.
 */
function ensureSentenceSchema_(sheet) {
  var need = SENTENCE_HEADERS.length;
  if (sheet.getMaxColumns() < need) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, need).setValues([SENTENCE_HEADERS]);
    sheet.setFrozenRows(1);
    // At the default 100px you cannot read the sentence in the cell you type
    // it into, which is the one thing this tab exists for.
    sheet.setColumnWidth(SENTENCE_HEADERS.indexOf('text') + 1, 420);
    sheet.setColumnWidth(SENTENCE_HEADERS.indexOf('note') + 1, 300);
    return;
  }
  var header = sheet.getRange(1, 1, 1, need).getValues()[0];
  var changed = false;
  for (var i = 0; i < need; i++) {
    if (header[i] === '' || header[i] === null) { header[i] = SENTENCE_HEADERS[i]; changed = true; }
  }
  if (changed) sheet.getRange(1, 1, 1, need).setValues([header]);
}

/** Reads all sentences as objects, tagging each with its 1-based sheet row. */
function readSentences_() {
  var sheet = getSentencesSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sheet: sheet, items: [] };

  var values = sheet.getRange(2, 1, lastRow - 1, SENTENCE_HEADERS.length).getValues();
  var items = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue; // skip blank rows
    var item = {};
    for (var c = 0; c < SENTENCE_HEADERS.length; c++) item[SENTENCE_HEADERS[c]] = row[c];
    item._row = i + 2; // actual sheet row number
    items.push(item);
  }
  return { sheet: sheet, items: items };
}

/**
 * The sentences the player will actually speak — the single source of truth
 * behind both getSentences and getSession's `sentenceCount`, so the number on
 * the button and the list you get can never disagree. Pure: reads nothing,
 * writes nothing.
 *
 * A row with a `note` but no `text` is skipped rather than played as silence:
 * that is a half-typed row, not a sentence.
 */
function playableSentences_(items) {
  var out = [];
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].exclude || '').trim() !== '') continue; // dropped by hand
    if (String(items[i].text || '').trim() === '') continue;    // nothing to say
    out.push(items[i]);
  }
  return out;
}

function toClientSentence_(s) {
  return {
    row: s._row,
    id: s.id,
    text: s.text,
    note: s.note,
    tag: String(s.tag || '').trim()
  };
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

/**
 * Anonymous id for the update-check ping: SHA-256 of the spreadsheet id,
 * truncated. One id per copy of the Sheet — stable across browsers and
 * devices, unlike anything stored client-side. The hash is one-way (sheet
 * ids are ~44 chars of entropy, nothing to brute-force against), so the
 * collector can count installs without learning which spreadsheets they are.
 */
function installId_() {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    SpreadsheetApp.getActiveSpreadsheet().getId());
  var hex = '';
  for (var i = 0; i < 16; i++) hex += ('0' + (raw[i] & 0xFF).toString(16)).slice(-2);
  return hex;
}

/**
 * Deals a session's cards out so the boxes alternate instead of arriving in
 * blocks, while still leading with the weak ones.
 *
 * Each box's cards are spread across the session by always taking from the box
 * furthest behind in the deal — so a session reads 1 2 1 1 2 1 3 1 … rather
 * than every box-1 card followed by every box-2 one. Progress is weighted by
 * box^BOX_FRONT_LOAD, which lets weak boxes run ahead of an even spread: box 1
 * is dealt densely early and is finished with roughly three-quarters of the way
 * in, while the mature boxes thin out the opening and fill the tail. Every box
 * still appears in the first few cards, because at the start all boxes sit at
 * zero progress and the tie goes to the weakest.
 *
 * Ranking order is preserved inside a box, so each box leads with the cards you
 * know least.
 * @param {Array<Object>} cards The drawn batch.
 * @return {Array<Object>} The same cards, interleaved by box, weak-leaning.
 */
function spreadByBox_(cards) {
  var groups = {}, keys = [];
  for (var i = 0; i < cards.length; i++) {
    var box = proficiencyBox_(cards[i]);
    if (!groups[box]) { groups[box] = []; keys.push(box); }
    groups[box].push(cards[i]);
  }
  keys.sort(function (a, b) { return a - b; }); // ties in the deal go to the weaker box
  var dealt = {}, out = [];
  for (var k = 0; k < keys.length; k++) dealt[keys[k]] = 0;
  for (var n = 0; n < cards.length; n++) {
    var pick = null, lowest = Infinity;
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      if (dealt[key] >= groups[key].length) continue;
      var progress = (dealt[key] / groups[key].length) * Math.pow(key, BOX_FRONT_LOAD);
      if (progress < lowest - 1e-9) { lowest = progress; pick = key; }
    }
    out.push(groups[pick][dealt[pick]++]);
  }
  return out;
}

/**
 * A due card's Leitner box as a weakness rank: 1 is the shakiest. A blank or
 * unparseable box (a hand-edited row) counts as 1 rather than sorting last —
 * the safe reading of "we don't know how well you know this" is "badly".
 */
function proficiencyBox_(card) {
  var box = Math.floor(Number(card.box));
  if (!isFinite(box) || box < 1) return 1;
  return Math.min(box, MAX_BOX);
}

/**
 * Share of attempts answered right, 0..1, used to break ties inside a box.
 * A card with no history at all counts as 1 (nothing has gone wrong yet), so a
 * hand-seeded row can't displace one you have actually been missing.
 */
function accuracy_(card) {
  var right = Number(card.right) || 0;
  var wrong = Number(card.wrong) || 0;
  var attempts = right + wrong;
  return attempts > 0 ? right / attempts : 1;
}

/**
 * Today's card budget from the config tab, falling back to DAILY_LIMIT when the
 * cell is blank or nonsense. 0 means no limit — readConfig_ never throws, so a
 * typo'd value must degrade to the default rather than to zero cards.
 */
function dailyLimit_(config) {
  var raw = config ? config.daily_limit : '';
  if (String(raw === undefined || raw === null ? '' : raw).trim() === '') return DAILY_LIMIT;
  var n = Math.floor(Number(raw));
  if (!isFinite(n) || n < 0) return DAILY_LIMIT;
  return n;
}

/**
 * The box-1 threshold that holds new cards back, from the config tab, falling
 * back to BOX1_NEW_GATE when the cell is blank or nonsense. 0 is a real value
 * here, not "no limit": box 1 can never hold fewer than 0 cards, so a 0 keeps
 * the gate permanently shut and no new card is ever introduced.
 */
function box1Gate_(config) {
  var raw = config ? config.box1_new_gate : '';
  if (String(raw === undefined || raw === null ? '' : raw).trim() === '') return BOX1_NEW_GATE;
  var n = Math.floor(Number(raw));
  if (!isFinite(n) || n < 0) return BOX1_NEW_GATE;
  return n;
}

/**
 * Returns one sitting's cards plus the summary counts the home screen shows.
 *
 * Shape of the queue: the box-1/box-2 block first, then boxes 3-7, with up to
 * NEW_PER_DAY new cards handed over separately (`newHeld`) for the client to
 * play after the block — but only if the box-1 pile is under the configured
 * gate (`box1_new_gate`) by then. The whole thing is capped by what is left of
 * today's budget.
 */
function getSession() {
  var data = readCards_();
  var cards = data.cards;
  var today = todayStr_();
  var config = readConfig_();

  var due = [];
  var newCards = [];
  var boxCounts = {};
  for (var bx = 1; bx <= MAX_BOX; bx++) boxCounts[bx] = 0;
  var flaggedCount = 0;
  var excludedCount = 0;
  var seenToday = 0;
  var newToday = 0;

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (String(card.exclude || '').trim() !== '') { excludedCount++; continue; } // dropped from practice
    if (String(card.flag || '').trim() !== '') flaggedCount++;
    // Already graded today, so already spent against today's budget. gradeCard
    // is the only writer of last_seen; the schedule-neutral drills write
    // nothing, so extra practice never eats into the day's allowance.
    if (normDate_(card.last_seen) === today) seenToday++;
    // Introduced today: graded today and graded exactly once ever. A card can't
    // come round twice in a day (the shortest interval is a day), so one attempt
    // plus today's stamp means today was its first encounter.
    if (!isNew_(card) && normDate_(card.last_seen) === today &&
        (Number(card.right) || 0) + (Number(card.wrong) || 0) === 1) newToday++;
    if (isNew_(card)) {
      newCards.push(card);
      continue;
    }
    var box = Number(card.box);
    if (boxCounts[box] !== undefined) boxCounts[box]++;
    var dueDate = normDate_(card.due);
    if (!dueDate || dueDate <= today) due.push(card);
  }

  // Rank the due pile by weakness, most in need first: Leitner box ascending
  // (box 1 = shakiest), then accuracy ascending (a card you miss half the time
  // outranks one you almost always get), then oldest due so nothing inside one
  // tier starves. shuffle_ ran first, so the stable sort leaves cards that tie
  // on all three in a different order each session — the same trick
  // `new_card_order: recent` uses below.
  //
  // This ranking decides the odds, not the running order: the batch is then
  // *drawn* from it (see sampleByUrgency_ below), because a solid wall of box-1
  // cards to open a session is demoralising.
  shuffle_(due);
  due.sort(function (a, b) {
    var ba = proficiencyBox_(a), bb = proficiencyBox_(b);
    if (ba !== bb) return ba - bb;
    var aa = accuracy_(a), ab = accuracy_(b);
    if (aa !== ab) return aa - ab;
    var da = normDate_(a.due) || '', db = normDate_(b.due) || ''; // blank = longest overdue
    if (da === db) return 0;
    return da < db ? -1 : 1;
  });

  // New-card selection order (config `new_card_order`): "recent" introduces the
  // most recently added cards first (by the `added` date); anything else keeps
  // the default random pick. Shuffle first either way so that in "recent" mode
  // cards added on the same day still vary between sessions (stable sort keeps
  // the shuffled order within an equal `added` date).
  shuffle_(newCards);
  if (String(config.new_card_order || '').toLowerCase() === 'recent') {
    newCards.sort(function (a, b) {
      var da = normDate_(a.added), db = normDate_(b.added);
      if (da === db) return 0;
      return da < db ? 1 : -1; // newer date first; blank `added` sorts last
    });
  }
  // Boxes 1-2 first, as one block, then the rest of the ladder. The ranking
  // above only sets the odds: each segment is *drawn* from it by sampleByUrgency_
  // (the weak drill's weighted draw, flattened by SESSION_MIX_SCALE) and then
  // dealt out by spreadByBox_, so box 1 and box 2 interleave inside the block
  // instead of opening on a wall of box 1, and boxes 3-7 interleave in the tail.
  // Neither order repeats between sessions.
  var weakDue = [], restDue = [];
  for (var w = 0; w < due.length; w++) {
    (proficiencyBox_(due[w]) <= PRIORITY_BOX ? weakDue : restDue).push(due[w]);
  }
  var weakOrdered = spreadByBox_(sampleByUrgency_(weakDue, weakDue.length, SESSION_MIX_SCALE));
  var restOrdered = spreadByBox_(sampleByUrgency_(restDue, restDue.length, SESSION_MIX_SCALE));

  // A day's budget, not a session's: whatever you graded earlier today is spent,
  // so a second sitting continues the same 80 rather than starting another one.
  var limit = dailyLimit_(config);
  var budget = limit > 0 ? Math.max(0, limit - seenToday) : due.length + newCards.length;

  // Spent in priority order: the weak block, then the new cards the client may
  // play, then as much of the tail as fits. restBatch is sized as if no new card
  // appears; when the gate opens the client splices newHeld in and drops the
  // same number of cards off the END of the tail, so a session is always exactly
  // `budget` cards and what it loses is its steadiest material.
  var weakBatch = weakOrdered.slice(0, budget);
  var left = budget - weakBatch.length;
  var newHeld = newCards.slice(0, Math.max(0, Math.min(NEW_PER_DAY - newToday, left)));
  var restBatch = restOrdered.slice(0, left);

  // True size of the weak-cards drill pool (same source of truth the drill
  // uses), so the button label matches what "Practice weak cards" serves.
  // Falls back to the box-based pool only when nothing has been missed yet.
  var weakRanked = computeWeakRanking_(cards);
  var weakCount = weakRanked.length || getWeakCardsByBox_(cards, cards.length).cards.length;

  // Size of today's-mistakes drill, from the same helper the drill uses.
  var errorCount = todaysErrors_(cards, today).length;

  // The 🎧 Soak list, counted with the same helper the player filters by.
  //
  // Wrapped for exactly the reason readConfig_ is: a getSession error blanks the
  // whole UI through the client's failure handler, and a side feature must never
  // be able to do that. A renamed or broken sentences tab costs you the Soak
  // button, not your deck.
  var sentenceCount = 0;
  var sentencesUrl = '';
  try {
    var sentences = readSentences_();
    sentenceCount = playableSentences_(sentences.items).length;
    // Deep-linked to the tab by gid, like cardsUrl: the "add sentences" modal
    // has to land you on the tab you are meant to type into.
    sentencesUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl() +
      '#gid=' + sentences.sheet.getSheetId();
  } catch (err) {
    // Count stays 0 and the URL blank — the client falls back to sheetUrl.
  }

  // Deep link to the `config` tab, for the ⚙ Settings screen's AI section:
  // AI assist is configured in the Sheet, so the app's job there is to point at
  // the right tab rather than to offer the settings itself. Guarded like
  // sentencesUrl — the client falls back to sheetUrl.
  var configUrl = '';
  try {
    configUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl() +
      '#gid=' + getConfigSheet_().getSheetId();
  } catch (err2) {
    // Blank, and the Settings link lands on the Sheet's first tab instead.
  }

  // Payload the client needs — strip nothing, but shape it explicitly.
  var queue = weakBatch.concat(restBatch).map(toClientCard_);

  return {
    today: today,
    dueCount: due.length,
    newCount: newCards.length,
    newInSession: newHeld.length,
    // How many leading queue cards are the box-1/box-2 block — where the client
    // runs the new-card gate — and the cards it plays there if the gate opens.
    weakBlock: weakBatch.length,
    newHeld: newHeld.map(toClientCard_),
    box1Count: boxCounts[1],
    newGate: box1Gate_(config),
    // The day's new-card allowance and what's left of it, so home can say which
    // of the two gates is the one holding new cards back.
    newToday: newToday,
    newPerDay: NEW_PER_DAY,
    // Today's budget: the limit, what is already spent, and what this sitting
    // may serve (queue.length, plus newHeld if the gate opens).
    dailyLimit: limit,
    seenToday: seenToday,
    dailyLeft: budget,
    totalCards: cards.length,
    activeCards: cards.length - excludedCount,
    boxCounts: boxCounts,
    weakCount: weakCount,
    errorCount: errorCount,
    sentenceCount: sentenceCount,
    flaggedCount: flaggedCount,
    excludedCount: excludedCount,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    // Same spreadsheet, but deep-linked to the `cards` tab via its gid. Used for
    // the "open the Sheet" links — landing on `cards` matters for import, where
    // "Append to current sheet" targets whatever tab happens to be active.
    cardsUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + data.sheet.getSheetId(),
    sentencesUrl: sentencesUrl,
    configUrl: configUrl,
    version: APP_VERSION,
    installId: installId_(),
    // Settings from the `config` tab. The client caches this for the page's
    // lifetime, which is why getWeakCards() doesn't need to return it too.
    config: config,
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
 * Ranks weak cards by how much they need review — the single source of truth
 * behind the practice drill (getWeakCards). Pure computation over the given
 * cards: reads nothing, writes nothing.
 *
 * A card is "weak" if it has been missed at least once (`wrong > 0`). Never-
 * missed cards — brand-new, or answered only correctly — are dropped. Excluded
 * cards, and mastered cards (box MASTERED_BOX and up), are skipped. Two tiers, most-urgent first:
 *   Tier 1: wrong but never yet right (`right == 0`) — you don't know it at all.
 *   Tier 2: mixed signal (`right > 0` and `wrong > 0`) — not yet stable.
 * Within each tier, the most recently missed cards come first (by `last_wrong`
 * date), so cards you got wrong in your latest session surface at the top; ties
 * in tier 2 break toward the more balanced (higher `min(right,wrong)`) card.
 *
 * Attaches transient `_tier`/`_score`/`_lastWrong` fields used only for the
 * sort; toClientCard_ ignores them (it whitelists fields).
 * @param {Array<Object>} cards Rows from readCards_().cards.
 * @return {Array<Object>} Ranked card objects, most-urgent first.
 */
function computeWeakRanking_(cards) {
  var ranked = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (String(card.exclude || '').trim() !== '') continue; // dropped from practice
    if (Number(card.box) >= MASTERED_BOX) continue; // mastered; no longer "weak"
    var right = Number(card.right) || 0;
    var wrong = Number(card.wrong) || 0;
    if (wrong === 0) continue; // never missed: covers brand-new and answered-only-right
    card._tier = right === 0 ? 1 : 2;
    card._lastWrong = normDate_(card.last_wrong); // '' when never recorded → sorts oldest
    card._score = Math.min(right, wrong);         // tier-2 balance; 0 for tier 1
    ranked.push(card);
  }
  ranked.sort(function (a, b) {
    if (a._tier !== b._tier) return a._tier - b._tier;          // tier 1 before tier 2
    if (a._lastWrong !== b._lastWrong)                          // most recently missed first
      return a._lastWrong < b._lastWrong ? 1 : -1;
    return b._score - a._score;                                // more balanced first (tier 2)
  });
  return ranked;
}

/**
 * Returns weak cards for a schedule-neutral practice drill. The client grades
 * these purely to advance the queue — no write happens, so box/due/right/wrong
 * are never touched.
 *
 * Because the drill never writes, computeWeakRanking_ would return the identical
 * top slice every run — the same cards forever. Instead we take the full ranked
 * pool and draw `cap` cards by weighted random sampling (sampleByUrgency_): the
 * most urgent cards come up far more often, but every weak card can appear, so
 * drills vary between runs and you eventually cover the whole pool. This does
 * NOT touch computeWeakRanking_ itself, so getSession (real practice) and the
 * weak-count button are unaffected.
 *
 * Falls back to the lowest-Leitner-box drill only when the tier ranking is
 * empty — e.g. a freshly-forked deck with no right/wrong history yet — so such
 * a Sheet still gets a useful "weak cards" practice.
 * @param {number} [limit] Max cards to return (defaults to PRACTICE_LIMIT).
 * @return {Object} { cards: [clientCard, ...] }.
 */
function getWeakCards(limit) {
  var cap = limit || PRACTICE_LIMIT;
  var cards = readCards_().cards;
  var ranked = computeWeakRanking_(cards);
  if (ranked.length === 0) return getWeakCardsByBox_(cards, cap);
  return { cards: sampleByUrgency_(ranked, cap).map(toClientCard_) };
}

/**
 * Weighted random sampling without replacement from an urgency-ranked list.
 * A card's weight decays exponentially with its rank (weight = e^(-rank/tau)),
 * so the most urgent cards are much likelier to be drawn while the long tail
 * still has a real chance — the drill favors what needs review but varies run
 * to run instead of always serving the same top slice. Result order follows the
 * draw (urgent-leaning first), which is fine for a drill.
 *
 * The weight of each card is fixed to its ORIGINAL rank and carried alongside
 * the pool as entries are removed, so removals don't reshuffle urgency.
 * @param {Array<Object>} ranked Cards most-urgent-first (from computeWeakRanking_).
 * @param {number} n How many to draw.
 * @param {number} [tauScale] Multiplies the decay scale: >1 flattens the odds,
 *     so the tail is drawn more often. Defaults to 1 (the drill's behaviour).
 * @return {Array<Object>} Up to n distinct cards.
 */
function sampleByUrgency_(ranked, n, tauScale) {
  var pool = ranked.slice();                       // don't mutate the caller's array
  var tau = Math.max(n, ranked.length / 4) * (tauScale || 1); // how fast urgency falls off
  var weights = [];
  for (var i = 0; i < pool.length; i++) weights.push(Math.exp(-i / tau));
  var out = [];
  var draws = Math.min(n, pool.length);
  for (var d = 0; d < draws; d++) {
    var total = 0;
    for (var w = 0; w < weights.length; w++) total += weights[w];
    var r = Math.random() * total;
    var idx = 0;
    for (; idx < weights.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
    out.push(pool[idx]);
    pool.splice(idx, 1);
    weights.splice(idx, 1);
  }
  return out;
}

/**
 * Fallback weak-cards drill: already-started cards, lowest Leitner box first.
 * Used only when no card has a right/wrong history for computeWeakRanking_ to
 * rank (a brand-new deck). Excluded and brand-new cards are skipped.
 * @param {Array<Object>} cards Rows from readCards_().cards.
 * @param {number} cap Max cards to return.
 * @return {Object} { cards: [clientCard, ...] }.
 */
function getWeakCardsByBox_(cards, cap) {
  var eligible = [];
  for (var k = 0; k < cards.length; k++) {
    var c = cards[k];
    if (String(c.exclude || '').trim() !== '') continue; // dropped from practice
    if (isNew_(c)) continue;                              // never-studied, no box yet
    if (Number(c.box) >= MASTERED_BOX) continue;         // mastered
    eligible.push(c);
  }
  // Shuffle first, then a stable sort by box gives variety within each box.
  shuffle_(eligible);
  eligible.sort(function (a, b) { return Number(a.box) - Number(b.box); });
  return { cards: eligible.slice(0, cap).map(toClientCard_) };
}

/**
 * Cards missed in today's study session — the short-horizon counterpart to the
 * weak drill. `last_wrong` is stamped only by gradeCard, and drills never write,
 * so this is exactly "what I got wrong in a real session today".
 *
 * Shuffled so that re-running it ("Keep going") varies the order. Like the weak
 * drill it is playback-only: nothing is written, so a card you re-drill
 * correctly stays on today's list until the date rolls over. That is deliberate
 * — this reviews the day's misses, it does not re-grade them.
 * @param {number} [limit] Max cards to return (defaults to ERROR_DRILL_LIMIT).
 * @return {Object} { cards: [clientCard, ...] } shuffled.
 */
function getErrorCards(limit) {
  var cap = limit || ERROR_DRILL_LIMIT;
  var errs = todaysErrors_(readCards_().cards, todayStr_());
  shuffle_(errs);
  return { cards: errs.slice(0, cap).map(toClientCard_) };
}

/**
 * The cards whose most recent miss is `today` — source of truth for both the
 * drill (getErrorCards) and the home-screen count (getSession.errorCount).
 * Pure: reads nothing, writes nothing.
 *
 * Deliberately simpler than computeWeakRanking_: no box-5 skip and no
 * `wrong > 0` test, because a wrong answer always resets the box to 1 and a
 * stamped `last_wrong` already implies `wrong >= 1` — both filters would be
 * dead code here.
 * @param {Array<Object>} cards Rows from readCards_().cards.
 * @param {string} today 'yyyy-MM-dd', from todayStr_().
 * @return {Array<Object>} The matching card objects, in sheet order.
 */
function todaysErrors_(cards, today) {
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (String(card.exclude || '').trim() !== '') continue; // dropped from practice
    if (normDate_(card.last_wrong) !== today) continue;
    out.push(card);
  }
  return out;
}

/**
 * The sentences for the 🎧 Soak player, in sheet order.
 *
 * Deliberately NOT shuffled here, unlike the two drills: the player's shuffle
 * toggle reorders the list it already holds, so doing it server-side would cost
 * a round trip and throw away the original order the toggle flips back to.
 *
 * Playback-only — nothing is written, so a sentence can be heard any number of
 * times without touching a cell.
 * @param {number} [limit] Max sentences to return (defaults to SENTENCE_LIMIT).
 * @return {Object} { sentences: [clientSentence, ...], total } — `total` is the
 *   full playable count, so the client can say so when the cap truncated it.
 */
function getSentences(limit) {
  var cap = limit || SENTENCE_LIMIT;
  var items = playableSentences_(readSentences_().items);
  return { sentences: items.slice(0, cap).map(toClientSentence_), total: items.length };
}

/**
 * Days until a card in this box is due again, scattered by ±BOX_JITTER so same
 * day cohorts fan out instead of returning together. Never less than a day, so
 * a card you just missed is still back tomorrow.
 * @param {number} box The box the card has just landed in.
 * @return {number} Whole days until it is due.
 */
function intervalFor_(box) {
  var base = BOX_INTERVALS[box] || 1;
  var spread = 1 + (Math.random() * 2 - 1) * BOX_JITTER;
  return Math.max(1, Math.round(base * spread));
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

    var interval = intervalFor_(newBox);

    card.box = newBox;
    card.due = addDaysStr_(interval);
    card.last_seen = todayStr_();
    card.right = (Number(card.right) || 0) + (correct ? 1 : 0);
    card.wrong = (Number(card.wrong) || 0) + (correct ? 0 : 1);
    // Stamp the date of the most recent miss so the weak-cards drill can
    // surface recently-missed cards first. Left untouched on correct answers.
    if (!correct) card.last_wrong = todayStr_();

    // Write ONLY the progress columns. Writing the whole row back would re-enter
    // the content cells, and Sheets parses a written string starting with "=" as
    // a formula — which turned every graded card whose front_side used
    // `==highlight==` into #ERROR!. Grading has no business touching content.
    // box…wrong are contiguous in HEADERS; last_wrong is not, so it writes alone.
    var boxCol = HEADERS.indexOf('box') + 1;
    sheet.getRange(row, boxCol, 1, 5)
      .setValues([[card.box, card.due, card.last_seen, card.right, card.wrong]]);
    if (!correct) {
      sheet.getRange(row, HEADERS.indexOf('last_wrong') + 1).setValue(card.last_wrong);
    }

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
        setTextValue_(sheet.getRange(row, col), val);
        updated[key] = val;
      }
    }
    return { row: row, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Writes one cell as literal text.
 *
 * `setValue` emulates typing, so a string starting with "=" (also "+", "-", "@")
 * is parsed as a formula — a card front of `==ب==اب` lands as #ERROR!. Plain-text
 * number format turns that parsing off; the read-back is belt and braces, falling
 * back to Sheets' own apostrophe escape if a future runtime parses anyway. Cells
 * that cannot start a formula take the plain path and keep their format.
 */
function setTextValue_(range, value) {
  var s = value == null ? '' : String(value);
  if (!/^[=+\-@]/.test(s)) { range.setValue(s); return; }
  range.setNumberFormat('@');
  range.setValue(s);
  if (range.getValue() !== s) range.setValue("'" + s);
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
