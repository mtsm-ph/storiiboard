# The launch check (6.27l): brief

Kevin, Nov 20. Stacked on 6.27i (the workers' policy, PR #206), which changed how the main window is made. Nothing
automated ever starts the built app, so a window that never opens would pass every check we have. This adds one that
starts it.

## Goal

A self-check mode of the real app, switched on only by an environment variable, run in both installer jobs of
`.github/workflows/checkpoint.yml` on the app just built. It passes only if:

1. the main window is made;
2. the page loads;
3. no policy violation is reported;
4. each worker's script arrives with the worker policy (the page fetches its own worker scripts and reads the header);
5. a small built-in PDF's text comes back through the PDF worker;
6. the accent reader runs.

Then the app quits by itself with exit code 0. A time limit. On failure it says which step. The mode does nothing
else and reaches no network.

## What this check can and can't prove

**It can prove, on the two runners, at every checkpoint that builds the installers** (not the baselines-only or
end-to-end-only ones, which skip that job):

- The build the installers carry starts. On Windows it is `src-tauri/target/release/storiiboard.exe`, the program
  the MSI and the NSIS installer pack (the bundler stamps each copy with its package type; the build is the same).
  On the Mac it is the program inside the built `Storiiboard.app`, the bundle the DMG carries.
- `main_window()` makes the window from its config, the real webview (WebView2, WKWebView) reports that the page
  finished loading, and the window is shown by that, the app's normal way.
- The real page loads from the app's own asset protocol under the installed policy: index.html, theme-boot.js, the
  stylesheet and the whole app bundle load and run (every module's top level), React draws the check's own screen,
  and the page reaches Rust through the real IPC.
- The page's policy is enforced for scripts and its violations are seen: the check breaks the policy once on purpose
  (an inline script, which must not run and must be reported), then counts on silence from the document's first
  moment to the end.
- For each worker script the app really starts, the page's own request for the same address gets exactly the text of
  `src-tauri/worker-csp.txt` in its header, from the same handler that answered the worker.
- Both workers start and work under that policy in the real webview: the PDF's text can only come from the PDF
  worker, and the accents are asked of the worker alone, never the page's fallback.
- The app quits by itself, and exit code 0 with the line `launch check: passed` can only mean every step passed.

**It can't prove:**

- That the webview enforces the worker policy inside a worker. The header's arrival and the workers working under it
  are proven; that a worker's `eval` or a request from it is refused is proven only in Playwright's engines
  (e2e/workerCsp.spec.ts). A violation inside a worker is reported inside the worker, never to the page.
- The installed app. The check runs what was built, not what an installer lays down: the install itself (files in
  place, the WebView2 bootstrapper, shortcuts, the .sbd association being registered) is not exercised. Running the
  NSIS installer silently first would add that.
- A computer without the WebView2 runtime, Windows 10 or 11 (the runner is Windows Server 2025), an Intel Mac, or a
  macOS other than the runner's.
- The app's own first screen. Every module of the bundle runs, but `<App />` is never drawn in the mode: its first
  render, and any violation its screens would cause, are covered only in Playwright's engines.
- Anything after that: opening a project, the Player, the encoders, ffmpeg, dialogs, drag and drop.
- A violation the webview enforces without reporting it. The deliberate one proves that reports arrive for scripts;
  for other kinds that is taken on trust.
- A start without the variable, exactly. The mode skips the start-up work that is not the window (this computer's
  id, the playback copies' clean-up, files passed to the app, the hand-off to a copy already running), so a fault
  there would not show. The Rust command tests cover that work.
- Gatekeeper, notarization or SmartScreen: the program is run where it was built, never downloaded.
- What the webview's own runtime does on the network. The app itself makes no request in the mode.

## Decisions

- **The switch:** the environment variable `STORIIBOARD_LAUNCH_CHECK`, on only when its value is exactly `1`. Read
  once, in `run()`. Nothing a project file or a page controls can switch it on: Rust alone decides, and the page's
  part is refused by Rust unless Rust is in the mode.
- **What still runs in the mode** is what loading the page runs: theme-boot.js and the bundle's top-level code, which
  read this computer's settings from the webview's storage and ask Rust once for the region (`region_week`, which
  needs no state). Nothing is written. That is the whole of "does nothing else".
- **The steps, with these names.** The order below is the order of the table and of the codes, not of arrival:
  reports may come in any order (`loaded` usually arrives after `page`), and the page runs its own six one after
  another.

  | # | Name | Who reports it | It is ok when |
  |---|---|---|---|
  | 1 | `window` | Rust | `main_window(...)?.build()` returned the window |
  | 2 | `loaded` | Rust | the webview's page-load-finished event came for the main window, the app's own `show()` worked and the window is visible |
  | 3 | `page` | the page | the app's bundle ran and React drew the check's screen into `#root` |
  | 4 | `policy-watch` | the page | an inline script added on purpose did not run and was reported as a violation |
  | 5 | `pdf-text` | the page | `readPdfText` returned the built-in PDF's line |
  | 6 | `accents` | the page | the accent reader's worker, asked alone, returned at least one accent for the built-in picture |
  | 7 | `worker-policy` | the page | exactly two worker scripts were started in steps 5 and 6, and each, fetched by the page, is JavaScript and carries exactly the worker policy |
  | 8 | `no-violation` | the page | nothing but step 4's own violation was reported from the document's start to now |

- **Exit codes:** 0 passed. 3: the app was asked to quit before the check ended (its window was closed).
  `10 + n`: step n failed. `30 + n`: the time limit ended while waiting for step n. 39: every step passed but the app
  had not quit when the time limit ended.
- **The time limit:** 90 s from the start of `run()`, kept by a thread in Rust, never by the page.
- **What it says:** one line per step on stdout as it happens, then the verdict:
  - `launch check: window ok`
  - `launch check: FAILED at pdf-text: <why>`
  - `launch check: FAILED: time limit (90 s) while waiting for accents`
  - `launch check: passed`
  Each line is flushed. A write that fails is ignored, never a panic. The page's `<why>` is cut to one line of at
  most 300 characters, control characters replaced.
- **Rust's strings here are not words for people.** They start in lower case and end with no full stop, so the scan in
  `src/core/i18n/i18n.test.ts` ("cover every message the Rust commands send") does not take them for messages. Never
  add to that test's `internal` list.
- **No words on screen.** The check's screen is an empty surface, so there is nothing to translate.
- **No end-to-end spec for this.** The end-to-end server has no stand-in for Rust, its policy carries an extra
  `report-uri`, and its violation watch fails a test on any violation, the deliberate one included. The page's logic
  is tested in Vitest with fakes; the real thing runs in a debug build here and in both real webviews at every
  checkpoint.

## Rust

New file `src-tauri/src/launch_check.rs`; changes in `src-tauri/src/lib.rs` and `src-tauri/src/net.rs`.

- **State and rules** in `launch_check.rs`, written so tests need neither the environment nor a real exit:
  - whether a value switches the mode on (only `1`);
  - the step list, each step's failure code and time-limit code;
  - recording a report: an unknown name is refused; `window` and `loaded` are refused from the page; a second report
    of a step is ignored; a failed step is the verdict at once; all eight ok is a pass;
  - which step the time limit was waiting for: the first not yet ok, in order;
  - the cleaning of `<why>`.
- **The command** `launch_check_step(step: String, ok: bool, detail: String) -> Result<(), String>`, in the
  `generate_handler!` list. With the mode off it is refused and changes nothing. It must work in the command tests'
  harness (`src-tauri/src/command_tests.rs`) with no existing test changed.
- **A failed step:** print the line, then end the process at once with the step's code. Nothing was started in the
  mode, so nothing needs a graceful quit. On a Mac use `libc::_exit` (libc is already a dependency there): it runs no
  exit handlers, which could otherwise race the webview's threads and turn the code into a crash's. Elsewhere
  `std::process::exit`. The time limit and the early quit end the same way. The line is printed and flushed first, so
  it stands whatever the code.
- **A pass:** print `launch check: passed`, then `app.exit(0)`, the app's own way out. The time limit stays armed
  until the process is gone (code 39).
- **A quit nobody asked the check for** (`RunEvent::ExitRequested` while there is no verdict): print
  `launch check: FAILED: the app was asked to quit before the check ended` and exit with 3. Without this, closing the
  window would end the app with code 0.
- **In `run()`, when the mode is on:**
  - The single-instance plugin is not registered. A second launch hands over to the running copy and exits with
    code 0, which would read as a pass. With the mode off it stays registered first, as now.
  - Setup makes the window exactly as now (`main_window(app.handle())?`, then `.build()?`, the 3-second net kept),
    with one addition before `.build()`: the initialization script below. Then it reports `window` and returns.
    No `manage_at_start`, no clean-up thread, no `open::tidy_at_start`, no `opened::queue`.
  - If making the window fails: `launch check: FAILED at window: <error>` and exit 11, not the `expect` panic.
  - `on_page_load`, on `Finished`: the existing `show()` first, unchanged; then report `loaded` (ok only if `show()`
    worked and `is_visible()` is true). Once.
  - `RunEvent::Exit`: the three clean-ups are skipped. The playback cache was never made in the mode, and
    `app.state` panics on state that isn't there. On a Mac, `RunEvent::Opened` is ignored in the mode. (The copy
    scheme's handler would panic the same way on its own thread, but nothing asks for a copy in the mode.)
  - With the mode off, `run()` behaves exactly as today.
- **The initialization script** (`WebviewWindowBuilder::initialization_script`, the mode only). It runs before any
  script of the page:
  - it adds a `securitypolicyviolation` listener on `document` that keeps each event's `effectiveDirective`,
    `blockedURI` and `disposition` in a list;
  - it defines `window.__STORIIBOARD_LAUNCH_CHECK__` as an object holding that list, not writable, not configurable.
  Keep it as a string in `launch_check.rs`.
- **`net.rs`:** in the mode every request is refused at the one gate both entry points pass (`allowed_with`). Keep the
  gate's own rule a function the mode is passed into, so its test needs no environment.

## The page

New folder `src/app/launchCheck/`; small changes in `src/main.tsx` and `src/ui/theme/generator/extract.ts`.

- **`src/main.tsx`:** find `#root` first. If `window.__STORIIBOARD_LAUNCH_CHECK__` is there, start the check and do
  nothing else: no `setLocale(loadSettings()...)`, no `installTabWrap`, no `installClickFocus`, no `<App />`. Otherwise
  the lines that are there today, in today's order. The imports stay static, so the whole bundle still loads and runs
  in the mode: that is part of "the page loads".
- **The runner** (`launchCheck.ts`): the steps as one function with what it needs passed in (the reporter, the PDF
  reader, the accent reader, `fetch`, the document, a clock), so Vitest drives it with fakes. Steps run one after
  another. Each is reported with `invoke('launch_check_step', { step, ok, detail })`: a literal command name and an
  object literal, as `src/app/tauriContract.test.ts` asks. The first failure is reported and the runner stops. A
  thrown error is that step's failure, its message the detail.
- **`page`:** the screen (`LaunchCheckScreen.tsx`, an empty surface in the app's background, no words) is drawn with
  `createRoot`; the step is reported from an effect, so a commit really happened.
- **`policy-watch`:** append a `<script>` element whose text sets a flag on `window`. Wait up to 2 s for a new entry
  in the list whose directive starts with `script-src`, whose disposition is `enforce`, and whose blocked address is
  `inline` or empty (WKWebView's shape for this has never been seen here, so the match doesn't hang on that one
  word). Then remove the element.
  - The flag was set: failed, "an inline script ran: the page's policy is not enforced".
  - No such entry in 2 s: failed, "a refused inline script was not reported", followed by every entry that was seen
    (directive, blocked address, disposition) or "nothing was reported", so one run on the Mac tells which it was.
  - Otherwise ok, and that one entry is the deliberate one.
- **`pdf-text`:** `readPdfText(bytes, 'launch-check.pdf')` from `src/features/script/readPdf.ts`, as it is. Ok when
  the text items, joined, contain the built-in line. That reader gives pdf.js a worker of its own making, so there is
  no path back to the page: an answer can only have come from the worker.
  - The reader waits up to 60 s by itself, longer than the check can. The check gives it 25 s, then fails the step
    with "no answer from the PDF worker in 25 s".
- **`accents`:** the accent reader falls back to the page silently when its worker fails, so the check must not use
  `extractAccents`. In `extract.ts`, export the function that asks the worker alone (today's private `askWorker`;
  give it a name that says so). `extractAccents` and its fallback must behave exactly as before. Ok when the worker's
  answer is a list with at least one accent. `null` fails with "the accent worker failed or took over 15 s" (the
  function gives one `null` for all of those); a rejection fails with its message; no answer in 20 s fails with that.
- **`worker-policy`:** while steps 5 and 6 run, `window.Worker` is wrapped by a class that records the address each
  worker is started from, then put back. No list of worker files is kept anywhere, so the check learns the addresses
  from what the app's own code starts. After step 6: exactly two different addresses, else failed. For each:
  `fetch` it, expect status 200, a JavaScript `content-type`, and a `content-security-policy` header equal to the
  policy. On failure the detail names the file (its name only) and what was found.
  - The policy is a constant in the runner. A Vitest test reads `src-tauri/worker-csp.txt` the way `worker_csp.rs`
    does and fails when the two differ.
- **`no-violation`:** wait 300 ms for late events, then the list must hold the deliberate entry and nothing else. On
  failure the detail gives the first other entry's directive and blocked address.
- **The built-in PDF and picture:** constants in `src/app/launchCheck/builtIn.ts`, written by a committed script,
  `scripts/launchCheckBuiltIn.ts`, as `scripts/planIconBoxes.ts` writes its table:
  - the PDF: one page, one line, `INT. LAUNCH CHECK - DAY`, made with pdf-lib (already a dependency), fixed dates and
    producer so the bytes don't change from run to run, no object streams;
  - the picture: a 16 × 16 PNG of one saturated colour, made with Node's own zlib (no new dependency);
  - both as base64. A test runs the script's functions and compares with the committed constants, and checks that
    `accentCandidates` (generate.ts) finds an accent in the picture's pixels. If pdf-lib's bytes turn out not to be
    stable, say so in the report and test the PDF another way; don't loosen the picture's test.
- The mode's page code reads and writes no storage, opens no project and calls no other command.

## The script and CI

**This brief touches CI: only `.github/workflows/checkpoint.yml`, only the `installers` job.**

- **`scripts/launchCheck.sh <path to the app's executable>`** (LF line endings; it runs under Git Bash on the Windows
  runner and under the Mac's own bash, which is 3.2: nothing newer than that in it):
  - fails with words if the path is not a file, and lists the folder;
  - on Windows, prints the WebView2 runtime's version from the registry
    (`HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`, value `pv`,
    then `HKCU\Software\Microsoft\EdgeUpdate\Clients\{…}`, with no WOW6432Node), and fails with words if there is
    none. `reg query … /v pv` needs `MSYS_NO_PATHCONV=1`, or Git Bash turns `/v` into a path;
  - starts the app with `STORIIBOARD_LAUNCH_CHECK=1`, its output and errors to a file under
    `${RUNNER_TEMP:-test-results/launch-check}` (never the system's temp folder on a developer's computer);
  - waits by polling (`kill -0`, every half second) for at most 150 s, then kills it; no background watcher is left
    behind;
  - prints the app's lines, then `launch check: exit code N: <meaning>` from the same table as Rust. The script
    holds the step names in one line, `steps="window loaded page policy-watch pdf-text accents worker-policy
    no-violation"`, and works the codes out from the position; a Rust test fails when that line and Rust's list
    differ. It names 101 (the app panicked) and a kill by the script too;
  - exits 0 only when the app's exit code is 0 **and** its output holds the line `launch check: passed`; on any
    failure it also lists the processes still running whose name holds `storiiboard`.
  - Checked on this PC: a Rust program built with `windows_subsystem = "windows"`, as the release app is, does hand
    its stdout, stderr and exit code to Git Bash, to a pipe and to a file, and bash waits for it.
- **`checkpoint.yml`, the `installers` job:**
  - a new matrix key `app`: `src-tauri/target/release/bundle/macos/Storiiboard.app/Contents/MacOS/storiiboard` for
    macOS, `src-tauri/target/release/storiiboard.exe` for Windows (both names are in the last green run's log);
  - one new step, the last of the job (after the upload and the bundle listing, so a fault in the check never costs
    the installers): `shell: bash`, `timeout-minutes: 5`, `run: bash scripts/launchCheck.sh "${{ matrix.app }}"`,
    with a comment that says what it is and names this brief.
  - Nothing else in the workflow changes. `ci.yml` is not touched.

## Tests to add

- **Rust** (`launch_check.rs`, `command_tests.rs`, `net.rs`):
  - only the value `1` switches the mode on (empty, `0`, `true`, ` 1` don't);
  - the step list's names, order and codes, and that `scripts/launchCheck.sh` carries the same list;
  - all eight ok is a pass; a failed step is its code; an unknown step, `window` and `loaded` are refused from the
    page; a second report is ignored;
  - the time limit names the first step not yet ok, and 39 when all are;
  - the cleaning of the detail (length, one line, control characters);
  - through the command harness, mode off: `launch_check_step` is refused and nothing is recorded;
  - mode on, the state passed in: the page's six steps are recorded and the verdict reaches the finisher the test
    passed in (no real exit);
  - `net.rs`: in the mode, an address that is allowed otherwise is refused.
  - No test sets the environment variable: tests share one process.
- **Vitest** (`src/app/launchCheck/launchCheck.test.ts` and the generator's test):
  - the happy path reports the six page steps in order, each once;
  - each step's failures report that step with its reason and stop: the canary ran; the canary was not reported; the
    PDF reader threw; the PDF's text lacks the line; the worker gave `null`, an empty list, an error; one worker, three
    workers; a script with no policy, another policy, a non-JavaScript type, a 404; a second violation;
  - `window.Worker` is put back after steps 5 and 6, on failure too;
  - the policy constant against `src-tauri/worker-csp.txt`;
  - the built-in constants against the script.
  - `src/app/tauriContract.test.ts` and `src/core/i18n/i18n.test.ts` pass as they are, with no new entry in any of
    their lists.

## Checks to run

1. `npm run lint`.
2. Vitest, the whole suite.
3. `cargo test --manifest-path src-tauri/Cargo.toml`, the whole suite.
4. Chromium only, these specs only (never the whole end-to-end suite on this PC):
   `npx playwright test e2e/smoke.spec.ts e2e/themes.spec.ts e2e/workerCsp.spec.ts --project=chromium`.
   Read the passed and failed counts.
5. The real thing, once the rest is green: `npm run tauri build -- --debug --no-bundle` (in the foreground, with the
   longest timeout; it embeds the page as a release build does), then
   `bash scripts/launchCheck.sh src-tauri/target/debug/storiiboard.exe`. It must print the eight steps and pass.
   Give the whole output in the report. If a step fails there, that is a finding about the app or the check in a real
   webview: fix the check if the check is wrong, and stop and report if the app is.
   - Don't start the debug app without the variable: it would open the real app on this computer's real data.

## Don't touch

- `src/features/script/readPdf.ts`, the worker files, `src-tauri/worker-csp.txt`, `src-tauri/worker_csp.rs`,
  `src-tauri/tauri.conf.json`, `src-tauri/capabilities`.
- Any existing test's assertions, and the lists inside `tauriContract.test.ts` and `i18n.test.ts`.
- The end-to-end specs and their fixtures, `vite.config.ts`, `playwright.config.ts`.
- `ci.yml`, and every job of `checkpoint.yml` but `installers`.
- `CLAUDE.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/ALPHA_TEST.md`: the main session writes those.
- No new dependency, npm or cargo.

## Report

The files changed, the tests added, each check with its result (counts for tests), the launch check's own output
from step 5, and anything uncertain or left undone: above all anything about the Mac you could not try here.
