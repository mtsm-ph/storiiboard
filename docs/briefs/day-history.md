# Brief: a shoot day's own history (Kevin, Nov 18; item 8's fourth piece)

Work in the repo folder on the branch the main session checks out for you (`feat/day-history`, stacked on Ctrl+S,
#244; don't switch). You write code and tests and run the checks below. You never commit, push or merge. Read
CLAUDE.md (History, Notifications, Shoot days, Calendar) first, then `src/features/history/HistoryTile.tsx` (its "Only
…" filter for the selected frame, scene or note), `ItemHistory.tsx`, `steps.ts` (`loadSteps`, `describeSteps`,
`readItemLog`, `moreItemLog`, `opsSince`), the Shoot days tile and the Calendar (`src/features/schedule`).

## What Kevin decided (his plan, Nov 18, word for word)

"Only a view; nothing stored. It reads the op log for the day record, its call sheet, and every frame whose
`shoot_day_id` is or was that day (in an op's before or after), so frames that left the day stay in its history
("Moved 4A to shoot day Nov 25"). Opened from the day in the Calendar and Shoot days, as an item's history opens
today."

## What to build

- **The reader** (in `steps.ts` or beside it): the steps that touched one day: ops on the day record itself, on its
  call sheet records (under the day: by `parent_id` in the op's before or after, so a call sheet since trashed or
  purged still counts where the log still says so), and on any record whose `shoot_day_id` was that day in the op's
  `before` or `after`. Grouped by step; undos, redos and restores of those steps included, as History shows them. Read
  once when opened and then only what's new (as `moreItemLog` does with `opsSince`), never the whole log after every
  edit. Say what one opening costs on a long log and what each later edit costs.
- **The lines**: each step's line exactly as History words it (`describeSteps`), so a frame moved off the day reads
  "Moved 4A to shoot day Wed, Nov 25" in both days' histories. Who and when as the main feed shows them. No Put back
  (it's a view; each frame keeps its own History for that).
- **Where it opens**: find how an item's own history opens today (the History tile's "Only …" filter for the
  selected item, and any control that opens it), and open a day's the same way, from the day in the Calendar and
  from the day in Shoot days. The filter names the day by its date, as History does ("Only shoot day Mon, Nov 16").
  If a day can't be "selected" today, add the smallest way that fits how those tiles already work, and say what you
  chose.
- Every word through `t()` / `tn()` in en and es (Spanish in the file's own voice); list them in your report.

## Tests

- Unit: the reader finds the day's own edits, its call sheet's, a frame scheduled on it, a frame moved off it to
  another day (in both days), a whole scene scheduled, an undo and a redo of each, a frame since trashed, a call sheet
  since deleted for good; it never returns steps that touched no part of the day; the "only what's new" read gives
  the same steps as a fresh read.
- End to end (`e2e/dayHistory.spec.ts`, Chromium; it also runs in WebKit on a Mac, so nothing engine-specific): schedule
  a frame on a day, move it to another day, open the first day's history from Shoot days and from the Calendar: both
  steps are there with History's words; the other day's history shows the second step only.
- No existing assertion changes.

## Rules

Nothing stored changes (no table, column, record type or prop). Don't touch undo and redo, History's own lines,
`e2e/visual.spec.ts` and every baseline (say if you expect one to change), CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md,
`.github`, `.claude`. No new dependency. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs
src/features/history src/features/schedule src/features/notifications src/core/i18n`; end to end, alone, counts read
from the output: `e2e/dayHistory.spec.ts e2e/history.spec.ts` and the Shoot days and Calendar specs you touch,
`--project=chromium --workers=4`. Logs under `test-results/day-history/`. Never start a command with `python`. Nothing
fetched through npx.

## Report back

Where it opens and how it reads (with the costs); the new words in en and es; each new test's name and result; each
check's output line with counts; any screenshot you expect to change.
