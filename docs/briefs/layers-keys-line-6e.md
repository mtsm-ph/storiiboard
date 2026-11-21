# Brief: the scroll lane, round 6e (#222): the small findings of the round-6d review

Work in the repo folder on branch `fix/scroll-lane` (the main session checks it out for you; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/layers-keys-line-6d.md`
on this branch, then `src/ui/scrollLane.ts`, `src/ui/scrollLane.test.ts` and `e2e/scrollLane.spec.ts` whole.

The review found round 6d right and nothing blocking; these are its small findings. Keep every rule as it is.

1. **A view switch can still latch the lane.** Shot list to Grid replaces the board body's children; when the grid
   with the lane is taller than the Shot list was, that is growth, so no reading happens, and the grid keeps a lane
   (one column fewer) it wouldn't need without it. Treat a change of the host's direct children (the `children`
   MutationObserver already there) like a shrink: one reading without the lane once the size holds a frame. A unit
   test (box 600; before the switch 620 with the lane; after it 670 with the lane, 450 without: the lane drops). Name
   in a comment the case left: frames moved between scenes so the rows without the lane fit while no observed box
   changes; it heals at the next box change.
2. **A wasted reading.** While the y lane is held at this box (`heldAt === box`), a reading can't change the answer;
   skip the shrink reading then (the Layers tile with its keys line held). A unit test that counts no reading there.
3. **WebKit's `scrollHeight` and padding.** The x lane's arithmetic assumes `scrollHeight` includes the scroller's
   bottom padding. Probe in Chromium and in WebKit on Windows: a `display:flex; flex-direction:column; height:100px;
   overflow:auto; padding-bottom:16px` box with a 150 px child, then the same with `display:block`; report each
   `scrollHeight` (166 means counted, 150 not). If an engine leaves it out for a kind of box a lane host uses
   (InAppWindow's body is a flex column; the strip a flex row), make the arithmetic right for it and test that.
4. **Tests.** The harness's `readings()` counts only a remove-then-set: also count a `both` reading (set `x`, then
   `both`). Add a `both` test with the host's own bottom padding 8 and the lane's 16: the attribute is `x` during the
   reading, never removed, and the y answer takes away 8, not 16. Write a comment in `scrollLane.ts` that the
   arithmetic assumes a border-box host whose own bottom padding doesn't change while its x lane is on.
5. **End-to-end timing.** In the round-6c test's resize half, wait for the lane attribute's change count with
   `expect.poll` before reading 5 frames later, so a slow viewport resize on the Mac can't fail it.

## Rules

No assertion from before #222 changes. Don't touch `e2e/visual.spec.ts` or any baseline, CLAUDE.md, docs/PLAN.md,
docs/HANDOFF.md, `.github`, `.claude`. No new dependency. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/ui
src/features/birdseye src/features/storyboard`; end to end, alone, counts read from the output: in Chromium
`e2e/planLayers.spec.ts e2e/scrollLane.spec.ts e2e/presets.spec.ts e2e/reorder.spec.ts e2e/storyboard.spec.ts
e2e/visual.spec.ts`, and in WebKit on Windows `e2e/planLayers.spec.ts e2e/scrollLane.spec.ts e2e/presets.spec.ts`
(`--project=webkit`), `--workers=4`. Logs under `test-results/scroll-lane/` (names ending `-r6e`). Never start a
command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed (item 3: the probe's numbers); each new or changed test's name and result;
each check's output line with counts.
