# Brief: themes.spec, one axe test per accent (Kevin, Nov 20)

Work in the repo folder on branch `test/themes-per-accent` (already checked out; don't switch). You change one test
file and run the checks below. You never commit, push or merge.

## Goal

`e2e/themes.spec.ts` › "every family’s theme passes axe on the board, light and dark" runs axe 28 times in one test
(14 accents, light and dark) under its own 120 s limit. On checkpoint nov20-c (Linux, Chromium, one worker per
core) the first try ran past 120 s and the retry took 1.8 minutes: flaky, and near its limit even when it passes.

Kevin, Nov 20, his words:

> themes.spec, "every family's theme passes axe…": one test per accent, the same checks, so none runs near its
> limit. No longer limit and no fewer workers.

## What to build

Only `e2e/themes.spec.ts` changes.

- Replace that one test with one test per entry of `FIXTURES`, made in a loop at the top level of the file. This
  brief asks for that change to an existing test; it is the only one.
- Each test does exactly what one turn of the present loop does, for its accent: waits for the fonts, then for
  `light` and for `dark` applies the theme with `applyTheme` and runs axe with the same tags
  (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`), collects the same failure detail (accent, mode, family,
  rules with their targets) and expects none.
- No `test.setTimeout` in these tests: each keeps the project's ordinary limit (60 s on CI, 30 s here). Don't
  change `playwright.config.ts`, the workers or any limit.
- Titles: each test's title names its accent so a report says which one failed, and no two are alike. Give
  `FIXTURES` a name beside each value (the names are already there as comments: Paper, Rose, Clay, Ochre, Sand,
  Olive, Sage, Teal, Slate, Navy, Violet, Plum, grey, neon) and title each test, for example,
  `the Rose theme passes axe on the board, light and dark`. Keep the comment that says what the list is.
- The `beforeEach`, `applyTheme` and the Web Worker test stay as they are.

## Checks to run

- `npx tsc --noEmit`
- `npx eslint e2e/themes.spec.ts`
- This spec only, alone (nothing else running, no edits meanwhile):
  `npx playwright test e2e/themes.spec.ts --project=chromium --workers=4`. Read the passed and failed counts from
  the output, not the exit code. Expect 15 tests (14 accents and the Web Worker test).
- From that run's output, report the slowest of the 14 and how long it took (`--reporter=list` prints each test's
  time), so it can be said how far each is from its limit.
- Logs go under `test-results/themes-per-accent/`.

## Don't touch

- Anything but `e2e/themes.spec.ts`. No new dependency, no prettier, single quotes, about 120 columns.
- Never start a command with `python`. Nothing fetched through npx.

## Report back

The new titles, the passed and failed counts, the slowest test's time, and anything that failed on the way, by name.
