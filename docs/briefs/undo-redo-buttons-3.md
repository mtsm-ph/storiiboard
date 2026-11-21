# Brief: Undo and Redo buttons, round 3 (#241): what the round-2 re-reviews found

Work in the repo folder on branch `feat/undo-redo-buttons` (the main session checks it out for you; don't switch).
You write code and tests and run the checks below. You never commit, push or merge. Read
`docs/briefs/undo-redo-buttons.md` and `-2.md` first, then the round-2 code: `src/app/shell/UndoRedoButtons.tsx`,
`undoRedoRead.ts`, `undoRedoPress.ts`, `src/features/history/steps.ts`, `summary.ts` (`describeEdit`, its picture
check), `src/ui/topBarIcons/topBarIcons.ts`, `e2e/undoRedo.spec.ts`.

Two re-reviews found no high or medium fault in round 2 except one known cost (item 4). These are the rest, all low.

## 0. First: History lines' round 2, merged in

#241 sits on #240 (History lines), which has had rounds 2 and 3 of its own (`docs/briefs/history-lines-2.md` and
`-3.md` on that branch: scenes' places from a real file, a neighbour deleted for good, "del proyecto", one scan of the
log per load (`placesBefore`; `childrenBefore` stays as its one-ask form), re-keyed drags, fallback nouns, pages). The main session merges `feat/history-lines` into this branch before you
start. If it leaves conflicts (both PRs changed `steps.ts`, and maybe `summary.ts` and `ops.ts`), resolve them first
so both hold: #240's round-2 rules, words and single scan; #241's `describeSteps`, `everyOp`, the filtered picture
query, `undoTops` and `logOf`. Don't commit: the main session commits the merge. Report each conflict and how you
resolved it, then run the round-1 and round-2 tests of both PRs before going on.

## 1. A press still in flight

The name is keyed to the store's merged state, but a press queues behind work not yet merged: with focus on Undo and
Enter pressed twice (or held: auto-repeat about every 30 ms) before the first undo has committed and merged, the
second press acts on a state the label doesn't show yet. While any press of these buttons is queued and not yet
merged, the names say "a step" (count presses in flight in the component, or keep a pending count where the store
queues them: whichever is simpler and exact). A unit test of the naming with a press in flight.

## 2. Touch and pen

With touch or a pen, Pointer Events run pointerdown, pointerup, pointerout, pointerleave, and only then the click, so
`onPointerLeave` clears the "this press committed a field" flag before `onClick` reads it: a tap on a button that
says "Nothing to undo" commits the typing but doesn't take it, where a mouse click does. Clear the flag on
`pointerleave` only for `pointerType === 'mouse'`, and on `pointercancel` and at the next `pointerdown` for every
type. Put the press's small state (pointerdown, pointerleave with its type, pointercancel, click → whether it
committed) in a plain function in `undoRedoPress.ts` and unit-test it for mouse, touch and pen (the repo has no DOM
test library, and none is to be added).

## 3. One rule for a step's pictures

`steps.ts` now builds the list of picture hashes to look up, and `summary.ts` (`describeEdit`) decides "(picture
removed)" from the same ops by its own copy of the same test (`record(op)`, `type === 'media'`,
`mediaFields(...).sha256`). Today they match; a later change to one would make a picture still in the file read as
removed. Export one function from `summary.ts` that lists a step's picture hashes, and use it in both places. A unit
test that a step with a picture asks for exactly the hashes `describeEdit` checks.

## 4. The known cost, said in the test

`childrenBefore` (ops.ts) still scans every op since a moved step (about 33 ms under 50,000 later ops on the memory
driver, from round 2's numbers; #240's round 2 makes it one scan per load, not one per move); an exact bound needs an
index on the ops' parent, a schema change that waits for Kevin. The query-spy test (`undoRedoQueries.test.ts`) passes today only because it has no move: add a move under an
undo to it, and let `childrenBefore`'s query through by name, with a comment that it is the one known read whose cost
grows with the later log and why it isn't bounded yet. Nothing else may pass that test unbounded.

Also, an `empty_trash` top reads all its ops only to count them: if `describeGroup` can take the count the log
already gives (`op_count` in `logOf`'s rows) and History's line stays exactly the same, do that for the buttons' read;
if it can't without touching History's own path, leave it and say so.

## 5. Smaller

- `TOP_BAR_ICONS[which] ?? ''` still draws an empty button for a name not in `TOP_BAR_ICON_NAMES`: type the icon
  name as that list's union, so a missing icon is a type error, and drop the silent fallback.
- The keys hint on Windows draws "or" (Spanish "o") in mono with the keys: only the keys are mono. Make the hint
  `Trans` parts ("{first} or {second}"), each key a mono part, never concatenated; the plain `aria-keyshortcuts` and
  `aria-label` don't change.
- `|| typed` (a press that committed a field takes the step even from a button that said "Nothing…") has no test that
  fails without it. If an end-to-end test can show it (a field to type in while Undo says "Nothing to undo"), add it;
  if no state allows that, say so and rely on item 2's unit test.

## Rules

Every round-1 and round-2 assertion stays; none from before #241 changes. Words through `t()` in en and es. No new
dependency. Don't touch undo and redo themselves, what is stored, History's lines, `e2e/visual.spec.ts` and every
baseline picture, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, design/DESIGN.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; unit: `node test-results/build627b/vitestUpper.cjs src/app
src/core/ops src/core/i18n src/features/history src/features/notifications src/ui`; end to end, alone, counts read
from the output: `e2e/undoRedo.spec.ts e2e/history.spec.ts e2e/notifications.spec.ts e2e/shell.spec.ts
--project=chromium --workers=4`. Logs under `test-results/undo-redo/` (names ending `-r3`). Never start a command
with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; each new test's name and result; each check's output line with counts.
