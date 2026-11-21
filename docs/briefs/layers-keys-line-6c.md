# Brief: the scroll lane, round 6c (#222): what the review of rounds 6 and 6b found

Work in the repo folder on branch `fix/scroll-lane` (the main session checks it out for you; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/layers-keys-line-6.md`
and `-6b.md` on this branch first, then `src/ui/scrollLane.ts` whole.

Round 6b's rule stays: the lane is on only when the content overflows without it, decided by whether the scroll bar
overlays, never by the system's name. A review found the way it measures that has costs. Keep the rule; change how
and when it measures.

## 1. The measurement must not move anything inside the tile (medium)

`overflowWithoutLane` takes the lane's attribute off, reads the size and puts it back in one task, restoring only the
host's own scroll position. With the lane off, everything inside is laid out 16 px wider, and both engines clamp each
nested scroll area's offset at the end of that layout; when the lane goes back on, those offsets stay clamped. So a
Shot list table (`overflow-x-auto`, StoryboardView.tsx) scrolled fully right loses its last 16 px each time the
board's content changes size, and a text field or nested list scrolled to its end can lose its caret or lines.

- Keep the scroll positions of everything inside that has been scrolled, and put them back after a reading: for
  example a capture-phase `scroll` listener on the host keeps the elements under it whose offset isn't zero (scroll
  events don't bubble but are seen in capture), and the reading restores only those that moved. No walk of the whole
  subtree.
- An end-to-end test (Chromium, where the lane applies headless): the Shot list with enough custom fields to scroll
  sideways and enough frames for the tile to scroll, the table scrolled fully right, then a frame added: its
  `scrollLeft` is still the maximum two frames later. It must fail on round 6b's code.

## 2. Measure without the lane only when it can change the answer, and once a resize has settled (medium-low)

Today every measure with the lane on costs two extra layouts of the whole host, on every resize of the host or its
children: a splitter drag or the Dock's 180 ms grow transition re-lays a big board three times per frame.

- With the lane on, a change of content alone is decided as before 6b (with the lane on: still overflowing keeps it,
  fitting drops it); the reading without the lane runs only after the host's own box has changed size, and only once
  that size has held for a frame (a drag or a transition takes one reading at its end, not one per frame).
- Show the cost: with a board of 300 frames in headless Chromium, the layout count and duration (CDP
  `Performance.getMetrics`, `LayoutCount`, `LayoutDuration`) around a 30-step splitter drag, on round 6b and after.
- This also removes a reading during a person's scroll (the review's third finding): say whether any reading can
  still happen during a scroll, and if one can, that it writes no scroll position unless something was clamped.

## 3. The Layers tile's outline at every pixel ratio (low)

Round 6b's `-mt-px -mb-[2px] self-start` on the Shown/Dimmed/Hidden group fits the line in WebKit, but at 2x (a Mac,
Windows at 200%) the outline sits 1 px above the row and 2 px below it, and its cells half a pixel below the lock and
Solo; at 1.5x (Windows laptops) 1 px above and 1.67 below. The review's suggestion: margins equal to the rule's width,
`-my-[1.5px]`, and the run's `items-center` (drop `self-start`): centred, the border box starts at exactly minus the
border's width, so the cells sit at 0 to 24 at every ratio and the outline is even, and at 1x it draws the same pixels
as before. Your first try in 6b was a symmetric margin that pushed the outline into the name's line in WebKit; say
whether that try kept `self-start`. Try the suggestion, measure at 1x (Chromium) and 2x (WebKit on Windows: Desktop
Safari's device scale factor is 2), and keep whichever passes every planLayers test with the outline even. Report the
numbers.

## 4. Tests that test what they say (low)

In `src/ui/scrollLane.test.ts`, two of 6b's tests pass on the old logic too: "takes no lane where the content fits
without it, though the lane would make it overflow" never starts with the lane on, and "never flips at the boundary"
uses a height that can't flip under either rule. Make each start from the state that shows its point (the lane on;
content that changes with the lane), so each fails on the code before 6b, and add a test of the hold with content
that answers the lane a measure later (as the keys line does). Changing these two is allowed: they are 6b's own.

## Known and left as is (say so in your report)

Tiles that choose their layout in code from their width (Gear, People, Locations, Days: side by side from 520 px)
can keep the lane in a 16 px band after a widening, because the reading without the lane still sees the stacked
layout. Not a flip-flop; leave it.

## Rules

No assertion from before #222 changes. Don't touch `e2e/visual.spec.ts` or any baseline (say if you expect one to
change), CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No new dependency. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/ui
src/features/birdseye src/features/storyboard`; end to end, alone, counts read from the output: in Chromium
`e2e/planLayers.spec.ts e2e/scrollLane.spec.ts e2e/presets.spec.ts e2e/reorder.spec.ts e2e/storyboard.spec.ts
e2e/visual.spec.ts`, and in WebKit on Windows `e2e/planLayers.spec.ts e2e/scrollLane.spec.ts e2e/presets.spec.ts`
(`--project=webkit`), `--workers=4`. Logs under `test-results/scroll-lane/` (names ending `-r6c`). Never start a
command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed and the numbers asked for; each new or changed test's name and result; each
check's output line with counts.
