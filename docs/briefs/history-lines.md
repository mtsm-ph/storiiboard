# Brief: History lines that name what changed and where (Kevin, Nov 18; item 8's first piece, Nov 20)

Work in the repo folder on branch `feat/history-lines` (already checked out, made from `v2`; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read CLAUDE.md's Workflow and Safety
sections, and its paragraphs on History and Notifications.

## Why

History, the notifications and (soon) the Undo and Redo buttons' names all read the same one-line summary of a step
(`src/features/history/summary.ts`, words in `src/core/i18n/locales/en.ts` and `es.ts`). Several lines don't say what
changed or where. Kevin (Nov 18): "Every line names what changed and where, the seven in the table included." The
Undo and Redo buttons (next) show "Undo: <this line>", so it has to be right first.

## The seven lines (what they say today, when, and what they must say)

| Line today | When | Must say |
|---|---|---|
| "Moved {name}" (`history.moved`) | one frame, scene, note or page dragged to a new place | where to: "Moved 4A to after 3C", "Moved 4A to scene 12" (to the start of a scene: "to the start of scene 12") |
| "Moved {n} items" (`history.movedCount`) | several moved together | what and where: "Moved 3 frames to after 3C", "Moved 2 scenes to after scene 4"; mixed kinds: "Moved 3 items to after 3C" |
| "Moved an item, since deleted for good" | a move whose record was purged | stays as it is |
| "Changed {n} items" (`history.changedCount`) | several records edited in one step | the kind of change and the scene: a renumber "Renumbered scene 12's shots", a lock "Locked scene 12's shot numbers", mixed edits of one field "Changed the lens of 3 frames in scene 12"; otherwise "Changed {n} items in scene 12" when all in one scene |
| "{n} changes" (`history.changes`) | the last fallback | what it can name: the kinds and the place ("3 changes in scene 12"); stays the fallback |
| "Moved {n} frames to shoot day {day}" | a scene scheduled at once | "Moved scene 12 to Day 3" when they are all of one scene and all of it; else as today |
| "Undid: a step" / "Restored the project to: an earlier step" | the target step is older than the loaded page of History | the target's own title, read from the log even when it isn't on the page |
| "{who}: {field} {before} → {after}" | one field | in the main feed, with the item's name first: "4A: Lens 35 → 50 mm"; in an item's own History (filtered to it) as today |

Read `summary.ts` and its tests first: the exact keys, how a step's ops are grouped, how names are made (a frame's
shot number, a scene's number and heading as the board shows them, a note's start), and how lengths and lenses are
formatted (the plan's unit, `mm`). Use the app's own names and number formats; don't invent new ones.

## Rules

- Every word through `t()` / `tn()` in en **and** es, plurals with `tn`. Spanish in the file's existing voice (look
  at the neighbouring `history.*` lines): write the Spanish yourself and list every new line in both languages in your
  report, for Kevin to read.
- A name is read from the records as they were at that step when the step still has them; a record since deleted
  for good keeps today's fallback words.
- Trashed records: say "in the Trash" where today's lines do; don't change that rule.
- Lines must stay short: one line in the History tile at its default width in English (check the longest you can
  make in a test with a long scene heading: truncate the heading as the board does, never the verb).
- No change to what is stored: summaries are worked out from the log as today.

## Tests

- One unit test per line shape in the table (and per variant: one frame, several, mixed kinds, to the start of a
  scene, the scheduled scene, the older target of an undo or restore, the item's name in the main feed and not in its
  own History), in English and in Spanish.
- Every existing test of `summary.ts` and History that states today's words: list each. The words of the seven lines
  above change by this brief; those expectations change with them, and only those. Any other existing assertion
  that would have to change: stop and report.
- One end-to-end test in the History spec: drag a frame after another and the History tile shows "Moved 4A to after
  3C" (with the right numbers), then undo it and the line reads "Undid: Moved 4A to after 3C".

## Checks

- `npx tsc --noEmit`, `npx eslint` on the touched files.
- Unit: `node test-results/build627b/vitestUpper.cjs src/features/history src/core/i18n src/features/notifications`
  (this shell's lower-case drive letter makes plain Vitest fail every file; that helper runs it from `C:\`).
- End to end, alone, counts read from the output: the History spec and the notifications spec,
  `--project=chromium --workers=4`.
- Logs under `test-results/history-lines/`.

## Don't touch

The op log, what is stored, Undo and Redo themselves, `e2e/visual.spec.ts` (History isn't in its pictures; if you
find it is, stop and say so), CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No new dependency. No
prettier. Never start a command with `python`. Nothing fetched through npx.

## Report back

Each of the seven lines before and after, in English and Spanish, with an example; every changed existing expectation
(file, test, old, new); each new test's name and result; each check's output line with counts.
