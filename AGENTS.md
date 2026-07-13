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
  `getSession` / `gradeCard` / `updateCard` API. Also handles `?action=seed`.
- `Index.html` — the entire UI (inline CSS/JS + a small Markdown renderer;
  CDN scripts are blocked in the Apps Script sandbox).
- `Seed.js` — starter deck + `seedCards` / `resetAndReseed`.
- `appsscript.json` — manifest (timezone + web-app access).

Tunables live at the top of `Code.js`: `BOX_INTERVALS`, `MAX_BOX`,
`KNOWN_START_BOX`, `NEW_PER_SESSION`, `FLAG_MARK`.

## Sheet schema (`cards` tab) — order matters
`id, type, front_side, back_side, notes, box, due, last_seen, right, wrong, added, flag, exclude`
- `HEADERS` in `Code.js` is the single source of truth; reads/writes are positional.
- `box` blank = new card. `flag` = `⚑` when flagged. `exclude` non-empty (`x`) = soft-deleted (skipped).
- `ensureSchema_()` self-heals missing columns on load without touching data.
