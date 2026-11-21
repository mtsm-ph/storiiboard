# Brief: a security policy for every worker the app starts (Nov 19)

Branch `fix/worker-csp`, from `v2`. Work in the repo folder. Read CLAUDE.md first. Never commit, push or merge. Use
Edit and Write for every change. Logs and probes go in test-results/.

## The gap

The installed app's content security policy (tauri.conf.json `app.security.csp`) reaches only the page. Tauri 2.12.5
adds the CSP header only to assets whose path ends in `.html` (`get_asset` in tauri's src/manager/mod.rs, `is_html`).
A dedicated worker started from a URL takes its policy from its own script's response, never from the page, so a
worker whose `.js`/`.mjs` comes with no header runs with no policy at all. The e2e server copies the gap: it sends
the policy only to requests that accept `text/html` (vite.config.ts, `e2eContentSecurityPolicy`).

Kevin (Nov 19): every worker the app starts gets a policy at least as strict as the page's. The PDF worker's allows no
network at all and no eval, since it reads files from strangers.

## The workers (the main session's inventory; confirm it, step 1)

1. **The PDF text reader** (src/features/script/readPdf.ts): `new Worker(pdf.worker.min.mjs?url, { type: 'module' })`
   from pdfjs-dist 5.7.284's legacy build. It is handed the bytes. It needs to run its own script and nothing else:
   no fetch (no `cMapUrl`, `standardFontDataUrl` or `wasmUrl` is passed), no eval (that build's worker has no
   `new Function`), no images or fonts loaded, no nested workers.
2. **The theme's accent reader** (src/ui/theme/generator/extract.ts, worker.ts): a module worker that imports
   generate.ts, sample.ts and their imports, and gets a Blob: `createImageBitmap` and an `OffscreenCanvas`. No
   fetch, no eval, no nested workers.

No other `new Worker`, `SharedWorker` or service worker appears in src or web.

## What to build

1. **Confirm the inventory.** `npm run build`, then search dist/ for `new Worker`, `SharedWorker`,
   `serviceWorker.register` and `importScripts`, to catch a worker a dependency starts. Write what you found in
   test-results/worker-inventory.txt and in your report. If there's a worker this brief doesn't name, stop and
   report it.
2. **One policy for worker scripts, in one file** both Rust and the e2e server read (proposed: src-tauri/worker-csp.txt,
   `include_str!` in Rust, `readFileSync` in vite.config.ts; a comment in it saying why it's strict):
   `default-src 'none'; script-src 'self'; worker-src 'none'; base-uri 'none'`. `worker-src` is named because it
   falls back to `script-src`. Every directive is as strict as the page's or stricter. If either worker needs more
   (find out by running it), stop and report what and why before you loosen anything.
3. **The app** (src-tauri): the policy goes on every response for the app's own `.js` and `.mjs` assets. On a page's
   script the header is ignored; on a worker's script it is that worker's policy.
   - Through `on_web_resource_request` on the main window (tauri 2.12.5 has it on `WebviewWindowBuilder`). The window
     is built from config today: set `"create": false` on it in tauri.conf.json and build it in `setup` with
     `WebviewWindowBuilder::from_config`, keeping every setting and every existing handler as it is (hidden at
     start, shown on load, the drag-drop event, the 3-second safety net).
   - The decision is a plain function (path or response in, header or not), unit-tested: `.js`, `.mjs`, with a query,
     upper case; never `.html`, `.css`, `.json`, images; never an existing header replaced on a page.
   - Plus a test through tauri's `test` feature if its mock runtime reaches the asset handler. If it doesn't, say so
     and keep the function test.
4. **The e2e server** (vite.config.ts): the same policy, read from the same file, on every response whose
   Content-Type is JavaScript (the dev server's workers are `.ts` with a query, so it's by type, not extension).
   - In the e2e build only, the worker policy also gets the test page's report address (`report-uri` to
     `/@storiiboard/csp-violation`), so a violation inside a worker fails the run as a page's does. List that in
     scripts/e2eCsp.ts as an addition with its reason, which scripts/e2eCsp.test.ts names.
   - Check that the server's report endpoint and e2e/cspTeardown.ts read a browser's JSON CSP report, and make them
     do so if they don't. No existing check is loosened.
5. **A probe worker for the tests**: e2e/fixtures/workerProbe.js, a module worker started from the test page by
   address. It tries `eval('1')`, `new Function('')` and a `fetch` to the app's own origin, and posts back yes/no
   for each. Its violations are the meant ones: marked as meant the way shell.spec.ts's one is, by the probe's own
   address and nothing wider.
6. **Before the fix, first:** write the probe and a spec (e2e/workerCsp.spec.ts), then run it on the unchanged server
   in Chromium and in WebKit on this PC. Save what each engine allowed (eval, Function, fetch) to
   test-results/worker-csp-before.txt. Kevin asked what each webview did before the fix. Then build the fix.
7. **Tests after the fix:**
   - workerCsp.spec.ts: eval, Function and fetch are refused inside the probe worker; the page's own policy is
     unchanged.
   - script.spec.ts's PDF import still reads a PDF, now under the worker policy; the theme spec that reads a key
     image's accents still gets them from the worker, not the page's fallback. If no spec checks that it was the
     worker, add a check.
   - Rust: the function test and the window still built with its settings.
8. **docs/ALPHA_TEST.md:** a line under the install checks, marked [Kevin], for Windows and the Mac: in the installed
   app a PDF script imports and a key image gives its colours. The header itself can't be seen in a release build
   (no web inspector), so the line says the Rust test checks the header on the built assets. Write it in the
   file's style.

## Don't touch

- The page's CSP in tauri.conf.json, except `"create": false`. PLAN.md, HANDOFF.md, CLAUDE.md, .claude, CI.
- No new dependency. No schema change. No screenshot change: stop and report if one would change.
- Existing tests: never weaken, skip or delete one or an assertion in one. `noDevSocket` and the other e2e server
  rules stay.

## Checks (paste counts)

`npm run lint`, `npx tsc --noEmit`, `npm run test:rust`, `npm run lint:rust`, Vitest on every touched file and its
neighbours (from `C:\`, upper case), then in Chromium alone: e2e/workerCsp.spec.ts, e2e/script.spec.ts, the theme
spec you touched and e2e/shell.spec.ts. Also workerCsp.spec.ts in WebKit. Then `npm run failed-tests`. Report what
each engine did before the fix, the inventory, and every file changed.
