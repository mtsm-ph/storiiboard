# Brief: undoing from History, round 2 (#250): what the review found

Work in the repo folder on branch `feat/undo-outline` (the main session checks it out for you; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/undo-outline.md` (round 1,
with Kevin's plan and the approved format) first, then `bringBack` and `undoRun` in `src/core/ops/ops.ts` beside
`restoreTo` (its 1.26 guard, `keepNumbersUnique`, its `namedBy` rule), `board.ts` (`renumber`, `slatedWithOther`),
`src/features/history/undone.ts`, `HistoryTile.tsx`.

The review found one group in one transaction, the stacks, the format, the drivers, the JSON door and settling right.
Kevin's rule for Bring back stands: "takes back only that undo or restore … A later edit to the same field stays, and
the result names which". Whatever Bring back can't bring back safely, it leaves as it is now and names, never writes.

## 1. Slate numbers (high)

Bring back writes shot and scene numbers and a scene's `numbers_locked` like any prop, with no counterpart to
`restoreTo`'s 1.26 guard. (A) SC 4 has 4A, 4B; add a frame (4C), ⌘Z, add another (4C), Bring back: two 4C. (B) Issue
locks SC 4 with 4C slated as frame X; ⌘Z the Issue; insert Y before X (Y is 4C, X 4D); Bring back: SC 4 locked again
with Y = 4C while the slate says X. Follow the same rules `restoreTo` and `renumber` follow: a number that would collide
with a live one in its scene, or with a slate number held by another shot, isn't written (the record keeps its number
now, or the scene is renumbered as the board would, whichever `restoreTo` does); bringing back a lock follows the same
rule as locking (`slatedWithOther`). Name what was left. Unit tests for (A) and (B).

## 2. Never delete what a kept record names (medium)

A deletion (an undone create taken back) is dropped and named when a record that stays names it (`namedBy`, as
`restoreTo` uses: `media_id`, `location_id`, `cast_id`, `character_ids`, `theme.image_id`, and any others that rule
lists). Add "and nothing names it" where SBD_FORMAT.md says when a record goes. Test: add a location, ⌘Z, Restore to
here on the add, set 4A's location to it, Bring back: the location stays, 4A's `location_id` still resolves, the
notice names it.

## 3. A parent in the Trash is not there (medium)

For a move or a create, a parent in the Trash counts as not there: the record stays as it is now and is named
("couldn't come back: SC 05 is in the Trash"). Test: move 4A to SC 5, ⌘Z, trash SC 5, Bring back: 4A stays in SC 4.

## 4. The outline after a redo, and after a Bring back that wrote nothing (medium)

A run ends where a redo follows it (the step is in effect again): no outline, no button. A Bring back that writes
nothing settles its run, so the button doesn't keep pulsing. Tests: ⌘Z then ⌘⇧Z shows no run; a Bring back with
nothing to write leaves no button.

## 5. Smaller (low)

- **The words for what couldn't come back** say why (its scene is gone, it was deleted for good, it is in the Trash,
  its number is taken), never "kept its later edit" for a record that had no later edit. The round-1 test pinning
  "5A kept its later edit." for a frame whose scene is gone changes with this (it is this PR's own).
- **The box** covers only the rows the run undid (its undos and the steps they undid), never rows between them that
  another run touched.
- **Focus** after Bring back goes to the list, as after Show older steps.
- **The pulse** stays above AA: opacity 1 to 0.7, not 0.6; correct the comment.
- **One rule for "the step before a restore"**, used by the mark and by "Brought back: …" (the previous group in the
  log, never `seq - 1`).
- **A settled undo never joins a new run** (the main session's reading of Kevin's plan: once settled, the outline is
  gone for good): a run starts after the newest settled step.
- **A large Bring back** shows that it is working (`aria-busy`, as Restore to here does); replace `kept.some` with a set.
- **Pictures** cleaned up between the ⌘Z and the Bring back: check what happens; if the frame would come back with a
  missing picture, leave its picture as it is now and name it.
- **Spanish**: "En 4A, la lente conservó…" (the field with its article); make "{field}, recuperado" agree with the field
  (or word it without an adjective).

## Rules

No assertion from before #250 changes; round 1's stay except the one item 5 names. Words through `t()` in en and es.
Nothing else stored changes; the format stays as approved. No new dependency. Don't touch `e2e/visual.spec.ts` or any
baseline, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude` (docs/SBD_FORMAT.md for item 2 is yours).
No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/core
src/features/history src/app`; end to end, alone, counts read from the output: `e2e/undoOutline.spec.ts
e2e/history.spec.ts e2e/undoRedo.spec.ts e2e/ctrlS.spec.ts --project=chromium --workers=4`. Logs under
`test-results/undo-outline/` (names ending `-r2`). Never start a command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; the new words in en and es; each new or changed test's name and result; each
check's output line with counts.
