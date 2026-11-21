# Brief: the Layers tile, round 4: a row's controls never run past it (#222; Nov 20)

Branch `fix/scroll-lane` (checked out, rounds 1 to 3 uncommitted in it: keep them). Never commit, push or merge.

## Why

Round 3 found the real cause of the failing existing test ("each layer is one line where its name fits and wraps
where it doesn't, never cut off; every row shows without scrolling"): at 170 px wide the body scrolls, the lane takes
16 px, and each layer row (about 136 px) is narrower than its controls on their line below the name (count, the
three-way show control, Lock and Solo: about 141 px). Solo ends about 5 px past the row's edge. Only the quick read
before the lane arrived let the test pass before.

The tile's own rule (6.8 second review, L7, Kevin's): "a row is one line wherever its name fits beside its controls;
where it doesn't, in any language, the name keeps the first line, whole, and the controls go onto the line below at
the right, never cut short." It now applies one step further: **where the controls don't fit on the line below
either, they wrap again**, so nothing is ever cut short or runs past the row, at any width the tile can be given.

## What to build (`src/features/birdseye/plan/LayersTile.tsx`, and its styles)

- The controls group of a layer row (and of the underlay row) may wrap onto further lines, at the right, keeping its
  order: the count and the three-way show control first, then Lock and Solo. A group never splits inside the
  three-way show control.
- Where things already fit, nothing changes: at the default size in English every row is exactly as it is now (rows
  of 24 and 40 px as round 1 measured, Grip on one line); in Spanish the same as round 2 measured. Check this with
  the numbers, before and after.
- No gap or size made smaller; no control hidden; nothing new on screen; no new words.
- Nothing about the lane, the keys line or the scroll bar changes.

## Tests

- The existing test above must now pass, with round 3's settle-wait, every assertion unchanged.
- Add: at 150 px and at 130 px (squeezed the same way the existing test does, then settled), every row is whole, its
  name first, its controls inside the row (no box past the row's right edge), in English and in Spanish.
- Round 3's no-swing test still passes.

## Checks

`npx tsc --noEmit`; `npx eslint` on touched files; `node test-results/build627b/vitestUpper.cjs src/features/birdseye`;
`npx playwright test e2e/planLayers.spec.ts e2e/scrollLane.spec.ts --project=chromium --workers=4 --repeat-each=3`
alone, counts read from the output. Logs under `test-results/layers-keys-line/`. Never start a command with `python`.
Nothing fetched through npx.

## Report back

What changed; the row heights at the default size, English and Spanish, before and after (they must match); each new
test's name and result; the repeat run's counts; every test that failed on the way, by name.
