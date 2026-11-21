# Brief: no section while a project opens, round 3: engine-proof test, two small fixes (6.27u, #231; Nov 20)

Branch `fix/section-while-opening` (checked out; don't switch). Never commit, push or merge. Small.

The review of round 2 found nothing high or medium. Before a checkpoint that runs the whole suite in WebKit too:

1. **The focus test assumes Chromium's behaviour.** "focus on a sidebar row while a sync reopen runs comes back to
   that row once it is open" asserts the row is not focused during the open, because Chromium drops focus from a
   button the moment it is disabled. WebKit may keep it, and then the test fails though the app is right (focus never
   left the row). Make the test check what matters in both engines: once the open ends, the row has focus. During
   the open, read whether it lost focus; only in Chromium (`testInfo.project.name` or `browserName`) assert that it
   did, so the restore is what brought it back there. Say in a comment why.
2. **`src/app/shell/sidebar/openingFocus.ts` can keep a stale entry or lose the one it noted** when the count goes
   0 → 1 → 0 before React commits `opening = true` (a fast failing open), or a second open begins before React
   commits the end of the first:
   - take a new entry only while none is held;
   - let the restore act only when `opening` itself went from true to false (keep its last value in a ref), never
     on a change of the current section alone;
   - clear the held entry whenever an open ends with no restore to do.
   Add a unit test for the helper's rules if the hook's logic can be pulled into a pure function; else say why not.
3. **A comment that overstates.** In "no scene or board row can be chosen while another project opens in place…",
   the step that presses during the open and releases after chooses nothing on round 1's code too (the release lands
   in the list's empty space). Keep the step, and say in its comment that the `toBeDisabled` checks and the Enter
   check are what fail on round 1.

No other change. No existing assertion outside this PR's own tests changes.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/app`;
`npx playwright test e2e/projects.spec.ts e2e/planLayers.spec.ts e2e/sidebar.spec.ts --project=chromium --workers=4`
alone, counts from the output. Logs under `test-results/section-while-opening/`. Never start a command with `python`.
Nothing fetched through npx.

## Report back

What changed per point; any new test's name; each check's output line with counts.
