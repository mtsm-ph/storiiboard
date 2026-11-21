# Brief: History lines, round 3 (#240): what the round-2 re-review found

Work in the repo folder on branch `feat/history-lines` (the main session checks it out for you; don't switch). You
write code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/history-lines.md`
and `-2.md` first, then round 2's code: `stepRecords` in `src/features/history/steps.ts`, `moveWhere`, `placeProven`,
`movedLine`, `pageName` and `personMoves` in `src/features/history/summary.ts`, `placesBefore` and `childrenBefore`
in `src/core/ops/ops.ts`.

The re-review found items 1 to 4 of round 2 right (no wrong place proven for in-app drags; `placesBefore` gives
exactly what `childrenBefore` gave) and one new false line. The rule stands: a line says only what it can say truly.

## 1. An unnamed page's number when the step is unsure (medium-low)

`moveWhere` checks `unsure`, but naming the moved page doesn't: `pageName` counts the deck's pages from `around`, and
a purged page isn't in it. Deck Pitch with unnamed pages P1, P2, P3; drag P3 to the start: "Moved page 3 to the start
of deck Pitch"; then trash P1 and empty the Trash: the place drops (right) but the name becomes "Moved page 2"
(false). When the step is unsure, name a page by its own name, else "a page", never by a number. A test of that
scenario, in English and Spanish.

## 2. "Unsure" only where a purge could matter (low; the main session's decision: do both)

Round 2 marks a step unsure when any record present at the step was deleted for good since. Two ways it falls back
more than it must:
- **A record in the Trash at the step** can never be a neighbour (`moveWhere` keeps `trashedAt === null` only), yet it
  makes every drag between its trashing and the Empty Trash unsure. Empty Trash keeps each op's kind and group, so
  whether a gone record was in the Trash at the step can be read from its last op before the step: a `trash` in an
  edit or redo group, or a `restore` in an undo group (it went back to the Trash), means it was; a `revert` can't be
  read, so it stays unsure. Leave such records out of "present".
- **The project record** is never in `around` for a frame's move, so the proof always takes the path where both
  lettering alphabets must agree (with and without I and O), and only A to H can prove a place. The project is never
  deleted: its state at the step is the `before` of its first op after the step, or the current row when no op came
  after. Read it so, and use the project's own lettering.
Tests: a drag between a frame's trashing and a later Empty Trash keeps its place; a frame lettered past H in a real
file keeps its place after an unrelated purge (both languages where words differ).

## 3. The proof checks the letters after the frame too (low)

`placeProven` assumes the step re-lettered the scene. In-app drags do (`moveItem` renumbers the whole target scene in
the same group), but a move step that didn't (an older version's file, a backfilled grouping, a later apply that
doesn't go through `moveItem`) could prove a false place: scene 4 holds A, B, C, D; B dragged after C with no renumber
in the step keeps the letter B (index 1); C purged later leaves one known frame before it, and "Moved 4B to after 4A"
is "proven". Also require that the known live frames after the moved one carry the next letters in order. A test with
such a step written by hand.

## 4. Keep `childrenBefore`, tested (nit)

`childrenBefore` has no caller after round 2. Another PR stacked on this one (#241) tests and names it, so keep it as
the one-ask form of `placesBefore` and add a unit test that, for several asks (records created later, trashed then,
moved away later, purged), `childrenBefore` and `placesBefore` give the same records.

## 5. Only if it's small: a page dragged in a deck whose keys couldn't be read (low, as before #240)

`movePageChanges` (pages.ts) re-keys every board item of the deck in an odd-key deck, so a one-page drag reads
"Reordered 6 items" (`boardItemsReordered` returns before `movedLine`), and the page branch of `personMoves` never
runs. If `personMoves` can tell the page the person moved in that step the same way it does for frames, with no
change to any other line, do it and test it; if not, leave it and say why.

## Rules

Round 1's and round 2's assertions stay; no assertion from before #240 changes beyond what rounds 1 and 2 changed.
Words through `t()` / `tn()` in en and es. No new dependency. Don't touch what is stored, undo and redo,
`e2e/visual.spec.ts` and every baseline, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; the whole unit suite
(`node test-results/build627b/vitestUpper.cjs` with no folder); end to end, alone, counts read from the output:
`e2e/history.spec.ts e2e/notifications.spec.ts --project=chromium --workers=4`. Logs under
`test-results/history-lines/` (names ending `-r3`). Never start a command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; each new test's name and result; each check's output line with counts.
