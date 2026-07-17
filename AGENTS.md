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

### 6. Seed the starter deck — [HUMAN], simplest via the menu
The bound script adds a **🎴 Flashcards** menu to the Sheet (via `onOpen`).
Ask the user to open the Sheet (Extensions is not needed) and click
**🎴 Flashcards → Load starter deck**. They may get a one-time authorization
prompt on first click — same "unverified app" flow as gate #3.

Alternative (**[AGENT]**, only if access is not `MYSELF`): hit the URL directly.
```bash
curl -L "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=seed"
```
`doGet` runs `seedCards()` for `?action=seed`. This only works **after** the app
is authorized (step 5), and under the default `MYSELF` access an unauthenticated
`curl` bounces to a login page — so the menu path above is the reliable one.

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
- asking the user to open the `/exec` URL and confirm the app loads and the deck seeded.

## Access model
`appsscript.json` → `webapp.access`:
- `MYSELF` — only the owner (every browser must be signed into the owning account). Default.
- `ANYONE` — anyone with a Google account.
- `ANYONE_ANONYMOUS` — anyone with the link, no sign-in.

The app always runs as the deploying user and only ever touches that user's own
Sheet, regardless of access level.

## Project files (what gets pushed)
`.claspignore` limits the push to four files:
- `Code.js` — backend: `doGet`, Leitner logic, sheet I/O, the
  `getSession` / `getWeakCards` / `gradeCard` / `updateCard` API. Also handles
  `?action=seed`. `getWeakCards` returns low-box cards for the schedule-neutral
  practice drill (the client grades them without writing back). Also owns the
  `config` tab (`readConfig_`) and `resetForFork`.
- `Index.html` — the entire UI (inline CSS/JS + a small Markdown renderer;
  CDN scripts are blocked in the Apps Script sandbox).
- `Seed.js` — starter deck + `seedCards` / `resetAndReseed`.
- `appsscript.json` — manifest (timezone + web-app access).

Tunables live at the top of `Code.js`: `BOX_INTERVALS`, `MAX_BOX`,
`KNOWN_START_BOX`, `NEW_PER_SESSION`, `PRACTICE_LIMIT`, `FLAG_MARK`.

## Sheet schema (`cards` tab) — order matters
`id, type, front_side, back_side, notes, box, due, last_seen, right, wrong, added, flag, exclude`
- `HEADERS` in `Code.js` is the single source of truth; reads/writes are positional.
- `box` blank = new card. `flag` = `⚑` when flagged. `exclude` non-empty (`x`) = soft-deleted (skipped).
- `ensureSchema_()` self-heals missing columns on load without touching data.

## Settings (`config` tab) — [AGENT]
A second tab, `config`, holds `key` / `value` rows. It is created with defaults on
first run (`ensureConfigSchema_`, same self-healing idea as `ensureSchema_`), so
there is nothing to set up and nothing to migrate.

| key | default | meaning |
|-----|---------|---------|
| `target_language` | `nl-NL` | The language being studied. BCP-47 tag. **This is the only thing to change for a non-Dutch deck.** |
| `speech_rate` | `0.9` | Speaking speed. |
| `auto_speak` | `yes` | Speak the example on reveal? |
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

## Authoring your own deck as CSV — [AGENT]

Generating a deck is the one part of this an agent can do end-to-end. The app has
**no CSV importer** — you produce a CSV, the user imports it into the `cards` tab
with Google Sheets' built-in **File → Import**. The Sheet is the database, so
that import *is* the load.

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
as a lookup key. Consequences:
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
   *empty* header cells, so a mangled header stays mangled.

### Writing cards that are actually good
- **One fact per card.** If `back_side` has two unrelated senses, make two cards.
- **Front is the retrieval cue** — keep it short and unambiguous. A front that
  matches three different answers trains nothing.
- Put disambiguation, register, and a usage example in `notes`, not `back_side`,
  so grading stays a clean yes/no.
- Bold the core gloss in `back_side` and italicise an example sentence (see the
  example above). This is not only typography: **the app speaks _italic_ spans
  aloud in `target_language` and never speaks the bold gloss**, so following the
  convention is what makes text-to-speech read the right half of the card. An
  example sentence left un-italicised is an example the learner never hears.
- Use `type` for anything the user may want to filter or bulk-edit later
  (CEFR level, part of speech, source chapter).
