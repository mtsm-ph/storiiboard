# Brief: the scroll lane, round 6d (#222): what the review of round 6c found

Work in the repo folder on branch `fix/scroll-lane` (the main session checks it out for you; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/layers-keys-line-6c.md`
on this branch, then `src/ui/scrollLane.ts`, `src/ui/scrollLane.test.ts` and `e2e/scrollLane.spec.ts` whole.

The rules stand: the lane is on only where the content overflows without it, by whether the bar overlays; a reading
without the lane moves nothing a person sees; the reading runs once a resize holds. The review found 6c right in how
it restores and when it reads, with these gaps.

## 1. A host inside another must not move the outer one (medium-low)

The Shot list's table scroller is a lane host (`useScrollLane(table)`, `overflow-x-auto`, auto height, in
StoryboardView.tsx) inside the board's tile body, another lane host. Scrolling sideways, it takes the `x` lane
(`padding-bottom: 16px`), which with auto height is part of its box, so the board body's content is 16 px taller. A
frame after the table's box changes (a row added, trashed or re-wrapped; any resize), it reads without its lane, drops
16 px, the board body's `scrollHeight` drops and the browser clamps the body's `scrollTop`; nothing puts it back, so a
board scrolled to its very bottom ends 16 px short and stays there. The same reading also costs the table two big
layouts on every row change (for a content-sized host, a content change is a box change).

- A reading without the lane only toggles what can change its answer. The `x` lane's bottom padding never changes
  sideways overflow, so an `x`-only lane is decided from the reading with it on (no toggle, no clamp, no cost); and a
  reading for the `y` answer must not take away the `x` padding if that changes the host's own box height (account for
  the padding by arithmetic instead). Say exactly what the reading now toggles in each case.
- If any toggle can still change the host's own box, also keep and put back the positions of its scrolling
  ancestors (walk up the parents: O(depth)), the same way as the areas inside.
- An end-to-end test (Chromium): Shot list wide enough to scroll sideways and long enough for the board to scroll; the
  board scrolled to its very bottom and the table scrolled fully right; then change the table's content size (a frame
  trashed, or a row's text changed so it wraps): the board is still at its bottom and the table still fully right,
  4 to 6 frames later. It must fail on 6c's code.

## 2. Content that shrinks while the lane is on (low)

6c reads a change of content alone with the lane on, so content that fits without the lane but overflows with it keeps
the lane until the host's box next changes. On the storyboard grid (`repeat(auto-fill, minmax(176px, 1fr))`) the lane's
16 px can take away a whole column, so trashing frames, moving frames out of the last scene, or switching from Shot
list to Grid with the lane on leaves one column fewer than the width allows, plus a scroll bar, possibly for the whole
session. Only a shrink can make that latch: after a change of content alone that makes `scrollHeight` (or
`scrollWidth`, for the `x` lane) smaller while the lane is on, take one reading without the lane once it holds for a
frame, as for a box change. Growing content and drags cost nothing more. A unit test of the band (content 380 without
the lane, 420 with it, in a 400 box): a shrink into the band drops the lane after one held frame; a growth into it
keeps it.

## 3. The tests (low)

- 6b's "leaves the scroll position where it was after reading the content without the lane" is vacuous under 6c (its
  `s.resize()` doesn't change the box, so no reading happens): make it change the box and assert that one reading
  happened (allowed: it is this PR's own test).
- The third 6b test 6c changed ("takes the lane while the content overflows without it, and drops it once the content
  fits without it") now proves it only after a change of size: rename it to say so; item 2's test pins the content
  case.
- `e2e/scrollLane.spec.ts`'s round-6c test patches `focus()` with `preventScroll` and clicks with `dispatchEvent`, a
  flow no person meets. Replace it with one a person does, with no patch: the table scrolled fully right, then a
  frame's Action edited in the Inspector so its row wraps or unwraps (focus stays in the Inspector): `scrollLeft` stays
  at its maximum. Wait 4 to 6 frames before reading, not 2. In its resize half, prove that a reading without the lane
  happened (for example a MutationObserver counting the lane attribute's changes), so it can't pass with no reading.

## 4. The set of scrolled areas (low)

- It keeps elements that left the page until the next reading: prune those no longer connected in `measure` (or once
  the set passes a small size), so a tile that never resizes doesn't keep every textarea it ever saw.
- Check, in Chromium and in WebKit on Windows, whether a long text `<input>` scrolled to its end fires `scroll`
  (capture on an ancestor sees it). If an engine doesn't, say so and how a focused input's position is then kept
  (reading `document.activeElement`'s `scrollLeft` when it is inside the host is enough).

## Rules

No assertion from before #222 changes. Don't touch `e2e/visual.spec.ts` or any baseline (say if you expect one to
change), CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No new dependency. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/ui
src/features/birdseye src/features/storyboard`; end to end, alone, counts read from the output: in Chromium
`e2e/planLayers.spec.ts e2e/scrollLane.spec.ts e2e/presets.spec.ts e2e/reorder.spec.ts e2e/storyboard.spec.ts
e2e/visual.spec.ts`, and in WebKit on Windows `e2e/planLayers.spec.ts e2e/scrollLane.spec.ts e2e/presets.spec.ts`
(`--project=webkit`), `--workers=4`. Logs under `test-results/scroll-lane/` (names ending `-r6d`). Never start a
command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; each new or changed test's name and result (and that the new end-to-end
test fails on 6c); each check's output line with counts.
