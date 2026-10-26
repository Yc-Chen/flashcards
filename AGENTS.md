# AGENTS.md — deploy this app with a coding agent

This file is for a **coding agent** (Claude Code, etc.) deploying this repo into
the *user's own* Google account. It splits every step into **[AGENT]** (you can
run this non-interactively) and **[HUMAN]** (a browser step Google forces on the
account owner — stop and hand it to the user).

There is no way around the three [HUMAN] gates: they are Google OAuth /
security screens that cannot be completed headlessly. Your job is to run
everything else and pause cleanly at each gate with clear instructions.

## What you're deploying
A mobile-first flashcard web app backed by a Google Sheet, served by a
**Sheet-bound Google Apps Script web app**. The Sheet is the database. Deploying
means: create a Sheet + bound script in the user's account, push these sources,
deploy as a web app, and load the starter deck.

## Prerequisites
- Node.js + npm available in the environment. **[AGENT]** may install these.
- A Google account. Everything below happens in **that user's** account.

## The three human gates (read first)
1. **`clasp login`** — opens a browser for Google OAuth consent. **[HUMAN]**
2. **Enable the Apps Script API** at <https://script.google.com/home/usersettings>
   (toggle "Google Apps Script API" on). **[HUMAN]**
3. **First-run authorization** — the deployed web app runs *as the deploying
   user*, so its first execution shows an "unverified app → Advanced → Go to
   … (unsafe)" consent screen. Expected — it's the user's own script. **[HUMAN]**

## Deploy sequence

### 1. Install clasp — [AGENT]
```bash
npm install -g @google/clasp
```

### 2. Log in — [HUMAN]
Stop and ask the user to run this themselves (it opens a browser):
```bash
clasp login
```
Then have them enable the Apps Script API (gate #2 above). Do not proceed until
both are done — `clasp create` fails otherwise.

### 3. Create the Sheet-bound project — [AGENT]
Run from a clean clone. `.clasp.json` is gitignored, so a fresh clone has none;
this command writes a new one pointing at the user's new Sheet + script.
```bash
clasp create --type sheets --title "Flashcards" --rootDir .
```
**Immediately restore the manifest** — `clasp create` overwrites
`appsscript.json` with a default (wrong timezone, no web-app block):
```bash
git checkout -- appsscript.json
```
> Optional: set `webapp.access` in `appsscript.json` before pushing. Default is
> `MYSELF` (only the owner, signed into that account). See "Access model" below.

### 4. Push and deploy — [AGENT]
```bash
clasp push --force
clasp deploy --description "v1"
```
`clasp deploy` prints a **deployment ID**. The web-app URL is:
`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`
Report both back to the user.

### 5. First open + authorize — [HUMAN]
Give the user the `/exec` URL and tell them to open it **while signed into the
deploying account**. On first open they'll get the "unverified app" consent
screen (gate #3) — Advanced → Go to Flashcards → Allow. This one-time step
authorizes the script's scopes.

### 6. Load the starter deck — [HUMAN], via File → Import
There is no seeding code — the starter deck ships as
[`decks/starter-dutch.csv`](./decks/starter-dutch.csv), loaded with Google
Sheets' own importer, which is browser-only. After the first open (step 5)
has created the empty `cards` tab, ask the user to: open the Sheet, select
the `cards` tab, **File → Import → Upload** the CSV, import location
**Replace current sheet** (the CSV brings its own header row), and
**"Convert text to numbers, dates, and formulas" → No**. The same rules as
"Import path" below apply. **🎴 Flashcards → Check Sheet health** (in the
Sheet's menu, added by `onOpen`) then confirms the tab and column names
survived the import.

### 7. Redeploy after later code changes — [AGENT]
Reuse the same deployment ID so the URL (and any Home Screen icon) stays stable:
```bash
clasp push --force
clasp redeploy <DEPLOYMENT_ID> --description "..."
```

## Verification caveat — you probably can't verify end-to-end
With the default `access: MYSELF`, the app opens **only** in a browser signed
into the deploying account. Your browser tools are almost certainly a different
account and will show "unable to open the file." **Do not treat that as a
deployment failure.** Confirm success by:
- checking `clasp deploy` / `clasp redeploy` exited 0 and printed a deployment ID, and
- asking the user to open the `/exec` URL and confirm the app loads and shows their deck.

## Access model
`appsscript.json` → `webapp.access`:
- `MYSELF` — only the owner (every browser must be signed into the owning account). Default.
- `ANYONE` — anyone with a Google account.
- `ANYONE_ANONYMOUS` — anyone with the link, no sign-in.

The app always runs as the deploying user and only ever touches that user's own
Sheet, regardless of access level.

## Project files (what gets pushed)
`.claspignore` limits the push to three files:
- `Code.js` — backend: `doGet`, Leitner logic, sheet I/O, the
  `getSession` / `getWeakCards` / `getSentences` / `gradeCard` / `updateCard` API.
  `getWeakCards` returns low-box cards for the schedule-neutral practice
  drill (the client grades them without writing back). Also owns the `config`
  tab (`readConfig_`), `resetForFork`, and the menu's `checkSheetHealth`
  layout diagnostic.
  The `ai*` functions behind the **AI assist** menu live here too — see
  "AI assist" below.
- `Index.html` — the entire UI (inline CSS/JS + a small Markdown renderer;
  CDN scripts are blocked in the Apps Script sandbox).
- `appsscript.json` — manifest (timezone + web-app access).

Not pushed but part of the product: `decks/` holds starter decks as plain CSV
(loaded via **File → Import**, never via code).

Tunables live at the top of `Code.js`: `BOX_INTERVALS`, `MAX_BOX`,
`KNOWN_START_BOX`, `NEW_PER_DAY`, `PRIORITY_BOX`, `SESSION_MIX_SCALE`,
`BOX_FRONT_LOAD`, `PRACTICE_LIMIT`, `FLAG_MARK`. `BOX1_NEW_GATE` and
`DAILY_LIMIT` are fallbacks only — the live values are the `box1_new_gate` and
`daily_limit` config rows.

Boxes run 1→7 (`1, 2, 4, 8, 16, 32, 64` days). Boxes 6-7 were added because a
mature deck is ~80% top-box, which pins the daily load at deck/16. `MASTERED_BOX`
(5) stays where box 5 used to be, so the weak-cards drill's pool is unchanged.
`intervalFor_` scatters every due date by ±`BOX_JITTER` (15%) to break up
same-day cohorts; `boxCounts` and the home box bar follow `MAX_BOX` rather than
a hardcoded 5.

`getSession` builds one sitting in three stages. Boxes 1..`PRIORITY_BOX` (2) come
first as one block, then boxes 3-7; each segment is ordered by the weakness
ranking (`proficiencyBox_`, then `accuracy_`, then oldest `due`) and then drawn
and dealt by `sampleByUrgency_(segment, segment.length, SESSION_MIX_SCALE)` +
`spreadByBox_`, which weights each box's progress by `box^BOX_FRONT_LOAD` — so
boxes 1 and 2 alternate through the opening block rather than arriving in one
wall, and the mature boxes do the same in the tail.

New cards are handed to the client separately (`newHeld`, with `weakBlock`,
`box1Count` and `newGate`), not spliced into the queue. The client's
`resolveGate_` plays them only when the box-1/box-2 block is done AND box 1 is
under the gate — recounted from the grades just given (a box-1 card
answered right leaves box 1; a box-2 card missed joins it). The threshold comes
from the `box1_new_gate` config row via `box1Gate_` (`BOX1_NEW_GATE`, 20, is the
fallback) and travels to the client in `newGate`, which is also what the home
screen's "new cards wait until box 1 is under N" line reads — so the number is
stated in one place only. `NEW_PER_DAY` (10) is
a DAY's allowance, not a sitting's: `getSession` subtracts the cards whose first
grade was today (`last_seen` today and exactly one attempt ever), so a second
sitting cannot start it over. When it opens, the
new cards are inserted at the current position and the same number of cards is
dropped off the END of the queue, so the sitting stays inside its budget.

That budget is per DAY, not per session: `daily_limit` (default `DAILY_LIMIT`,
80; `0` = unlimited) minus the cards already graded today, counted from
`last_seen`, which only `gradeCard` writes — the schedule-neutral drills cost
nothing. Spent in priority order (weak block, then new, then tail); when it
reaches 0 the home screen says so and only the drills remain.

## Sheet schema (`cards` tab) — order matters
`id, type, front_side, back_side, notes, box, due, last_seen, right, wrong, added, flag, exclude`
- `HEADERS` in `Code.js` is the single source of truth; reads/writes are positional.
- `box` blank = new card. `flag` = `⚑` when flagged. `exclude` non-empty (`x`) = soft-deleted (skipped).
- `ensureSchema_()` self-heals missing columns on load without touching data.

## Sentences (`sentences` tab) — [AGENT]
A third tab, created with its header row on first run by `ensureSentenceSchema_`
(same self-healing idea as `ensureSchema_`), holding whole sentences for the
**🎧 Soak** player: `id, text, note, tag, added, exclude`. Read positionally like
`cards`. `text` is the sentence and the only column ever spoken — in
`target_language`, the same setting the cards use, so there is nothing extra to
configure. `note` is displayed but never read aloud. Playback-only: the player
writes nothing, ever. Nothing to set up for a new deck; leave the tab empty and
the home button becomes a signpost to it.

## Settings (`config` tab) — [AGENT]
A second tab, `config`, holds `key` / `value` rows. It is created with defaults on
first run (`ensureConfigSchema_`, same self-healing idea as `ensureSchema_`), so
there is nothing to set up and nothing to migrate.

| key | default | meaning |
|-----|---------|---------|
| `target_language` | `nl-NL` | The language being studied. BCP-47 tag. **This is the only thing to change for a non-Dutch deck.** |
| `native_language` | `English` | The language AI explanations and translations come back in — the owner's, not the one being studied. A plain **name**, not a tag: nothing speaks it, and its only reader is a sentence of prose aimed at a model, where `explain in en-GB` reads like a typo. |
| `speech_rate` | `0.9` | Speaking speed. |
| `auto_speak` | `yes` | Speak the example on reveal? |
| `sentence_gap` | `1.5` | Seconds of silence after each sentence in 🎧 Soak. |
| `sentence_repeat` | `1` | Times 🎧 Soak speaks each sentence before moving on. |
| `daily_limit` | `80` | Most cards one day serves, across all sittings; cards already graded today count against it. `0` = no limit. |
| `box1_new_gate` | `20` | New cards wait while box 1 holds this many cards or more, checked after the box-1/box-2 block. `0` = never introduce new cards (box 1 can't hold fewer than 0). Sheet-only — not in ⚙ Settings. |
| `update_check` | `yes` | Daily anonymous version-check ping (hashed copy id + app version) to the author's collector endpoint. `no` disables it; also toggleable in the app's ⚙ Settings. |
| `ai_endpoint` | `https://generativelanguage.googleapis.com/v1beta` | Where **AI assist** sends a card. Google's Gemini API only; see "AI assist" below. Sheet-only. |
| `ai_model` | `gemini-flash-latest` | Which Gemini model. Ignored when `ai_endpoint` already names one in its path. Sheet-only. |
| `webapp_url` | *(blank)* | `/exec` link for the Sheet's "Open the app ↗" menu. Blank = auto-detect. |

Reading it is deliberately failure-proof: `readConfig_()` catches everything and
falls back to defaults, because every other server read blanks the whole UI on
error and a typo'd setting must not do that.

**If you built the deck, set `target_language` to match it — this is not optional
polish.** It defaults to `nl-NL` (the starter deck is Dutch). Leave it there on a
Chinese deck and the Dutch voice cannot render a single Han character: it drops
them all and reads the leftover punctuation by name, so the phone just says
*"punt"*. The app now catches the obvious CJK-vs-Latin case and refuses to speak,
but it cannot tell `nl-NL` from `de-DE` — so set it explicitly rather than
relying on that.

## AI assist (fill in cards) — two routes, one contract

Cards get answered by an AI, either in the app (**✨ Fill cards with AI** on the
home screen — paste the prompt into any AI you have, paste the reply back, and
approve a before/after preview) or from the Sheet (**🎴 Flashcards → AI assist →
Fill in new + flagged cards**, which calls Google's Gemini API with a key of
your own). Both write through the same `aiWriteCard_`, so there is one set of
rules about what an AI may change. Two kinds of card qualify:

- **no answer yet** — a new card (blank `box`) with an empty `back_side`.
- **flagged** (`⚑`) — the owner marked it as wrong or thin.

What gets written, and nothing else:

| column | when |
|---|---|
| `back_side` | always — this is the field being asked for |
| `front_side` | **only on a card that is still new**, and only if the AI returns one |
| `notes` | **cleared**, unless "keep my notes" |
| `flag` | **cleared**, unless "keep the flags" |

`box`, `due`, `last_seen`, `right` and `wrong` are never touched, so no card's
schedule moves.

Three things about that table are deliberate:

**The AI is never asked for `notes`.** It used to be — back when nothing was
previewed, `back_side` was the answer the owner had been graded against and
rewriting it silently was not defensible, so the AI's contribution went into a
hint underneath instead. The preview removes that constraint: you see the old
and the new answer side by side and press the button yourself. `notes` is now
the owner's own field, and the AI never writes one.

**`flag` and `notes` are cleared rather than kept.** Both are marks that a card
needed work, and the work has just been done; leaving them would mean the card
comes back as a target on the next run forever. The two toggles in the preview
keep either one, per batch.

**`front_side` only moves on a card that is still new.** A blank `box` means the
card has never been studied, so tidying its prompt (an article to strip, a
parenthetical, a typo) costs nothing. A studied card has been retrieved against
that exact prompt — changing it would alter what the owner has been practising
rather than improve it — so a `front_side` in the reply is ignored there. This
is decided by `isNew` on the target, not by the job: a flagged card whose answer
was deleted is `job: 'fill'` but is not new.

### Setting it up (the Gemini route only)
The app's route needs none of this — it has no key and no endpoint, which is
the point of it. These three steps are for the Sheet menu's automatic fill.

1. **Set the API key** — *AI assist → Set the API key…*, from
   <https://aistudio.google.com/apikey>. It lands in the
   script's own properties, **not** in a config cell: the Sheet gets copied,
   exported and shared, and a key in a cell travels with it. (The flip side:
   Script Properties do not survive a Sheet copy, so a fork sets its own key.)
2. **Set `ai_endpoint` and `ai_model`** in the config tab. **Gemini only** —
   one provider on purpose: every API has its own request shape, its own way of
   carrying the key and its own way of reporting a refusal, so each extra one is
   a code path that can only be tested one at a time. Gemini is the one with a
   free tier, so it is the one that works for someone who has not bought
   anything. `aiIsGemini_` refuses anything else with a message saying so.

   Google is also the API that **names the model in the path**, so both forms
   work and `aiGeminiUrl_` resolves them:

   | `ai_endpoint` | `ai_model` | URL that gets POSTed |
   |---|---|---|
   | `…/v1beta` (or `…/v1beta/models`) | used | `…/v1beta/models/{ai_model}:generateContent` |
   | `…/v1beta/models/{model}:generateContent` | **ignored** | exactly as pasted |

   A Google URL that is neither is refused rather than composed on a guess: a
   wrong one 404s with a message about models and sends you looking in the
   wrong place. `aiConfig_().model` / `.modelFrom` are what actually gets asked
   and where it came from; *Test the connection* prints both, so a leftover
   `ai_model` that the URL overrides is visible rather than silently ignored.
   The `:generateContent` form is accepted on any host, so a proxy in front of
   Google still works.

   The request is the shape Google's own quickstart prints: `X-goog-api-key`,
   `contents[].parts[].text`, no `systemInstruction` and no `generationConfig`
   — the instructions ride in the single user part, because a field an older
   endpoint doesn't know is a 400 that reads like a model problem. Replies are
   read from `candidates[0].content.parts[]`, with `promptFeedback.blockReason`
   and a non-`STOP` `finishReason` reported as their own per-card failures.
   Vertex AI's host speaks the same shape but wants an OAuth token, not a key;
   it is accepted as a URL and fails saying the key was rejected, which is true.
3. **Test the connection** — one cheap round-trip that names the key, endpoint,
   model and format problem if there is one.

A chat subscription is **not** an API key: Gemini Advanced (like Claude Pro or
ChatGPT Plus) does not include API access, which has its own key. Say so plainly
rather than letting someone paste a session cookie — and point them at the
app's route below, which is the one that works with a subscription. Gemini's
free tier covers filling cards; its rate limit is per minute, which is what a
429 here usually means.

Adding this put `UrlFetchApp` in `Code.js` for the first time, so Apps Script
now infers the `script.external_request` scope — **the next menu action after
this ships asks for authorization again.** Expected, once.

### Shape of a Gemini run (the Sheet's route)
One card is one request, and each card is written as its answer arrives, so a
failure costs that card and nothing else. A menu action gets ~6 minutes from
Apps Script, so a run stops at `AI_PER_RUN_LIMIT` (15) cards or 4 minutes and
reports what is left — run it again to carry on. Before writing, the row's
`front_side` is re-read and compared: write-back is by row number (see
"Write-back is by row number" below), and landing a generated answer on the
wrong card is the one unrecoverable outcome here.

HTTP failures are translated by status, because the status says who fixes what:
401/403 the key, 404 usually the model (it is in the path), 400 the model name
or a key that cannot reach it, 429 the per-minute quota. 5xx is Google's own
“this model is experiencing high demand” often enough to be worth waiting out,
so `aiCall_` retries those `AI_MAX_ATTEMPTS` (3) times, pausing 2s then 4s; a
5xx that survives that says plainly that nothing is wrong with your setup.

**No outcome is ever reported only in a `ui.alert`.** That call does not return
until someone clicks OK, so a dialog that is never answered — or never renders,
because the Sheet is not the tab in front of you — holds the execution open
until Apps Script kills it at six minutes, logging “Exceeded maximum execution
time” and losing the account of what actually happened. Every AI result goes
through `aiShowResult_`, which logs the line first and then shows a **modeless**
dialog, which returns immediately. The only blocking dialogs left in this
feature are the two that ask a genuine question — the key prompt and the fill
confirmation — and both of them block before any work is done, so a timeout
there costs nothing.

**This route writes with no preview**, so its confirmation has to do the
preview's job: `menuAiFill_`'s `ui.alert` says in those words that answers are
rewritten and that flags and notes are cleared, and points at the app for
anyone who wants to see each change first.

A key, an endpoint or a model problem would repeat on every remaining card, so
it stops the run (`aiError_` marks them `fatal`); a refusal or an unparseable
reply is per-card and the run carries on.

### The app's route: copy out, paste back, preview

An API key is the one thing a local model and a chat subscription do not come
with, and the Sheet is the wrong place to be doing this from anyway. **✨ Fill
cards with AI** on the home screen is three steps in one panel, backed by three
client-callable functions in `Code.js` (none `_`-suffixed — `google.script.run`
cannot reach private functions):

| step | function | what it does |
|---|---|---|
| 1. Copy the prompt | `aiPrompt()` | `aiBatchPrompt_` over the first `AI_COPY_LIMIT` (40) targets → `{ prompt, count, total, limit }` |
| 2. Paste the reply | `aiPreview(text)` | `{ changes, problems }` — resolves the reply without writing anything |
| 3. Read it, then write | `aiApply(text, opts)` | `{ written, filled, redone, problems }`, `opts = { keepFlag, keepNotes }` |

`aiApply` takes **the reply text again, not the previewed objects**. One parse
implementation, nothing client-shaped to trust, and the Sheet is read afresh at
write time — so a card that changed between the preview and the button is
caught by the row guard rather than written from stale state. Both calls run
through `aiResolve_`, which is also where the targets are recomputed, so a card
filled in by hand in the meantime simply stops being one.

Each change is a plain object the client renders with its own `md()`:
`{ row, id, type, isNew, job, given, front: {before, after}, back: {before,
after}, notes, flag }`. `notes` and `flag` are the card's *current* values, not
a decision — the panel's two toggles redraw from them with no round trip, and
only the `opts` sent with `aiApply` decide what happens. `given` records
whether the reply carried an answer at all, which is not the same as the answer
having changed: a model that returns the existing answer verbatim has still done
its job, and the card still counts as dealt with.

Parsing is deliberately forgiving (`aiParseReply_`), because the text has been
through a chat window: an array, a lone object, or an object keyed by card
number, wrapped in a code fence or a sentence of commentary. The one thing it
cannot do without is a **card number per answer, which is the sheet row**, not
`id` — `id` is free-form here (blank and duplicate values are both legal, and
*Renumber id column* rewrites the lot), while the row is what a write-back
addresses. A row named twice is written once.

The copy button is the convenience, not the mechanism: the app is served in a
cross-origin iframe where a scripted copy can be refused outright (iOS Safari
most of all), so the textarea stays visible and selectable and the fallback text
names the manual gesture.

### A paragraph from the words you keep missing

**✨ Make a paragraph from my mistakes** on the home screen builds one prompt
asking for a short paragraph that uses every word you have been getting wrong.
It is **copy-only**: there is no paste-back step, nothing is written to any tab,
and no card is touched. The whole feature is `aiWordsPrompt(window)` returning a
string, plus a panel to copy it out of.

Drilling shows a word on its own, which is not how anyone meets one. This is the
cheap way to see twenty of them in use without authoring sentences by hand.

**Three windows**, because "the words I keep getting wrong" means different
things on different days. `aiWrongWords_(cards, window)`:

| window | rule |
|---|---|
| `today` | `last_wrong` is today — the same test the Today's mistakes drill uses |
| `week` | `last_wrong` within `AI_WORDS_WINDOW_DAYS` (7) |
| `all` | `computeWeakRanking_`'s pool: still unmastered, and missed at least once ever |

All three skip excluded cards and cards with an empty front, and all three are
ordered by `rankByTrouble_` — the comparator lifted out of `computeWeakRanking_`
so the drill and the prompt cannot drift apart. The cap is `AI_WORDS_LIMIT`
(20), lower than `AI_COPY_LIMIT` because every word has to earn a place in one
readable paragraph; the list is worst-first, so the cap trims the least
troublesome. The panel's chooser shows all three counts, and opening it on an
empty window slides to the first one that has something.

**Each word goes in with its gloss** (`verdom — to flatly refuse`), the first
non-blank line of `back_side` with its Markdown stripped. This is not padding: a
model handed a bare list of foreign words quietly guesses at the ones it
half-knows, and a paragraph that uses your word wrongly is worse than no
paragraph — you would be practising the error. The example sentence on the next
line is deliberately left out; it is the thing being replaced.

The prompt asks for the practised words in `_underscores_` and a translation in
`native_language` underneath. That is this app's own convention (italic spans
are spoken in `target_language`, the rest is not), so a paragraph that comes
back in that shape can be pasted into the `sentences` tab by hand and 🎧 Soak
will read the right half of it. Nothing automates that — it just fits.

## Authoring your own deck as CSV — [AGENT]

Generating a deck is the one part of this an agent can do end-to-end. The app has
**no CSV importer** — you produce a CSV, the user imports it into the `cards` tab
with Google Sheets' built-in **File → Import**. The Sheet is the database, so
that import *is* the load. (The starter deck itself ships this way:
[`decks/starter-dutch.csv`](./decks/starter-dutch.csv) — a working example of
everything below.)

### Column reference

Emit **all 13 columns in this exact order**, with this exact header row. Reads are
positional (`Code.js:208`), so a reordered or missing column silently shifts every
field into the wrong slot.

| # | column | what you write |
|---|--------|----------------|
| 1 | `id` | any unique value; sequential integers are fine |
| 2 | `type` | optional tag, shown as a badge on the card (e.g. `B1`, `vocab`, `grammar`). Blank is fine |
| 3 | `front_side` | the prompt — **required**, Markdown |
| 4 | `back_side` | the answer — **required**, Markdown |
| 5 | `notes` | optional hint/example shown under the answer, Markdown |
| 6 | `box` | **leave blank** — blank means "new card" |
| 7 | `due` | **leave blank** — the app sets it on first grade |
| 8 | `last_seen` | **leave blank** — app-managed |
| 9 | `right` | **leave blank** — app-managed |
| 10 | `wrong` | **leave blank** — app-managed |
| 11 | `added` | optional date reference of your own, `YYYY-MM-DD` |
| 12 | `flag` | **leave blank** — set to `⚑` by the app |
| 13 | `exclude` | **leave blank** — set to `x` by the app |

Columns 6–10, 12, and 13 are the app's bookkeeping. Writing values there hands
the user a deck that is already half-way through a schedule they never studied.
**Blank is the correct value for a new deck.**

### Minimal example

```csv
id,type,front_side,back_side,notes,box,due,last_seen,right,wrong,added,flag,exclude
1,B1,oké,oké; spreek uit: ookee,,,,,,,2026-07-11,,
2,B1,verdom,"**to flatly refuse; damn**

_Ik verdom het om nog langer te wachten._","Strong, informal.",,,,,,2026-07-11,,
```

Row 2 shows the two things worth copying: **Markdown in `back_side`**, and a
**multi-line field** wrapped in double quotes with a real newline inside. That
renders as a proper line break in the app. Standard RFC 4180 rules — escape a
literal `"` by doubling it (`""`), and save the file **UTF-8** so accents and `⚑`
survive.

### Two failure modes to design around

**Sheets will eat some of your cards on import.** A field starting with `=`, `+`,
`-`, or `@` is parsed as a formula, and things like `1/2` or `3-4` become dates.
For a language deck this is a live risk, not a hypothetical. Tell the user to set
the import dialog's **"Convert text to numbers, dates, and formulas" → No**;
that one toggle prevents all of it.

**Write-back is by row number, not by `id`.** `gradeCard`/`updateCard` locate a
card by its 1-based sheet row (`Code.js:209`, `_row = i + 2`) — `id` is never used
as a lookup key (which is why **🎴 Flashcards → Renumber id column**, i.e.
`renumberIds`, can rewrite the whole column without risking progress).
Consequences:
- Importing with **Append** is safe; existing rows keep their positions.
- Importing with **Replace current sheet** discards all existing progress. Only
  suggest it for a fresh deck, and say so plainly.
- The user must not sort or insert rows **while a session is open** — grades land
  on whatever now occupies that row. Reloading the app afterwards is fine.

### Import path — [HUMAN]
Sheets' importer is browser-only; you cannot do this step for them.
1. Open the Sheet → **File → Import → Upload** the CSV.
2. Import location: **Append to current sheet** (keeps progress) or **Replace
   current sheet** (fresh start — destroys existing cards).
3. **"Convert text to numbers, dates, and formulas" → No** (see above).
4. If replacing, confirm the header row survived — `ensureSchema_()` refills only
   *empty* header cells, so a mangled header stays mangled. The menu's
   **🎴 Flashcards → Check Sheet health** reports any tab/column-name mismatch.

### Writing cards that are actually good
- **One fact per card.** If `back_side` has two unrelated senses, make two cards.
- **Front is the retrieval cue** — keep it short and unambiguous. A front that
  matches three different answers trains nothing.
- Keep `back_side` to one fact so grading stays a clean yes/no; a short register
  parenthetical on the gloss line (`**to flatly refuse** (informal)`) is part of
  the gloss, not a second fact.
- `notes` is the owner's field — what *they* keep getting wrong, shown under the
  answer. An AI fill never writes one and clears it by default (see "AI assist"
  above), so do not put anything there that the deck depends on.
- Bold the core gloss in `back_side` and italicise an example sentence (see the
  example above). This is not only typography: **the app speaks _italic_ spans
  aloud in `target_language` and never speaks the bold gloss**, so following the
  convention is what makes text-to-speech read the right half of the card. An
  example sentence left un-italicised is an example the learner never hears.
- Use `type` for anything the user may want to filter or bulk-edit later
  (CEFR level, part of speech, source chapter).
