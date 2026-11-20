# Brief: the turn's lateness, after its review (6.27j, #207, round 2; Nov 20)

Work in the repo folder on branch `fix/player-missed-frames` (already checked out; don't switch). Tests and one
README only, plus one small change in the spec. You never commit, push or merge. Read
`docs/briefs/player-late-turn.md` on this branch first: it is the rule this round tests harder.

The review found no fault in the rule as built. It found three wrong versions of it that every present test would
let through, a README that is out of date, and one place the rule doesn't reach yet.

## 1. Three tests to add to `e2e/frameCount.test.ts` (in "the turn's lateness"; change no existing test)

Use the file's own helpers for timed runs (the ones the present lateness tests use; each step is a frame, when its
callback ran, and how late that was for its picture). Clip In 10, Out 20.

1. **An on-time out frame lends nothing, even when the first report past it ran late.** Reports: 19 on time; 20 on
   time; 22 with one frame missed and its own report 2.3 frames late; then the turn to 10. With the lateness list it
   must still throw `frame 22 reported after 1 missed (1 allowed in this run)`. (A version that falls through to the
   next report's lateness when the out frame's is 0 would pass it wrongly.)
2. **Only the turn's report lends its lateness, not every report in the run.** Reports: 19 on time; 20 on time; 21
   reported 2.2 frames late with none missed; 22 on time; no turn. With the list it must throw on frame 21 with 0
   allowed. (A version that adds each run report's own lateness would pass it wrongly.)
3. **A second run starts from nothing.** One list with two runs past the out point: the first after an out-frame
   report 2 frames late (allowed, passes), then the turn, a full pass through the clip on time, an on-time out frame
   and an overshoot to 21 on time: it must throw on that 21 with 0 allowed. (A version that carries the first turn's
   lateness into the next run would pass it wrongly.)

For each, say in your report whether it fails on the wrong version it is aimed at: check by reasoning or by trying
the wrong line for a moment and putting the right one back.

## 2. `e2e/fixtures/frameReports/README.md`

Its first paragraph and the note under the table still say every file's `seen` is the old count, from
`presentedFrames`. That is true of the four nov19 files only: the two nov20-a files carry the count as #207 makes it
(from the jump in media time). Make both places true; change nothing else in it.

## 3. `e2e/player.spec.ts`: one rule everywhere

The test "a frame's clip plays in the inspector" (the one with two checks of the frames, near lines 367 and 381 on
this branch) checks its frames without the raw reports, so a late turn there would fail the same false way the
busy-page test did. Give those two checks the raw reports too, exactly as the busy-page test passes them (the
spec's `expectInside` wrapper already takes them). If the helper that collects the frames there drops the raw
reports, keep them. Change nothing else: no load, limit, timeout, selector or assertion.

This is the one change to an existing test's check in this round, and the brief asks for it: the rule Kevin
approved is the count's rule, not one test's.

## Checks to run

- `npx tsc --noEmit`; `npx eslint e2e/frameCount.ts e2e/frameCount.test.ts e2e/player.spec.ts`.
- Unit: `node test-results/build627b/vitestUpper.cjs e2e/frameCount.test.ts`.
- End to end, alone, counts read from the output: `npx playwright test e2e/player.spec.ts --project=chromium
  --workers=4`.
- Logs under `test-results/player-late-turn/`.

## Don't touch

`e2e/frameCount.ts` (the rule is right), the app, any other spec, docs/PLAN.md, CLAUDE.md, docs/HANDOFF.md. No
prettier. Never start a command with `python`. Nothing fetched through npx.

## Report back

Each new test's name, its result, and whether it catches the wrong version it is aimed at; the README's two changed
places; the spec's change; each check's output line with counts.
