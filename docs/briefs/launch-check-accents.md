# The launch check's accents step says where it failed (6.27q): brief

Checkpoint nov20-c (Nov 20), Installer (macOS), with the PDF fix in:

```
launch check: pdf-text ok
launch check: FAILED at accents: The object is in an invalid state.
```

On Windows Server the same build passed all eight steps.

## What is known, and what isn't

- The words are WebKit's for a bare `InvalidStateError`. The accent reader's worker (`src/ui/theme/generator/worker.ts`)
  runs `samplePixels` (`sample.ts`): `createImageBitmap(blob)`, an `OffscreenCanvas`, its 2d context, `drawImage`,
  `getImageData`. One of those threw in the worker, and nothing says which.
- The same worker passes the themes spec in Playwright's WebKit on the same runner, with a picture the engine made
  itself. The launch check's picture is a 16 × 16 PNG written by a script.
- So it is one of three things, and no run so far can tell them apart:
  1. the Mac's real webview can't do one of those calls inside a worker, on GitHub's virtual Mac only;
  2. it can't on any Mac, and choosing a project's key image fails in the Mac app (`prepareThemeImage` rejects when
     the worker reports an error: there is no fallback for that);
  3. it can't decode this one picture.
- No checkpoint is left tonight, so this brief does not fix anything. It makes the next run on a Mac say which.

## Goal

When the `accents` step fails, its line names the stage that failed inside the worker, and says what the page itself
gets from the same picture, stage by stage. Nothing a person sees changes, and a pass is unchanged.

## Decisions

- **The stage travels with the error, never in its words.** In `sample.ts`, each stage's failure is rethrown as the
  same error with a `stage` beside it: `decode` (`createImageBitmap`), `canvas` (the canvas and its 2d context),
  `draw` (`drawImage`), `read` (`getImageData`). The error's message stays exactly what it is today, since a person
  may read it.
- `worker.ts` posts the stage beside the error (`{ error, stage }`). `extract.ts`'s worker-only function rejects with
  the same message as today, the stage on the Error object. `extractAccents`, its fallback and every word a person
  sees stay exactly as they are.
- **The launch check's line, on a failed `accents`:**
  `<the worker's words> (worker: <stage>); on the page: <what happened>`, where the page runs the same four stages
  itself on the same picture and reports the first that fails with its message, or `read ok, <width> × <height>,
  <n> accents`. A `null` from the worker (no worker, or over 15 s) keeps today's words and gets the page's part too.
  The line is still cut to 300 characters by Rust.
- The page's part runs only after a failure. A passing check does exactly what it does today.
- No new worker, no new file the app ships beyond these edits, no word for a person, no change to the picture.

## Files

- `src/ui/theme/generator/sample.ts`, `worker.ts`, `extract.ts`: the stage, as above.
- `src/app/launchCheck/launchCheck.ts` and `start.tsx`: the line.
- Their tests.

## Tests to add

- Vitest, `sample.ts`: each stage's failure carries its stage and keeps its message (with fakes for
  `createImageBitmap` and `OffscreenCanvas`); a pass is unchanged.
- Vitest, `extract.test.ts`: a worker error with a stage rejects with the same message and that stage;
  `extractAccents` still behaves as before for every case already tested (no existing assertion changes).
- Vitest, `launchCheck.test.ts`: a failed `accents` line for each of: a worker error with a stage and the page
  reading fine; the page failing at each stage; `null` from the worker. The existing accents tests' expected details
  change to the new form: these are this milestone's own tests from 6.27l, and the brief names them: every test in
  `launchCheck.test.ts` whose expected detail is an `accents` failure.
- No end-to-end test.

## Checks to run

1. `npm run lint`.
2. Vitest, the whole suite.
3. Chromium only: `npx playwright test e2e/themes.spec.ts e2e/smoke.spec.ts --project=chromium`.
4. `npm run tauri build -- --debug --no-bundle`, then `bash scripts/launchCheck.sh
   src-tauri/target/debug/storiiboard.exe`: all eight steps and a pass, its whole output in the report.

## Don't touch

- What `extractAccents` returns or says in any case; `themeEdits.ts`; the worker's policy; `src-tauri/`; CI.
- Any existing assertion outside `launchCheck.test.ts`'s accents failures.
- `CLAUDE.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/ALPHA_TEST.md`. No new dependency.

## Report

The files changed, the tests added and changed, each check with its counts, the launch check's output, and an example
of the new failure line from a test.
