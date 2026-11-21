# Brief: the page stands in for a failing accent worker; the launch check says who answered; launch-only runs (6.27r)

Kevin, Nov 20 (afternoon). Work in the repo folder on branch `fix/accents-page` (already checked out, made from
`ci/launch-check-accents`, #223; don't switch). You write code and tests and run the checks below. You never commit,
push or merge. Read CLAUDE.md's Workflow and Safety sections first, and `docs/briefs/launch-check.md` and
`docs/briefs/launch-check-accents.md` on this branch for what the launch check is.

## Why

On GitHub's Mac the built app's launch check failed at `accents`: the accent reader's worker answered "The object is
in an invalid state." A read of WebKit's source says only `getImageData` gives those bare words, when a canvas's
buffer got no backing from the GPU process; GitHub's Mac has a virtual GPU. Kevin won't build the app on his own Mac,
so the answer has to come from short CI runs, and the app has to work whichever way that answer falls.

Don't try `willReadFrequently` or any other canvas setting: a worker's canvas lives in the GPU process whatever it
says (Kevin's word).

## Five parts

### 1. checkpoint.yml: a launch-only run

- A branch named `checkpoint/launch-<anything>` runs only the `sources` job (ffmpeg sources) and the two `installers`
  jobs, launch check included. The other jobs (`smoke-linux`, `e2e-chromium-linux`, `smoke-mac`, `advisories`) don't
  run for it: a job-level `if` on each, joined with the conditions it already has.
- Say so in the file's header comment, beside the lines about `checkpoint/baselines-<anything>`: it answers a
  launch-check question in about a quarter of an hour and is never a checkpoint to merge on.
- Nothing else about any job changes for other branch names.
- The `Launch check` step passes the script a flag on the Mac only (part 5): add a matrix key for it (for example
  `launch_flags: --accents-by-page-ok` on macOS, nothing on Windows) and put it before the app's path.

This brief asks for the change to CI; touch nothing else under `.github`.

### 2. The app: the page does the work when the worker reports an error

`src/ui/theme/generator/extract.ts`, `extractAccents`:

- Today the page does the work itself when there is no worker, the worker can't start, it dies (`onerror`) or it
  takes over 15 s. When the worker posts an error, that error is the answer and the page is never asked.
- New (Kevin): when the worker reports an error, the page does the work itself too. A person sees an error only when
  the page fails as well, and then it is the page's error.
- `askWorkerAlone` doesn't change: it still rejects with the worker's words and stage, because the launch check needs
  the worker's own answer.
- Rewrite the comments that said the worker's failure is the answer ("the page would fail the same way").

### 3. No `new OffscreenCanvas` called directly (macOS 13.0 to 13.2 have none)

- `src/ui/theme/generator/sample.ts` and `src/features/storyboard/palette/read.ts` call `new OffscreenCanvas`
  directly. WKWebView before Safari 16.4 (macOS 13.0 to 13.2, which the app supports) has no OffscreenCanvas, so a key
  image's accents and a scene's palette fail there today.
- Both make their canvas with `makeCanvas` (`src/core/media/canvas.ts`), which already falls back to a `<canvas>`.
- `sample.ts` is shared with the worker, and `canvas.ts` imports the translations and the picture cleaner, which must
  not end up in the worker's bundle. So move `makeCanvas` and its two types (`AnyCanvas`, `Canvas2D`) into a small
  module of their own with no imports (for example `src/core/media/makeCanvas.ts`), re-export them from `canvas.ts` so
  every existing import keeps working unchanged, and have `sample.ts` import from the small module. `read.ts` runs on
  the page only and imports from `canvas.ts` as the others do.
- In a worker with no OffscreenCanvas there is no `document` either: `makeCanvas` then throws, inside `sample.ts`'s
  `canvas` stage, the worker reports it, and with part 2 the page does the work. Keep the stages (`decode`, `canvas`,
  `draw`, `read`) exactly as #223 made them.
- `makeCanvas` gives a null context when the webview can't give one: `sample.ts` keeps throwing its present words for
  that, in the `canvas` stage; `read.ts` keeps returning null.

### 4. The launch check's accents step (`src/app/launchCheck/launchCheck.ts`, `start.tsx`)

Kevin's rule, made exact:

| The worker's first answer | The page, same picture | The step |
|---|---|---|
| accents, at least one | not asked | ok, exactly as now (no note) |
| an error at `canvas`, `draw` or `read` | reads it and finds at least one accent | ok, with a note (below); then the worker is asked once more and the note says what it answered |
| an error at `canvas`, `draw` or `read` | fails, finds none, or no answer in 10 s | failed, with #223's line, unchanged |
| an error at `decode`, or with no stage | whatever | failed, with #223's line, unchanged |
| nothing (null), an empty list, or no answer in 20 s | whatever | failed, with #223's line, unchanged |

- Every failure line stays character for character what #223 writes: the tests in `launchCheck.test.ts` that pin
  them stay as they are.
- The note of a pass by the page, one line, begins with exactly `by the page` (the script looks for it; keep the
  phrase in one exported constant):
  `by the page: read ok, 16 × 16, 3 accents; the worker: <its words> (worker: <stage>); the worker asked again: <what it said>`
  where "what it said" is one of: `ok, N accents`; `<its words> (worker: <stage or "no stage">)`; `no answer (null)`;
  `no accent found`; `no answer in 10 s`.
- The second ask is the same call with the same picture, under a 10 s limit of its own. It never changes the verdict:
  the step has already passed by the page. Keep the whole within Rust's 90 s (25 s PDF, 20 s first ask, 10 s page,
  10 s second ask).
- `runLaunchCheck`'s `step` reports a passing step's note as `detail` (today it sends an empty string for every pass;
  it still does for every pass without a note).
- The worker scripts counted for the `worker-policy` step are a set of addresses: a second start of the same script
  changes nothing there. Check that it holds.

### 5. Rust and the script: a pass by the page is said, and is refused unless allowed

`src-tauri/src/launch_check.rs`:

- A page step reported ok with a non-empty detail gets that detail as the note of its ok line, through the cleaning
  and bound a failure's reason gets: `launch check: accents ok (by the page: …)`. An ok report with an empty detail
  prints exactly what it prints today. The verdict, the exit code and `launch check: passed` don't change: the app
  reports honestly and the script judges.
- If an existing Rust test asserts that an ok step's detail is dropped, that one expectation changes with this brief;
  say which. No other existing assertion changes.

`scripts/launchCheck.sh` (bash 3.2 on the Mac: nothing newer):

- Usage becomes `bash scripts/launchCheck.sh [--accents-by-page-ok] <path to the app's executable>`. An unknown flag,
  or no path, fails with a line that says how to call it.
- After the app has quit with 0 and said `launch check: passed`: when its output holds a line that begins
  `launch check: accents ok (by the page`, the script fails (`launch check: FAILED: the accents came from the page,
  not the worker`, then one line saying the flag exists and where it belongs: GitHub's Mac, whose GPU is virtual),
  unless the flag was given; with the flag it passes and says one `launch check: warning:` line that repeats the
  note.
- Without that line in the output the flag changes nothing.
- Update the script's header comment (usage, and why the flag exists: Windows and a real Mac stay strict).

## Tests

Existing tests: two expectations change, named here. Everything else stays as it is; if another would have to
change, stop and report.

- **The first changed expectation:** `src/ui/theme/generator/extract.test.ts` › "extractAccents, as before" ›
  "rejects with the worker’s words alone when it sent a stage, never asking the page (6.27q)". It becomes the
  opposite, by Kevin's rule: the page is asked and its answer is the answer. Rename it to say so.
- **The second (found by the builder, added to this brief Nov 20):** `src/app/launchCheck/launchCheck.test.ts` ›
  "accents" › "gives the page the same picture it gave the worker". Its worker fails at `draw` and its page reads the
  picture fine, which is now a pass by the page. Keep what the test is for (a failure in which the page is asked, with
  the same picture, the failure line kept and `window.Worker` put back): change only the stage its worker fails at,
  from `draw` to `decode`, and with it the one word in the line it expects (`(worker: decode)`). The new by-the-page
  tests (3 below) check the same picture reaches the page once and the worker twice.

Add:

1. `extract.test.ts`: the worker reports an error with a stage and with none: the page's accents come back; the
   worker reports an error and the page fails too: the rejection is the page's error, not the worker's;
   `askWorkerAlone` still rejects with the worker's words and stage (its present tests stay).
2. `sample.test.ts` (or beside it): with no `OffscreenCanvas` in the global scope, `samplePixels` on a page makes its
   canvas from `document` and reads the pixels; with neither `OffscreenCanvas` nor `document` (a worker on macOS
   13.0) it throws at the `canvas` stage. Follow how that file already fakes the browser.
3. `launchCheck.test.ts`, new cases only: for each of `canvas`, `draw`, `read`: the worker fails there, the page
   finds accents: the step is reported ok with the note, for each kind of second answer (ok with N accents, the same
   error, an error with no stage, null, an empty list, no answer in 10 s); the page is asked exactly once and the
   worker exactly twice, with the same picture; the run then goes on to `worker-policy` and `no-violation` and the
   check passes; the note begins with the exported constant; `window.Worker` is put back. And: worker fails at `read`,
   the page reads but finds no accent: failed with #223's line.
4. A test that `scripts/launchCheck.sh` holds the same `by the page` marker as the exported constant (read the
   script as text), so the two can't drift.
5. Rust (`launch_check.rs` tests): an ok page step with a detail prints `launch check: accents ok (<note>)`, cleaned
   and bounded like a failure's reason; with an empty detail the line is today's; `loaded`'s own note still works; a
   pass with a note still ends in `launch check: passed` and exit code 0.
6. End to end, Chromium here and WebKit on CI:
   - `e2e/themes.spec.ts`: "reads a logo’s accent on the page when the worker reports an error and there is no
     OffscreenCanvas (macOS 13.0 to 13.2)": in the page, remove `OffscreenCanvas` from `window` and stand a fake
     `Worker` in that answers every message with `{ error: 'Can’t find variable: OffscreenCanvas', stage: 'canvas' }`;
     draw the test picture on a `<canvas>` element; `extractAccents` gives the red accent the test beside it expects.
     Put `window.Worker` back.
   - `e2e/palette.spec.ts`: a scene's palette still reads with `OffscreenCanvas` removed from the page before the
     app starts (an init script): the same swatches as the test it sits beside expects with it. If the app touches
     `OffscreenCanvas` anywhere else on that path, say where instead of working around it.
7. The script's flag, by hand with a stand-in for the app (a small shell script under `test-results/` that prints
   lines and exits 0): passes with a plain `accents ok`; fails without the flag and passes with it when the stand-in
   prints the by-the-page line; fails on an unknown flag. Paste the four results in your report. (On this PC run it
   with Git Bash.)

## Checks to run

- `npx tsc --noEmit`, `npx eslint .` (or the touched files), `bash -n scripts/launchCheck.sh`.
- Unit: `node test-results/build627b/vitestUpper.cjs src/ui/theme/generator src/app/launchCheck src/app/pdfjsUse.test.ts
  src/app/cspFetch.test.ts src/core/media` (this shell's lower-case drive letter makes plain Vitest fail every file;
  that helper runs it from `C:\`). Then the whole unit suite once: `node test-results/build627b/vitestUpper.cjs`.
- Rust, from `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test launch_check`,
  then the whole `cargo test`.
- The page's build: `npm run build`. Then say which file under `dist/assets` is the accent worker's and how large it
  is, and confirm it holds none of the translations (search it for the English sentence `Reading the image’s
  colours`): that is what the small `makeCanvas` module is for.
- End to end, alone (nothing else running, no edits meanwhile), reading counts from the output, not the exit code:
  `npx playwright test e2e/themes.spec.ts e2e/palette.spec.ts e2e/projectTheme.spec.ts --project=chromium --workers=4`.
- Logs and stand-ins go under `test-results/accents-page/`.

## Don't touch

- CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, `.claude`, and `.github` beyond part 1: the main
  session writes the docs.
- The launch check's other steps, its exit codes, the time limit, `net.rs`, the worker policy, `worker.ts`'s message
  shape, the built-in picture and PDF.
- No new dependency. No prettier. Single quotes, about 120 columns, comments that say why.
- Never start a command with `python`. Nothing fetched through npx. Nothing from `private/samples`.
- The launch check's lines are for a CI log, not for people: they are not translated (as the file's header says).
  Any word a person can see goes through `t()` in en and es; this brief adds none.

## Report back

Per part: what changed (files, functions); the one changed expectation and any other you had to stop at; every new
test's name and result; each check's output line with its counts; the worker bundle's file and size; the four script
results; every test that failed on the way, by name; and anything in the rule you would question.
