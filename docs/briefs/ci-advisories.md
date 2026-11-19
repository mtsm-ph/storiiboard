# Brief: the Advisories job (Kevin, Nov 18)

Work in the repo folder, on branch `ci/advisories` (already checked out, off v2 with rusqlite 0.41.1 merged; don't
switch). Read CLAUDE.md first. This brief names CI files: you may edit .github/workflows/ci.yml and
.github/workflows/checkpoint.yml as it says, nothing else in .github, nothing in .claude. Never commit, push or
merge. Use Edit and Write for every change. Logs and probes go in test-results/.

## Goal

An **Advisories** job on every pull request (ci.yml) and in the checkpoint (checkpoint.yml) that is red for a known
vulnerability or malware in what Storiiboard ships, and only for that. Kevin's rules:

- Sources: `npm audit` and **OSV-Scanner v2.7.0** (Apache-2.0; released 2026-10-12) on package-lock.json and
  src-tauri/Cargo.lock. OSV's results include malware (`MAL-` ids).
- OSV-Scanner is fetched from its GitHub release in the job, never through npx or a package manager:
  `https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_linux_amd64`, checked against SHA-256
  `160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b` before it runs (a mismatch fails the job). The
  Windows build's hash, for running it by hand, is
  `9964ed64ec9a387391eb4cc006ad5c531154821aef29b793e02c448de4686438`. Don't download it on this PC: test with the
  fixtures below.
- **Red** only for an advisory reaching what ships: an npm package that isn't dev-only, or a crate in the app's
  normal dependency tree for Windows (x86_64-pc-windows-msvc) or the Mac (aarch64-apple-darwin). **Malware is red
  anywhere**, dev tools included (it runs on our machines). Listed but **not red**: dev-only npm packages, crates
  only on Linux or only at build time, and unmaintained-crate notices (RUSTSEC "unmaintained", informational).
- An ignore needs Kevin's word, its reason and a date: kept in one file, `osv-scanner.toml` at the repo root
  (OSV's own `[[IgnoredVulns]]` with `id`, `ignoreUntil`, `reason`), and the same file decides for npm audit's
  findings. Past its date an ignore no longer applies (the job goes red again).
- The one ignore Kevin gave (Nov 18): **GHSA-hq66-cqwq-w95j** (pdfjs-dist), until **2027-02-01** or until Phase 8
  decides the Mac's oldest system, whichever comes first. Its reason, in the config, in these words: "The flaw needs
  PDF scripting switched on and no script policy. readPdf.ts only reads text, builds no annotation layer and loads
  nothing from pdfjs-dist/web, and the app's policy allows no inline script and no eval."
- What the first run found on v2 (Nov 18), for your fixtures and to check against: pdfjs-dist 5.7.284
  (GHSA-hq66-cqwq-w95j) and libsqlite3-sys 0.38.2 (RUSTSEC-2026-0459, now fixed by rusqlite 0.41.1) ship; minimatch
  and typescript-eslint are dev only; glib is Linux only; five crates are unmaintained. With rusqlite merged and the
  pdfjs ignore, the job must be green on v2.

## Build

1. `scripts/advisories.ts` (run as `node scripts/advisories.ts`, as scripts/failedTests.ts is): reads OSV-Scanner's
   JSON output and `npm audit --json`, classifies every finding (ships / dev only / Linux or build only /
   unmaintained / malware / ignored until a date, with the ignore's reason), prints one line per finding and a
   summary, and exits 1 only when something is red. What "ships" means is worked out from the lock files and from
   `cargo tree -e normal --target <each of the two>` (run by the job; the script takes its output as input files,
   so it is testable without cargo). No new dependency (TOML: read the small subset osv-scanner.toml uses with your
   own parser, or keep the ignores also in a JSON the script reads and that a test proves agrees with the TOML:
   your call; say which).
2. `osv-scanner.toml` with the pdfjs ignore as above.
3. The job, the same in ci.yml and checkpoint.yml: checkout, Node as the other jobs set it up, `npm ci`, the Rust
   toolchain as ci.yml does (for `cargo tree`), fetch and check OSV-Scanner, run it on both lock files with
   `--format json` (its own exit code doesn't decide), `npm audit --json`, the two `cargo tree` runs, then the
   script. Its step summary lists every finding. It doesn't need the ffmpeg sidecar or the system libraries; if
   `cargo tree` needs them on Linux, say so.
4. Tests (Vitest, scripts/advisories.test.ts) on made-up OSV and npm audit JSON and cargo tree text: each class
   above; an ignore before and after its date; malware in a dev package is red; a Linux-only crate isn't; an
   unmaintained notice isn't; a finding with no fix listed still shows.
5. **The test that keeps the pdfjs reason true** (Vitest, beside readPdf.ts or in src/app): fails if any file but
   readPdf.ts imports `pdfjs-dist`; if anything imports `pdfjs-dist/web` or names `AnnotationLayer` or
   `enableScripting`; or if the app's content security policy (src-tauri/tauri.conf.json, and the e2e policy built
   by scripts/e2eCsp.ts if it differs) allows `'unsafe-inline'` or `'unsafe-eval'` for scripts (script-src, or
   default-src when script-src is absent; worker-src too).
6. readPdf.ts's comment: it says "pdf.js 5 never evaluates code from a PDF", which is no longer true as written. Make
   it say why our use isn't affected (text only, no annotation layer, nothing from pdfjs-dist/web, no scripting, a
   policy with no inline script or eval), and that the Advisories config ignores the advisory until a date.
7. **Report, don't fix:** a worker takes its security policy from its own script's response, not from the page.
   Find out what policy the PDF worker runs under in the installed app (Tauri's custom protocol on the Mac, WebView2
   on Windows): read how readPdf.ts starts its worker (a URL? a blob?), how Tauri serves that file and whether it
   adds the CSP header to non-HTML responses (tauri's source in cargo's registry, not the web). If the worker has no
   policy, write the plan for the fix in your report; don't build it.

## Checks

- `npm run lint`, `npx tsc --noEmit`, Vitest on scripts/advisories.test.ts and the new pdfjs test (from `C:\` upper
  case). Paste counts.
- Run the script on your fixtures and paste its output for a red and a green case.
- No end-to-end runs: nothing in the app's behaviour changes.

## Don't touch

- Any dependency (none added); other workflows' jobs; .claude; CLAUDE.md, PLAN.md, HANDOFF.md; the app's CSP.
- Existing tests: never weaken, skip or delete one.

## Report

The files; how "ships" is worked out; the ignore's mechanics; the job's steps; the worker-policy finding (and the
plan, if it has none); check counts.
