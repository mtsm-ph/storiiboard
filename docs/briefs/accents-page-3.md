# Brief: the accents step, round 3: pin the stage half of "the same" (6.27r, #229; Nov 20)

Branch `fix/accents-page` (checked out; don't switch). Never commit, push or merge. Tests only, in
`src/app/launchCheck/launchCheck.test.ts`.

The review of round 2 found nothing high or medium. One gap: the note says "the worker asked again: the same" only
when the second answer has the same words **and** the same stage as the first, but no test has the same words at a
different stage or with no stage, so a version that compared the words alone would pass every test.

Add, in "accents passed by the page (6.27r)", for each first stage of canvas, draw and read:

- the second ask fails with the same words at another of the three stages: the note writes it out,
  `the worker asked again: <words> (worker: <that other stage>)`;
- the second ask fails with the same words and no stage: `the worker asked again: <words> (worker: no stage)`.

Check each new case fails if `askAgain` compares only the words (try it for a moment, then put the code back).

No other change. No existing assertion changes.

## Checks

`npx tsc --noEmit`; `npx eslint src/app/launchCheck`; `node test-results/build627b/vitestUpper.cjs
src/app/launchCheck`. Logs under `test-results/accents-page/`. Never start a command with `python`. Nothing fetched
through npx.

## Report back

The new cases' names, whether each fails on the words-only version, the unit run's counts.
