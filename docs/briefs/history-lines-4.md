# Brief: History lines, round 4 (#240): what the round-3 re-review found

Work in the repo folder on branch `feat/history-lines` (the main session checks it out for you; don't switch). You
write code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/history-lines-3.md`
first, then `personMoves`, `moveWhere`, `placeProven`, `deckRekey`, `movesKind` in `src/features/history/summary.ts`
and `stepRecords`, `trashedThen` in `src/features/history/steps.ts`.

The re-review found round 3's items 1, 2 (its reading of the Trash), 4 and 5 right, and one false line left. The rule
stands: a line says only what it can say truly; refusing a place is always allowed.

## 1. A re-keyed drag with one write since deleted for good (medium-low; a false line)

When a drag re-keys its place (6.23), it rewrites the Trash's items too (`sceneItems` in board.ts, `boardItems` in
pages.ts include trashed records). If one of those is purged later, its move in the drag step is emptied;
`personMoves` then gives up and returns every move, `movedThings` counts them all as "items", and `moveWhere` places
the set by its smallest new key: the start. Deck Pitch with unreadable keys, pages P1, P2, P3, a rectangle R1 and a
rectangle T already in the Trash; drag P3 to the start; Empty Trash: "Moved 5 items to the start of deck Pitch", where
the truth is "Moved page 3 to the start of deck Pitch". The same for frames (scene 4 with A, B, C, D live and X in the
Trash, unreadable keys, 4D dragged after 4A, then Empty Trash: "Moved 5 items to the start of SC 04").

- In a re-key, leave out the emptied moves of records `trashedThen` shows were in the Trash at the step (a trashed
  record can't be what the person dragged), and run `personMoves` on the rest.
- Wherever any move the line would count or place is emptied and can't be left out so, `moveWhere` returns no place
  and the count is not stated as a fact (today's plain words).
- Tests: the deck case and the frame case, read back from a file, en and es.

## 2. The letter proof when every frame after the new place is gone (low)

Scene 4 holds A, B, C; a step that wrote no renumber moves B to the end (A, C, B), so B keeps "4B"; C is purged later:
one known frame before B, none after, so "Moved 4B to after 4A" is "proven", but B went after 4C. Require that the
step itself wrote the moved frame's letter (an op in the group changes its `number`), else prove nothing. For in-app
drags this only refuses moves across notes alone. A hand-written test of the case.

## 3. A step that restores a record it moves (low, hand-made steps only)

`&& !trashedThen(...)` now overrides the step's own write: a record trashed before the step and restored by the step
is live after it, its data gone, and the step isn't marked unsure. Count such a record as there when the step's own op
on it is a `restore` in an edit or redo group, a `trash` in an undo group, a `revert` or a `create` (not every own
write: that would bring item 1's path back). A hand-written test.

## 4. Two cheap cost trims (nit)

`opsOfRecords` reads every write ever made to every record purged since the page's oldest read: limit it to writes
before the latest step start it is asked for. `trashedThen` filters a record's whole write list per read: sort each
record's writes once and search them.

## Left as is (say so in your report)

A frame's sketch or picture stays live under it when the frame goes to the Trash, and Empty Trash purges them with it;
their last write is a create or update, so a drag made between the trashing and the Empty Trash is still unsure and
loses its place. The line stays true; leave it.

## Rules

No assertion from before #240 changes beyond rounds 1 and 2's; rounds 1 to 3's assertions stay. Words through `t()` /
`tn()` in en and es. No new dependency. Don't touch what is stored, undo and redo, `e2e/visual.spec.ts` and every
baseline, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; the whole unit suite
(`node test-results/build627b/vitestUpper.cjs` with no folder); end to end, alone, counts read from the output:
`e2e/history.spec.ts e2e/notifications.spec.ts --project=chromium --workers=4`. Logs under
`test-results/history-lines/` (names ending `-r4`). Never start a command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; each new test's name and result; each check's output line with counts.
