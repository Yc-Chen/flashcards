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

Each ping is one row in `pings`: timestamp, UTC date, app version, random
install id. Useful formulas (put them on a separate tab):

```
Total installs (upper bound):  =COUNTUNIQUE(pings!D2:D)
Pings today:                   =COUNTIF(pings!B2:B, TEXT(TODAY(),"yyyy-mm-dd"))
Daily actives by date:         =QUERY(pings!A2:D, "select B, count(D) group by B order by B desc", 0)
Version distribution:          =QUERY(pings!A2:D, "select C, count(C) group by C", 0)
```

Caveats worth remembering when you quote these numbers:

- **Installs is an upper bound.** The install id lives in `localStorage`, which
  Safari sometimes denies inside the Apps Script iframe — those users get a
  fresh id per visit. Daily ping counts (one per id per day) are the more
  trustworthy series.
- Users can turn the ping off (`update_check: no` in their config tab), and
  forks can blank `UPDATE_CHECK_URL`. You count willing participants, not
  everyone.
- At very large volumes an appendRow-per-ping Sheet gets slow; archive `pings`
  to a new tab if it grows past a few hundred thousand rows.
