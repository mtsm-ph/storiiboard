# Brief: the Layers tile's keys line, round 2: a test that states what holds in each language (#222; Nov 20)

Branch `fix/scroll-lane` (checked out, with round 1's uncommitted work in it: keep it). Never commit, push or merge.

Round 1 stopped at the brief's stop rule, rightly: in Spanish at the default size the tile overflows even with the
keys line hidden (the two buttons no longer share a line, +30 px; two rows wrap with the lane), so the Spanish half
of the new test "at the default size the keys line is not shown and the tile neither scrolls nor takes a lane, in
English and in Spanish" fails. How Spanish should fit is Kevin's to decide; until he does, the tests say exactly
what holds now, and nothing that doesn't.

## Change only that one new test (round 1's own, never committed)

Split it in two:

1. **English, at the default size:** the keys line is not shown, the body doesn't scroll, no lane, and the list's
   description carries the line's words. (As round 1's English half.)
2. **Spanish, at the default size:** Kevin's two rules for the line, which hold:
   - it is not shown and takes no room (the body's content ends at the list's bottom plus the tile's padding: the
     hidden copy adds nothing to `scrollHeight`);
   - it is never cut off (not partly visible), and the list's description carries its words.
   Do **not** assert that the Spanish body doesn't scroll or has no lane. Put a comment above it saying why, in two
   lines: in Spanish the buttons and the wrapped rows overflow the default size by themselves (the numbers from round
   1: content 431 in a body of 376 with the lane, 415 without), and how that should fit waits for Kevin.

Every other test of round 1 stays as it is. No existing test or assertion changes.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `npx playwright test e2e/planLayers.spec.ts
e2e/scrollLane.spec.ts --project=chromium --workers=4` alone, counts read from the output. Logs under
`test-results/layers-keys-line/`. Never start a command with `python`. Nothing fetched through npx.

## Report back

The two tests' names and results; the run's counts.
