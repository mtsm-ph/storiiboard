# Brief: a shoot day's own history, round 2 (#245): what the review found

Work in the repo folder on branch `feat/day-history` (the main session checks it out for you, with #244's round 3
merged in; don't switch). You write code and tests and run the checks below. You never commit, push or merge. Read
`docs/briefs/day-history.md` (round 1, with Kevin's words) first, then `readDayLog`, `moreDayLog` in
`src/features/history/steps.ts`, `dayOpsSince`, `purgedSince` in `src/core/ops/ops.ts`, `historyDay.ts`,
`DayHistory.tsx`, the day filter in `HistoryTile.tsx`.

The review found the reader and the incremental read right for every case in round 1's list, and nothing high.

## 1. Everything that happened to the day's frames (the main session's decision)

Kevin: "It reads the op log for the day record, its call sheet, and every frame whose `shoot_day_id` is or was that
day". Round 1 read only the steps that changed a frame's `shoot_day_id`, plus writes that carried it, so a sketch on
1A (it writes only the stroke) is missing from Day 1's history while "Changed 1A's title" is there. Read it as Kevin
wrote it: for every frame whose `shoot_day_id` is or was the day, its whole log as the frame's own History reads it
(`frameOps` / `itemOps`: its writes, its strokes and its picture), plus the day and its call sheets as now. Its whole
log, including steps from before it was scheduled: a frame's history on the day is the frame's history. Unit tests: a
sketch on a frame of the day, a picture set, a field edited before the frame was scheduled; a frame never on the day
never appears.

## 2. The cost of opening (low-medium)

Each pass is a full scan of `ops` with up to four `json_extract` per op (stroke point arrays included), about four
times a frame's own History. Put a text pre-filter first, as `mediaInLog` does: `instr(o.before, ?) > 0 OR
instr(o.after, ?) > 0` with the day id (and, for the later passes, any of the ids found, through `json_each`), before
any `json_extract`. Measure an opening on a long log (the 300-item perf project's size, with a long sketch history) next
to `readItemLog` for one frame, before and after; report both. Correct the comment in `steps.ts` that says a later
read costs only what the new steps wrote: a record newly found under the day is read from the start.

## 3. Smaller (low)

- `moreDayLog`: take `through` before checking `purgedSince(known.through)`, so an Empty Trash landing between the two
  can't be skipped.
- Picking the frame, scene or note that is already selected must also let the day go ("the latest pick wins"): the
  select functions clear the history day themselves, or bump a pick counter the day store listens to. A test.
- The day store outlives its day and its project: clear it when its day is no longer a live record of the open
  project (trashed, deleted, another project), so undoing a trash or switching back never turns the filter on again
  by itself.
- Spanish: `history.dayStepsOf` gives "Pasos de el día de rodaje …": use "Pasos en {title}, del más reciente al más
  antiguo", as `history.changesTo` does ("Cambios en {title}, …").

Left as is (say so): no paging (as an item's own History); two days on one date share the switch's words (their
buttons say Day 1 and Day 2).

## Rules

No existing assertion changes; round 1's stay. Words through `t()` in en and es. Nothing stored changes. No new
dependency. Don't touch History's lines, `e2e/visual.spec.ts` and every baseline, CLAUDE.md, docs/PLAN.md,
docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs
src/features/history src/features/schedule src/features/notifications src/core/ops src/core/i18n`; end to end, alone,
counts read from the output: `e2e/dayHistory.spec.ts e2e/history.spec.ts e2e/shootDays.spec.ts e2e/calendar.spec.ts
e2e/callSheets.spec.ts e2e/decks.spec.ts --project=chromium --workers=4`. Logs under `test-results/day-history/`
(names ending `-r2`). Never start a command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed (item 2: the numbers); each new test's name and result; each check's output
line with counts.
