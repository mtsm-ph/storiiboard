# Brief: + New person, round 3: two tests made sure on a busy machine, one focus case (6.27t, #230; Nov 20)

Branch `fix/new-person-focus` (checked out; don't switch). Never commit, push or merge. Small: tests in
`e2e/people.spec.ts`, one line in `src/features/people/PeopleTile.tsx`.

The review of round 2 found nothing high or medium. Three points matter before a checkpoint, because CI runs the
suite at one worker per core on a two- to four-core machine:

1. **The two failing-create tests race their own delay.** "Delete pressed on a person still being made whose create
   fails…" and "This is me pressed on a person still being made whose create fails…" must press their button inside
   `slowEdits(page, 500, true)`'s 500 ms. On a loaded machine the press can come after the failure, when Ana is
   selected again: Delete would then trash Ana, This is me would turn Ana off. Give both a delay of 2000 ms (nothing
   in them depends on its length). If the spec can tell that the stand-in is still there just before the press, add
   that check, so a late press fails with a clear message instead of acting on Ana.
2. **The slow-save test's check for a late fourth create waits 1000 ms for a delay of 800 ms.** On a slow machine it
   can miss what it guards. After its poll sees 3 edits, queue one more edit through the store that changes nothing
   and wait for it to land (the queue is serial, so a stray create would land before it), then check the count is
   still 3. If the store gives no way to queue an empty edit from the page, wait 2 × 800 ms instead and say so.
3. **Focus on the stand-in's own list row.** On a failed create, focus moves to + New person only when it is on the
   body or in the stand-in's editor. If it is on the stand-in's row in the list (`[data-person-id="<id>"]`), the row
   goes and focus drops to the body. Accept that row too. Add one test: slow failing save, focus the "Unnamed person"
   row, the create fails, focus is on + New person.

No other change. No existing assertion outside this PR's own tests changes.

## Checks

`npx tsc --noEmit`; `npx eslint src/features/people e2e/people.spec.ts`; `npx playwright test e2e/people.spec.ts
--project=chromium --workers=4 --repeat-each=5` alone, counts read from the output. Logs under
`test-results/new-person-focus/`. Never start a command with `python`. Nothing fetched through npx.

## Report back

What changed per point; the new test's name; the repeat run's counts.
