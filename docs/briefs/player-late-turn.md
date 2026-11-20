# Brief: the turn's own late report counts (6.27j, #207; Kevin, Nov 20)

Work in the repo folder on branch `fix/player-missed-frames` (already checked out; don't switch). You write code and
tests and run the checks below. You never commit, push or merge. Read CLAUDE.md's Workflow and Safety sections first.

## Goal

`e2e/player.spec.ts` › "a page too busy to see every frame shows a frame or two past the out point, never more than
it was late by (2.8)" failed twice on GitHub's Mac (checkpoint nov20-a, the first try and its retry) with
"frame 22 reported after 1 missed (1 allowed in this run)". The app did its part; the count is short. Fix the count.

What happened, in both kept reports (clip In 10, Out 20, 24000/1001):

- Frame 20, the out frame, was reported 98 ms (and 90 ms) after its picture was presented: over two frames late.
  The clip paused in that very callback, as it should.
- By then the webview had already shown frame 22. Between the reports of 20 and 22 one frame was skipped, so
  `countMissed` gives 22 a `missed` of 1 and the run is allowed 1, but 22 is 2 past the out point.
- The count gives credit for frames skipped between two reports. It gives none for a report that ran late for its
  own frame, which is exactly how the clip came to turn late.

## The rule (Kevin, Nov 20, his words)

> What a run past the out point is allowed also counts how late the report that turned the clip ran, in whole frames
> (its `now` minus its presentation time). That report is the out frame's own when the page saw it, else the first
> one past it. The two reports kept from nov20-a go in as fixtures. A frame past the out point on a page that was on
> time must still fail: those tests stay as they are.

Made exact:

- A report's lateness is `Math.floor((now - presentationTime) / FRAME_MS)`, never below 0, and 0 when
  `presentationTime` is null.
- A run past the out point is the reports with `frame > to` in a row (as `expectInside` already walks them). The
  report that turned the clip for that run is:
  - the out frame's own report, when the report or reports just before the run have `frame === to`: the first of
    those in a row (the clip turns on the first callback that reports its out frame);
  - else the first report of the run (the picture went past the out frame without reporting it).
- The run's allowance starts at that report's lateness, then grows by each report's `missed`, as today.
- Nothing else changes: `countMissed`, its cap by the time between pictures, a step back counting 0 and lending
  nothing.

## How to build it (keep every existing assertion as it is)

Files: `e2e/frameCount.ts`, `e2e/frameCount.test.ts`, `e2e/player.spec.ts`, `e2e/fixtures/frameReports/`.

- Don't add a field to `Presented`: existing tests compare `countMissed`'s result with `toEqual` on
  `{ frame, missed }`, and the kept fixtures' `seen` has only those two.
- Add an exported function in `e2e/frameCount.ts` that gives each raw report's lateness in whole frames (for example
  `lateness(raw: readonly RawReport[]): number[]`), with a comment that says why it exists (the nov20-a failure, in
  two lines).
- `expectInside` takes that list as an optional last argument. Without it every report counts as on time, so every
  existing call and every existing test behaves exactly as before.
- The failure message keeps its present form, `frame N reported after M missed (A allowed in this run)`, where A now
  includes the turn's lateness. Existing tests match that text with regular expressions that end at `run\)`; you may
  add words after the closing bracket when the lateness is above 0 (for example how many frames the turn's report
  ran late), never inside it.
- `e2e/player.spec.ts`: wherever it checks frames with the raw reports at hand, it passes their lateness. Change
  nothing else in the spec: not the load it puts on the page, not a limit, not a timeout, not what it attaches
  (`frame-reports.json` keeps `engine`, `clip`, `seen`, `raw`).
- Fixtures: the two reports are in `test-results/nov20a-frames/try0.json` and `try1.json` on this PC (the attachment
  of each try, saved pretty-printed). Write them to `e2e/fixtures/frameReports/nov20a-webkit-try0.json` and
  `nov20a-webkit-try1.json` as one line each, like the files already there (`JSON.stringify` of the parsed file: the
  same values, nothing added or dropped). Add two rows to that folder's README.md (nov20-a, WebKit, GitHub's Mac,
  first try and retry) and one sentence: these two failed when they ran, with the message above, and pass with the
  turn's lateness counted. They hold only the test clip's frame times: no person, no path.

## Tests to add (in `e2e/frameCount.test.ts`; change no existing test)

1. Each nov20-a fixture, from its `raw`:
   - `countMissed(raw)` equals the file's own `seen` (those attachments already carry the new count);
   - without the lateness list `expectInside` throws `/frame 22 reported after 1 missed \(1 allowed in this run\)/`,
     which is what the checkpoint said;
   - with it, it doesn't throw;
   - the out frame's report is 2 whole frames late in both files (state the number in the test).
2. Made-up runs with the file's `run()` helper, which already takes a presentation time:
   - the out frame's report 2.3 frames late, then 22 with 1 missed, then the turn: passes with the list, throws
     without it;
   - the same with the out frame's report 0.9 frame late: 0 whole frames, so it throws either way;
   - the out frame reported twice in a row, the first late by 2, the second on time: the first's lateness counts;
   - the out frame never reported (19, then 22 late by 2 with time for 2 missed, then the turn): the first report
     past the out point lends its lateness;
   - a report with no presentation time lends 0;
   - a late report inside the clip that is not the turn lends nothing to a later run (for example 15 reported 3
     frames late, then everything on time and an overshoot to 21: still fails);
   - on time everywhere and no turn at the out point: still fails on 21, with and without the list.
3. Every test already in the file passes unchanged. If one would have to change, stop and report: don't edit it.

## Checks to run

- `npx tsc --noEmit`
- `npx eslint e2e/frameCount.ts e2e/frameCount.test.ts e2e/player.spec.ts`
- Unit: `node test-results/build627b/vitestUpper.cjs e2e/frameCount.test.ts` (this shell spells the drive letter in
  lower case, which makes Vitest fail every file; that helper runs it from `C:\`). If the helper is missing, say so.
- End to end, this spec only, alone (nothing else running, no edits meanwhile):
  `npx playwright test e2e/player.spec.ts --project=chromium --workers=4`. Read the passed and failed counts from
  the output, not the exit code.
- Logs go under `test-results/player-late-turn/`, never the repo root or `e2e/`.

## Don't touch

- The app (`src/`, `src-tauri/`): this is the test's count only.
- Any other spec, `playwright.config.ts`, `vite.config.ts`, CI, `.claude`, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md.
- No new dependency. No prettier. Single quotes, about 120 columns, comments that say why.
- Never start a command with `python`. Nothing fetched through npx.

## Report back

What changed (files and functions), each new test's name and result, the whole output line of each check with its
counts, every test that failed on the way (by name, flaky ones too), and anything in the rule you would question.
