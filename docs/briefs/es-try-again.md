# Brief: Spanish says "try again" one way (Kevin, Nov 20)

Work in the repo folder on branch `polish/es-try-again` (already checked out, made from `v2`; don't switch). You
change Spanish strings and the tests that state them, and run the checks below. You never commit, push or merge.

## The rule (Kevin, Nov 20, his words)

> Spanish says "try again" three ways. Wherever the English is "Try again", the Spanish is "Vuelve a intentarlo"
> (lower case inside a sentence). If a screenshot shows one, tell me first.

## What to do

Files: `src/core/i18n/locales/es.ts`, and tests that state those Spanish words.

1. List every key whose English value in `en.ts` holds "try again" in any case ("Try again", "try again", "Try
   again later", a button's "Try again"). A first count found 11 keys; make your own list, not from this number.
2. For each, the Spanish says it as "Vuelve a intentarlo": with a capital V where it starts a sentence or is a
   button's whole label, "vuelve a intentarlo" inside a sentence. Keep the rest of each Spanish line as it is: only
   the words for "try again" change. Where the English continues ("Try again in a moment", "Try again, or convert it
   to JPEG first"), the Spanish keeps its own continuation ("Vuelve a intentarlo en un momento", "Vuelve a
   intentarlo, o conviértela primero a JPEG").
3. A line whose Spanish already says it that way doesn't change.
4. English doesn't change at all. A message that Rust or TypeScript writes in English is found in en.ts by its exact
   English, so nothing in Rust changes either.
5. **Screenshots first.** Before changing anything, read `e2e/visual.spec.ts` and say, for each key on your list,
   whether one of its Spanish baselines (`*-es*`) could show that line: it would have to be on the shell, the board
   with its inspector, or the Settings window as that spec opens them. If any could, stop and report which and why,
   and change nothing: Kevin sees it first. Notices and error messages that only appear after a failure are not on
   those screens.

## Tests

- Tests that state the old Spanish words change to the new ones: this brief asks for exactly that, for the keys on
  your list. List each changed expectation (file, line, old words, new words) in your report. No other assertion
  changes.
- Add one unit test beside the i18n tests: for every key whose English holds "try again" (any case), the Spanish
  holds "uelve a intentarlo". So the next line added can't drift.

## Checks to run

- `npx tsc --noEmit`, `npx eslint` on the touched files.
- Unit: `node test-results/build627b/vitestUpper.cjs` (the whole unit suite: this shell's lower-case drive letter
  makes plain Vitest fail every file; that helper runs it from `C:\`).
- End to end only for the specs whose expected Spanish you changed, alone, `--project=chromium --workers=4`, counts
  read from the output.
- Logs go under `test-results/es-try-again/`.

## Don't touch

- `en.ts`, Rust, any screen's code, `e2e/visual.spec.ts` and its snapshots, CLAUDE.md, docs/PLAN.md,
  docs/HANDOFF.md, `.github`, `.claude`.
- No prettier. Never start a command with `python`. Nothing fetched through npx.

## Report back

The list of keys with the Spanish before and after; the screenshot answer for each; each changed expectation; the
new test's name; each check's output line with counts.
