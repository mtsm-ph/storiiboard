# Desktop gaps: what no automated test runs (audit, Nov 13, 2026)

Asked by Kevin after #144 found that the Project data export had failed to save in the desktop app since Phase 2.
The reviewer read the code (every Tauri command, the capabilities, the CSP, dialogs, the opener, the sidecar, CI);
the main session ranked it and checked the top findings against the code. Nothing here was run in the real app.

## Why these bugs get through

- **The end-to-end tests run the browser build.** Playwright opens Vite's dev server with `?files=memory`: sql.js
  instead of Rust, `window.prompt` instead of dialogs, no Tauri commands at all.
- **The app's content security policy (CSP) only applies to a built app.** Neither the tests nor `npm run tauri dev`
  run under it, so anything it blocks is found only in an installer.
- **The installers' job never opens the app.** checkpoint.yml builds it, runs the Rust tests and checks the .sbd
  file association in the bundle, then uploads.
- **Only one test compares the two sides**: exportExtensions.test.ts (written for #144) reads Rust's list of export
  extensions. Every other Vitest test of a desktop path mocks `invoke`, which proves nothing about names or shapes
  matching Rust.

What is sound on paper: all 70 commands registered in src-tauri/src/lib.rs are called from TypeScript and no call
names a command that isn't registered; every call's argument names match Rust's parameters; the dialog and window
permissions the page uses are granted; the page makes no network request of its own.

## Broken (the code proves it)

| # | What | Evidence | Fix |
|---|---|---|---|
| A1 | **Attaching or updating a company that has a logo fails in the installed app**, so a project gets no company and the call sheet's header (4.12) has no name or logo. High. | `logoFile` (src/app/company/companies.ts) turns the logo's `data:` URL into a file with `fetch()`. The CSP's `connect-src 'self' ipc: http://ipc.localhost` (src-tauri/tauri.conf.json) doesn't allow `data:`, so the webview refuses the request. | Decode the data URL without `fetch`. Small and certain: built as its own milestone (5.12). To confirm by hand on an installer made before it: Settings, a company with a logo, attach it to a project. |
| A2 | A double-click on an .sbd shows the window before the page has loaded: a flash of the wrong background. Low, cosmetic. | `opened::queue` (src-tauri/src/opened.rs) shows the window from `setup`, before theme-boot.js runs. | Waits for Kevin (needs a look in the real app). |

## Suspect (needs one run of the real app)

| # | What | Why | How to confirm |
|---|---|---|---|
| B1 | **Dragging a deck page to reorder it probably does nothing on Windows.** Medium. Move up and Move down still work. | PagesPanel.tsx is the app's only HTML5 drag and drop; Tauri's file drop (`dragDropEnabled`, on, needed for pictures dropped from Explorer) switches HTML5 drag and drop off inside the page on Windows. | Windows installer: drag a page row in a deck's Pages panel. If it fails, the fix is pointer-event reordering (a builder's milestone), never turning file drop off. |
| B2 | **Copy link / Copy map link / copy a palette colour in the Mac app.** Low to medium. | `navigator.clipboard.writeText` needs a secure context; whether WKWebView treats `tauri://localhost` as one is unproven. Windows' `http://tauri.localhost` is. | Mac app: Assets, Copy link, paste somewhere. |
| B3 | **The test drivers are kinder than Rust.** Medium. Rust refuses a query that returns bytes and a blob read of a non-blob column; the two drivers the tests use (memoryDriver.ts, nodeDriver.ts) return a value. No call hits this today, but one that did would pass every test and fail only on the desktop. | src-tauri/src/sbd.rs against the two drivers. | No run needed: make both drivers refuse as Rust does (small; proposed as part of the contract test below). |
| B4 | **ffmpeg and ffprobe beside the installed app.** Medium. | A release build looks for the sidecars only next to the executable; tests are debug builds, which look elsewhere, and CI never lists the bundle. | Kevin's Phase 2 gate passed on installers, so it works today; a CI step listing the bundle would keep it so. |
| B5 | Show backups opens the folder with `explorer`/`open` directly from sbd.rs, not through open.rs as CLAUDE.md's opener rule says. Low: it is only ever given the backups folder. | src-tauri/src/sbd.rs, `sbd_show_backups`. | Move it behind open.rs's reveal (small; with the next change to the opener). |
| B6 | A folder export that never calls `commit()` (PNG frames) leaves a token in memory for the session. Low. | src-tauri/src/export.rs. | With the next change to export. |

## Unproven (works on paper; nothing crosses from the page to Rust in a test)

Every desktop feature, in effect. The Rust half of each has unit tests of its inner function; the TypeScript half
is tested with `invoke` mocked or through the browser stand-in.

| Feature | The untested join |
|---|---|
| Project file: create, open, every edit, blobs, copies, versions, compact | tauriDriver.ts to `sbd_*`; tests use the Node and memory drivers |
| Backups, lock files, synced-folder detection, recent list | `sbd_backup…`, `sbd_lock_*`, `sync_service`, `app_data_*` |
| New / Open / Open backup dialogs | the dialog plugin; the tests use `window.prompt` |
| .sbd double-click, single instance | the `opened-files` event and `opened_files_take` |
| Pictures: choose, read, drop from the OS | `pictures_*` and the drag-drop events (names shared only as text) |
| Script, LUT, project JSON, PDF pickers | `*_choose` |
| Deck PDF at full quality | `picture_original`; a failure falls back silently to the stored copy |
| Show in Finder / Explorer; open link; open PDF | `reveal_original`, `open_link`, `open_pdf` |
| Video: probe, still, proxies, the `sbdcopy:` playback address, Save clip | `video_*`, `playback_*`, `clip_save`; the CSP's `media-src` |
| Every export | `export_choose_*`, `export_write` (extensions are checked; the rest isn't) |
| Address search, hospital, weather, service switch, map tiles | the commands' answers as the page reads them |
| Week start, time zone, this computer's fonts, licences, window colour | `region_week`, `time_zone_at`, `fonts_list`, `font_bytes`, `licence_text` |
| The CSP against everything the page loads | nothing runs under it |

## The cheapest cover, in order

1. **Run the end-to-end tests under the app's real CSP.** No new dependency. For the test server only, Vite sends
   tauri.conf.json's CSP as a header, plus the two things the test build alone needs (`'wasm-unsafe-eval'` for
   sql.js, and React's refresh preamble handled). The existing company-logo test would have failed on A1. About one
   builder milestone. *Recommended first.*
2. **A contract test in Vitest.** No new dependency. It reads lib.rs's command list and each command's parameters,
   finds every call in src, and fails on a name or argument that doesn't match, either way; with B3's fix, so the
   test drivers refuse what Rust refuses. Catches #144's kind of bug at the names-and-arguments level; not return
   shapes. About one milestone. *Recommended second.*
3. **A CI step that lists the built bundle** (ffmpeg, ffprobe, the licences, the fonts) on both installers. A few
   lines in checkpoint.yml. Covers B4.
4. **Rust tests through Tauri's mock runtime** (`tauri::test`): real command names, argument JSON, permissions and
   answers for every command without a dialog. Needs tauri's `test` feature switched on: a dependency change,
   Kevin's to approve. About two milestones.
5. **The real app driven end to end on Windows** (tauri-driver over WebDriver). The only thing that proves the whole
   path, and the dearest:
   - new dependencies: tauri-driver (cargo) and a WebDriver client; msedgedriver matched to the runner's WebView2;
   - Windows and Linux only: tauri-driver has no Mac support, so WKWebView stays a by-hand pass;
   - native dialogs can't be driven: every file pick (the dialog plugin and Rust's pickers) needs a test-only way to
     be given a path, compiled out of release builds;
   - it must run a built app (`tauri build --debug`), since the CSP doesn't apply in `tauri dev`; the ffmpeg
     sidecars must be built first (cached; up to an hour cold);
   - weather, tiles, address and hospital need net.rs pointed at fixtures, so no test contacts a real service;
   - a first smoke set (create, edit, close, reopen, export a PDF, attach a picture, play a proxy) is about three
     milestones, and adds 15 to 25 minutes to a checkpoint run. Worth it before the first public release (Phase 8),
     not before.

## Waiting for Kevin

- Go-ahead for 1 and 2 (no dependency), and 3 (a CI change).
- 4 and 5: each needs a dependency.
- B1 and B2: one look each in the installers; A2 and B5, B6: fix now or with their next change.
