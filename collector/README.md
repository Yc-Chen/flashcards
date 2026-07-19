# Update-check collector (maintainer-only)

The endpoint behind the app's daily version check (`checkForUpdate_()` in
`Index.html`). It answers `{ latest, url }` and logs each ping to a private
Sheet, which is how you count installs and active users. It is **not** part of
the app: neither `.claspignore` nor `.claspignore.public` pushes this directory.

## One-time deploy

1. Create a **new, private Google Sheet** (e.g. "Flashcards telemetry"). Don't
   reuse the app's Sheet — this one collects pings from *everyone's* copies.
2. **Extensions → Apps Script**, replace the editor's `Code.gs` with
   `collector/Code.js`, save.
3. **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (the fully anonymous option — the app's
     `fetch` sends no credentials, so anything stricter breaks it)
4. Authorize, copy the `/exec` URL.
5. Paste it into `UPDATE_CHECK_URL` in `Index.html`, commit, then push to both
   script projects (`clasp push --force` and `./push-public.sh`) so the example
   Sheet's code carries it to future copiers.
6. Open the `/exec` URL once in a browser — you should get JSON like
   `{"latest":"1.0.0","url":"…"}`, and the `pings` and `settings` tabs appear
   in the Sheet.

## Releasing a new version

1. Bump `APP_VERSION` at the top of `Code.js`, push to both script projects.
   (It's the only place the version is written; the app and the Sheet's
   **About Flashcards** menu both read it from there.)
2. Set `latest_version` in the collector Sheet's `settings` tab to the same
   number (no redeploy needed — it's read per request).
3. Every copy still on an older version shows "⬆️ Update available" linking to
   `release_url` (defaults to `UPGRADE.md`).

Keep the two numbers in sync: if `latest_version` runs ahead of what's actually
in the repo, users get an update hint that leads nowhere.

## Reading the numbers

Each ping is one row in `pings`: timestamp, UTC date, app version, install id
(a one-way hash of the copy's spreadsheet id — one id per copy, stable across
browsers and devices). Useful formulas (put them on a separate tab; the QUERY
ones dedupe on (date, id) first because one copy can ping more than once a
day — see the caveats):

```
Total installs:          =COUNTUNIQUE(pings!D2:D)
Active installs by date: =QUERY(UNIQUE({pings!B2:B, pings!D2:D}), "select Col1, count(Col2) group by Col1 order by Col1 desc", 0)
New installs by date:    =QUERY(QUERY(pings!B2:D, "select D, min(B) group by D", 0), "select Col2, count(Col1) group by Col2 order by Col2 desc", 1)
Version distribution:    =QUERY(UNIQUE({pings!C2:C, pings!D2:D}), "select Col1, count(Col2) group by Col1", 0)
```

"New installs by date" (each id counted on the day it was first seen) is the
series to watch after announcing the project somewhere.

Caveats worth remembering when you quote these numbers:

- **One copy can ping several times a day.** The once-a-day throttle lives in
  `localStorage`, which Safari sometimes denies inside the Apps Script iframe,
  and each browser throttles independently — the same id then appears in
  multiple rows per day. Count distinct ids (as the formulas above do), never
  raw rows.
- **Installs means copies, not people.** A household sharing one Sheet is one
  install; someone who copies the Sheet twice is two.
- Users can turn the ping off (`update_check: no` in their config tab), and
  forks can blank `UPDATE_CHECK_URL`. You count willing participants, not
  everyone.
- At very large volumes an appendRow-per-ping Sheet gets slow; archive `pings`
  to a new tab if it grows past a few hundred thousand rows.
