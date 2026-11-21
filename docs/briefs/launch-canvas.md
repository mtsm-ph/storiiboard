# Brief: the launch check when this machine can't read a canvas back (#229; Kevin, Nov 20 night, item 2)

Work in the repo folder on branch `fix/accents-page` (#229, the top of the launch check stack #206 ← #213 ← #219 ←
#223 ← #229; the main session checks it out for you; don't switch). You write code and tests and run the checks below.
You never commit, push or merge. Read `docs/briefs/accents-page*.md` on this branch, `src/app/launchCheck.ts` (or
wherever the check's steps live; search for `BY_THE_PAGE`), `scripts/launchCheck.sh`, `scripts/launchCheck.test.ts`,
and the Mac installer job in `.github/workflows/checkpoint.yml` (it passes `launch_flags: --accents-by-page-ok`).

## Why (Kevin)

On checkpoint/launch-1 the Mac passed all eight steps, the accents read by the worker itself. On nov20-e the read
failed in the worker and on the page with the same bare words ("The object is in an invalid state."). In WebKit's
source, `getImageData` gives those words when the GPU process has no backing for the canvas, and a page's `<canvas>`
gets its buffer from the GPU process just as a worker's does. So it is GitHub's Mac (a virtual GPU), not the app;
Kevin: "it's GitHub's Mac, and the stack stops waiting on mine".

## What to build (Kevin's words, Nov 20 night)

- "When the worker and the page both fail at canvas, draw or read, the check says 'this machine can't read a canvas
  back' and goes on to its last two steps instead of stopping." Its line, for example: `launch check: accents: this
  machine can't read a canvas back (worker: read: …; page: read failed: …)`, the two bare messages kept.
- "scripts/launchCheck.sh fails on that line, except with the flag the Mac installer job already gives. There it
  passes with a warning in the run's summary, and the line stays in the log. Windows and a real Mac stay strict."
  Use the existing `--accents-by-page-ok` flag (no second flag); the warning goes to the job's summary
  (`$GITHUB_STEP_SUMMARY` when set) as well as the log, as the by-the-page pass already warns.
- "The worker must still have answered. One that says nothing, or fails at decode, fails everywhere." So: the worker
  failed at canvas, draw or read, AND the page failed at canvas, draw or read: the new line. The worker silent, or
  failing at decode, or the page failing at decode: FAILED, flag or not. The page passing: the existing "by the page"
  pass, unchanged.
- The steps after accents run as they do today; the check's final line is `passed` when they pass.

## Tests

- `scripts/launchCheck.test.ts`: the new line fails without the flag and passes with it (with the warning, in the log
  and the summary file); a silent worker and a decode failure fail with the flag too; every existing case unchanged.
- Unit tests of the check's accents step for each combination (worker: ok, silent, decode, canvas, draw, read; page:
  ok, decode, canvas, draw, read), saying which line each gives.
- No existing assertion changes; any that would have to, stop and report.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; the unit tests of the files you touch and of `scripts`
(`node test-results/build627b/vitestUpper.cjs <folders>`); `bash -n scripts/launchCheck.sh`. Logs under
`test-results/launch-canvas/`. No end-to-end run is needed unless you change page code a spec covers (say which).
Never start a command with `python`. Nothing fetched through npx. No new dependency. Don't touch anything outside the
launch check, its script and its tests, except the workflow's step summary line if it needs one; CLAUDE.md,
docs/PLAN.md, docs/HANDOFF.md stay as they are.

## Report back

Each combination and its line; what changed in the script and the workflow; each test's name and result; each check's
output line with counts.
