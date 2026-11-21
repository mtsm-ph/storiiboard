# Brief: the Layers tile, round 5: the Spanish test checks the Spanish tile (#222; Nov 20)

Branch `fix/scroll-lane` (checked out, clean; don't switch). Never commit, push or merge.

Round 4 found that the existing test `e2e/planLayers.spec.ts` › "in Spanish at 1280 × 720 no layer's name is cut
off" finds the tile by its English region name ("Layers") while the app is in Spanish (the region is "Capas"), so it
probably reads no rows and passes without checking any. With the scroll lane now taking room in narrow tiles, that is
the check that matters most in Spanish.

**This brief asks for one change to that existing test:** make it find the tile in Spanish (by its Spanish name, or
by a stable attribute the tile already carries; don't add one to the app unless there is none, and then say so), and
check first that it reads all 8 rows. Every other assertion in it stays as it is. Then run it:

- if it passes, done;
- if a name is cut off in Spanish, stop and report which row and the numbers (don't change the app in this round).

No other change.

## Checks

`npx tsc --noEmit`; `npx eslint e2e/planLayers.spec.ts`; `npx playwright test e2e/planLayers.spec.ts
--project=chromium --workers=4` alone, counts read from the output. Logs under `test-results/layers-keys-line/`.
Never start a command with `python`. Nothing fetched through npx.

## Report back

How the test now finds the tile; that it reads 8 rows; its result; the run's counts.
