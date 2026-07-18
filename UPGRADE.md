# Updating your copy of Flashcards

Your copy is fully yours — updates never happen automatically. When the home
screen shows **⬆️ Update available**, this page is how you get the new version.

**Your cards and progress are safe either way.** Updating only replaces code;
the `cards` and `config` tabs are never touched, and the app self-heals any new
columns or settings a release introduces.

## If you copied the example Sheet (Option A)

Takes about two minutes:

1. Open your Sheet → **Extensions → Apps Script**.
2. Replace the contents of each file in the editor with the latest from GitHub
   (open the raw link, select all, copy, paste over the old contents):
   - `Code.gs` ← [`Code.js`](https://raw.githubusercontent.com/Yc-Chen/flashcards/main/Code.js)
   - `Index.html` ← [`Index.html`](https://raw.githubusercontent.com/Yc-Chen/flashcards/main/Index.html)
   - `Seed.gs` ← [`Seed.js`](https://raw.githubusercontent.com/Yc-Chen/flashcards/main/Seed.js)

   (The editor shows `.gs` where the repo says `.js` — same files.)
3. Save (💾 or Ctrl/Cmd-S).
4. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.**
   This is the step people forget: without it the app keeps serving the old
   code. Your URL — and any Home Screen icon — stays the same.
5. Reload the app. The update hint disappears once you're current.

## If you deployed from the repo with clasp (Option B)

```bash
git pull
clasp push --force
clasp redeploy <DEPLOYMENT_ID> --description "update"
```

(`clasp deployments` lists your deployment ID if you've lost it.)

## What's new?

See the [commit history](https://github.com/Yc-Chen/flashcards/commits/main).
