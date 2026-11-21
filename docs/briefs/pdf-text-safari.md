# A PDF's text is read in Safari's engine too (6.27p): brief

Found Nov 20 by the launch check's first run on a Mac (checkpoint nov20-b, Installer (macOS)):

```
launch check: policy-watch ok
launch check: FAILED at pdf-text: undefined is not a function (near '...e of t...')
```

## The cause

- pdf.js 5.7.284's `PDFPageProxy.getTextContent()` reads its stream with `for await (const value of readableStream)`
  (in the built page: `for await(let e of t)`).
- Safari's engine has no async iteration of a `ReadableStream`, macOS 26's WKWebView included. Chromium has it, and
  so does the WebKit build Playwright ships, which is newer than any Safari: that is why every end-to-end test of a
  PDF import passes while reading a PDF fails in the installed Mac app.
- Checked on this PC with the launch check's own page in Playwright's engines: with
  `ReadableStream.prototype[Symbol.asyncIterator]` (and `.values`) deleted on the page, the PDF step fails the same
  way in both; with them deleted only inside the worker, it passes. So the page's side alone needs the fix.

## Goal

`src/features/script/readPdf.ts` reads each page's text without `getTextContent()`: through
`page.streamTextContent()` and a reader (`getReader()`, then `read()` until done), which every engine has. The same
items, in the same order, with the same result. Nothing else about the reader changes: the worker of its own making,
the options, the 60 s limit, the clean-up, the words.

## Decisions

- In `read()`, each page's chunks are read one after another; each chunk's `items` are handled exactly as
  `content.items` are today. The reader's lock is released on every path (done, an error, the time limit).
- No polyfill: the app's own code should not depend on a feature Safari lacks, and nothing else in `src/` uses
  `for await` today (say so in the report if you find one).
- The launch check is not touched. It already runs the real reader, so it will show the fix on the Mac at the next
  checkpoint.

## Tests to add

- **End to end, `e2e/script.spec.ts`:** a new test beside the existing PDF import test, in its style: with
  `ReadableStream.prototype[Symbol.asyncIterator]` and `ReadableStream.prototype.values` deleted by an init script
  before the page loads (as in Safari's engine), importing the PDF screenplay still gives its scenes. It runs in
  Chromium here and in both engines at a checkpoint.
  - Show that it guards the bug: put `getTextContent()` back for one run and see this test fail, then restore the
    fix. Say in the report what the failure said.
- **Vitest, `src/app/pdfjsUse.test.ts`** (the guard on how pdf.js is used): one new test, with its reason: no file
  under `src/` outside tests calls `getTextContent(`. No existing test in that file changes.

## Checks to run

1. `npm run lint`.
2. Vitest, the whole suite.
3. Chromium only: `npx playwright test e2e/script.spec.ts e2e/workerCsp.spec.ts e2e/smoke.spec.ts
   --project=chromium`. Read the passed and failed counts.
4. `npm run tauri build -- --debug --no-bundle`, then `bash scripts/launchCheck.sh
   src-tauri/target/debug/storiiboard.exe`: all eight steps and a pass. Its whole output in the report.
5. No cargo test: no Rust changes.

## Don't touch

- `src/app/launchCheck/`, `src-tauri/`, the worker files, `src-tauri/worker-csp.txt`, CI.
- Any existing assertion; pdf.js's version; `CLAUDE.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/ALPHA_TEST.md`.
- No new dependency.

## Report

The files changed, the tests added, each check with its counts, what the new end-to-end test said when the fix was
taken out, the launch check's output, and anything else in `src/` that iterates a stream with `for await`.
