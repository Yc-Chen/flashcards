# 🎴 Flashcards

A mobile-first flashcard web app backed by a **Google Sheet**. Practice any deck
with simple **Leitner** spaced repetition, on your phone, tablet, or laptop. Card
text supports **Markdown**. No server to host and no database to run — the Google
Sheet *is* the database, and Google Apps Script serves the app.

- **Backend:** a Google Sheet (`cards` tab). Add/edit cards from anywhere.
- **App:** a single Apps Script web app (mobile-first, add-to-home-screen friendly).
- **Scheduling:** Leitner boxes (1→5), with immediate write-back of your progress.
- **In-app tools:** edit a card, flag it for later, or exclude a bad card — all
  saved straight to the Sheet.

> This repo is a **template** — deploy your own copy against your own Google
> account and Sheet (see below). It ships with a small Dutch A1/A2 starter deck,
> but the app is language-agnostic; use it for anything.

## Screenshots

<p align="center">
  <img src="docs/screenshots/home.png" alt="Home screen — due/new counts and Leitner boxes" width="300">
  &nbsp;&nbsp;
  <img src="docs/screenshots/card.png" alt="Practice card with flag / edit / exclude tools" width="300">
</p>

## Why this instead of a flashcard app?

- **Lightweight — it's just a web page.** Nothing to install or update; it runs
  in the browser you already have, on any device (phone, tablet, laptop). No
  app-store download, no account for yet another service, no sync engine to trust.
- **No ads, no upsells — ever.** Because you self-host it (your own Apps Script
  web app + your own Google Sheet), there's no company in the middle with a
  reason to show you ads, gate features behind a subscription, or mine your
  study data. It's yours end to end.
- **Your browser's superpowers come for free.** Since it's a normal web page,
  you can **select any word to look it up, translate, or search**, use
  right-click / long-press actions, share a card, or use any browser extension
  or accessibility feature you rely on — none of which a locked-down native app
  lets you do.
- **Flexible, dead-simple editing.** Your cards live in a **Google Sheet**, so
  you can bulk-**import** a deck, tweak wording, fix a typo, add rows, or
  reorganize columns whenever you want — from the Sheet on any device, or from
  inside the app while you study. No proprietary format, no export/re-import
  dance; the spreadsheet *is* the database.

## Deploy your own

> **Using a coding agent?** See [`AGENTS.md`](./AGENTS.md) — it walks the same
> deploy split into agent-runnable commands and the three browser steps Google
> requires you (the human) to do: `clasp login`, enabling the Apps Script API,
> and the first-run authorization. The manual steps below are the human version.

You'll need [Node.js](https://nodejs.org) and a Google account.

1. **Install clasp** (Google's Apps Script CLI) and log in:
   ```bash
   npm install -g @google/clasp
   clasp login
   ```
   Also enable the Apps Script API for your account at
   <https://script.google.com/home/usersettings>.

2. **Create a Sheet-bound script project** (do this in a clone of this repo):
   ```bash
   clasp create --type sheets --title "Flashcards" --rootDir .
   ```
   This creates a new Google Sheet + bound script and writes a local
   `.clasp.json`. Note: `clasp create` overwrites `appsscript.json` with a
   default — restore this repo's version afterward (it sets the web-app access
   and timezone).

3. **Push the code and deploy as a web app:**
   ```bash
   clasp push --force
   clasp deploy --description "v1"
   ```
   The `deploy` command prints a deployment ID; your web-app URL is
   `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`.

4. **Load the starter deck:** open your new Sheet and click **🎴 Flashcards →
   Load starter deck** (the menu is added automatically when the Sheet opens).
   Authorize when prompted — it's your own script, so the "unverified" warning
   is expected.

5. **Use it:** open the web-app URL, and on iOS tap **Share → Add to Home
   Screen** for an app-like icon.

To redeploy after changes, reuse the same deployment ID so the URL (and your
Home Screen icon) stays stable:
```bash
clasp push --force
clasp redeploy <DEPLOYMENT_ID> --description "..."
```

### Access model
Set the web app's access in `appsscript.json` (`webapp.access`):
`MYSELF` (only you — every browser must be signed into the owning account),
`ANYONE` (anyone with a Google account), or `ANYONE_ANONYMOUS` (anyone with the
link). The app always runs as the deploying user and only ever touches that
user's own Sheet.

## How to use it

- Home shows **Due** / **New** counts and the Leitner box breakdown. Tap **Start**.
- Each card shows the **front** first. Tap it (or **Show answer**) to reveal the
  **back** + any **notes**.
- Grade yourself:
  - Normal card: **Wrong** (back to box 1) or **Correct** (up one box).
  - Brand-new card: **Didn't know** (box 1) or **Already knew** (skip to box 4).
- Progress saves to the Sheet immediately after each grade.

### Editing, flagging & excluding while you practice
Each card has three tools in the progress row (top right):

- **✎ Edit** — edit the card's front / back / notes (Markdown) and **Save to
  Sheet** — written back immediately. Works on phone and laptop.
- **⚑ Flag** — one tap marks the card (writes `⚑` to its `flag` column) so you
  can fix it later without stopping to type. Tap again to un-flag. Filter the
  `flag` column in the Sheet to find flagged cards.
- **🚫 Exclude** — drops a bad/low-quality card from all future practice
  (soft-delete: writes `x` to its `exclude` column) and skips to the next card.
  Reversible — clear the `exclude` cell to bring it back, or filter that column
  to bulk-delete those rows when cleaning up.

## The Sheet schema (`cards` tab)

| column | meaning |
|--------|---------|
| `id` | any unique value |
| `type` | optional tag/category (e.g. `vocab`, `grammar`) — shown on the card badge |
| `front_side` | front of the card — **Markdown** |
| `back_side` | back of the card (the answer) — **Markdown** |
| `notes` | optional hint shown under the answer — **Markdown** |
| `box` | Leitner box 1–5. **Leave blank = new card** |
| `due` | next review date `YYYY-MM-DD` (managed by the app) |
| `last_seen`, `right`, `wrong` | stats (managed by the app) |
| `added` | date reference (your own) |
| `flag` | holds `⚑` when flagged in the app for later editing |
| `exclude` | holds `x` when excluded from practice (soft-delete) |

The app self-heals the schema: on first load it adds any missing columns
(`flag`, `exclude`) without touching your data.

### Adding your own cards
Add a row to the `cards` tab (laptop or phone). Fill `front_side`, `back_side`,
optionally `type` and `notes`. **Leave `box`/`due` empty** so it appears as a
new card. You can hand-tune proficiency any time by editing `box` and `due`.

### Markdown
`front_side`, `back_side`, and `notes` render Markdown: `**bold**`, `_italic_`,
`` `code` ``, `# headings`, `- bullet lists`, `1.` numbered lists, `[links](https://…)`,
and `![images](https://…)`. Put line breaks in a cell with **Alt+Enter**
(Option+Enter on Mac) inside the Google Sheet.

## Scheduling (Leitner)

- Boxes **1→5**, review intervals **1, 2, 4, 8, 16 days**.
- **Correct** → up one box. **Wrong** → back to box 1.
- Up to **10 new cards** per session.
- Tune in `Code.js`: `BOX_INTERVALS`, `NEW_PER_SESSION`, `KNOWN_START_BOX`.

## Project files

| file | purpose |
|------|---------|
| `Code.js` | backend: `doGet`, Leitner logic, sheet I/O, the `getSession`/`gradeCard`/`updateCard` API |
| `Index.html` | the entire UI — inline CSS/JS + a small Markdown renderer |
| `Seed.js` | starter deck + `seedCards` / `resetAndReseed` |
| `appsscript.json` | Apps Script manifest (timezone + web-app access) |
| `.claspignore` | limits what clasp pushes to the script |

## License

[MIT](./LICENSE).
