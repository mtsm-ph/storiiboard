# Brief: the scroll lane and three reorder tests (#222, round 6)

Work in the repo folder on branch `fix/scroll-lane` (the main session checks it out for you; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/layers-keys-line.md` and
the later rounds on this branch first (what the lane is and why: Kevin, "Keep controls clear of the scroll bar wherever
it lies over the content, in every scrolling tile. Decide by whether it overlays, not by the system's name").

## What happened

Checkpoint nov20-f (Linux, Chromium, the whole suite) failed three tests of `e2e/reorder.spec.ts`, each twice, and
nothing else in that job failed. #222 is the only PR in that checkpoint that changes the board's layout, and nov20-e
(the same board without #222) passed them all:

- `drags a frame into another scene, numbering it there` (line 102): the test's own precondition `wellInView` fails
  at `expect(point.y - view.area.top).toBeGreaterThanOrEqual(24)`: once the two points' middle is at the scroll
  area's middle, the pressed frame or the drop point is less than 24 px from the area's top.
- `a frame dropped on a scene's heading goes to the start of that scene` (line 225): the frame isn't SC 02's first
  after the drop (`drag` scrolls the heading into view, then the frame, and drops on where the heading then is).
- `a frame stays in a scene whose numbers are locked, and the board says why` (line 262): `wellInView` again.

The main session's guess, not checked: Playwright's headless Chromium hides scroll bars (0 px wide), so the app
treats them as overlaying and keeps the 16 px lane; the board is 16 px narrower, SC 01's frames take another row, and
SC 01's second frame and SC 02 end up farther apart than the board's scroll area can show at once.

The same checkpoint's Mac job (WebKit, the whole suite: 639 passed, 5 failed, each twice) failed the same three
reorder tests and two more, both in what #222 changes; Linux passed both:

- `e2e/planLayers.spec.ts:324` "each layer is one line where its name fits and wraps where it doesn't, never cut off;
  every row shows without scrolling", at line 354: `expect(all && mine && Math.abs(all.y - mine.y) < 1).toBe(true)`
  after the tile is set to 170 px ("a longer name keeps its line, whole, and the controls go onto the line below
  it"): the header's All and Mine buttons are not on one line in WebKit.
- `e2e/presets.spec.ts:107` "a preset saved from the Settings header, applied after a change back, and Before it
  applied to go back", at line 125: `await expect(name).toBeFocused()`: the Save preset dialog's Name field has the
  value "Preset 1" but not the focus ("inactive"). #222 adds `useScrollLane` to `InAppWindow`'s body and changes
  `SettingsWindow.tsx`; nov20-e (without #222) passed this test on the Mac.

Neither can be run in WebKit here (Playwright's Windows WebKit lacks what Safari has). Find the cause by reading the
code and by running both specs in Chromium here; if a change of yours is aimed at a WebKit-only behaviour, say exactly
which behaviour and why you're sure, so the next Mac run can confirm it.

## What to do

1. Reproduce on this PC first, on this branch: `npx playwright test e2e/reorder.spec.ts --project=chromium
   --workers=4`. Then find out why each fails (the columns and rows of the board in that window with and without the
   lane, the scroll area's height, where the drop point lands). Report what you find before you change anything that
   isn't plainly one of the two cases below.
2. If the app is right and only the tests' geometry changed (the guess above): give these tests the room they had,
   through the spec's own setup (for example the window size its tests open with, or the board's frame size that the
   app already offers), so every assertion stays exactly as it is. No assertion changes, no skip, no longer timeout.
   Say why that setup is honest: the tests are about where a frame lands, not about the window size.
3. If the app is wrong (a drop target under the lane, a heading or well that no longer takes a drop near its edge, a
   lane where nothing scrolls): fix the app, and add a test that would have caught it.
4. Then run every spec that drags on the board or depends on its columns, to be sure nothing else moved: at least
   `e2e/reorder.spec.ts`, `e2e/scrollLane.spec.ts`, `e2e/planLayers.spec.ts`, `e2e/presets.spec.ts` and any spec you
   find that drags frames (search `e2e/` for the board's drag helpers), `--project=chromium --workers=4`.

The branch has `v2` merged into it by the main session before you start (four PRs merged after nov20-f); don't merge
anything yourself.

## Rules

Any change to an existing test file goes in your report line by line (file, test, old, new) with its reason. An
assertion that would have to change: stop and report. Logs under `test-results/scroll-lane/`. Never start a command
with `python`. Nothing fetched through npx. No new dependency. Don't touch `e2e/visual.spec.ts` or any baseline
picture (say if you think one should change), CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; unit tests of anything you change in `src`
(`node test-results/build627b/vitestUpper.cjs <folders>`); the end-to-end specs in step 4, alone, counts read from
the output.

## Report back

What you found for each of the three tests (with the numbers); what you changed and why; every changed line in an
existing test; each check's output line with counts.
