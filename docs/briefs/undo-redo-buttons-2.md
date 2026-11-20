# Brief: Undo and Redo buttons, round 2 (#241): what two reviews found

Work in the repo folder on branch `feat/undo-redo-buttons` (already checked out; don't switch). You write code and
tests and run the checks below. You never commit, push or merge. Read `docs/briefs/undo-redo-buttons.md` (round 1)
and the round-1 code first: `src/app/shell/UndoRedoButtons.tsx`, `src/app/shell/undoRedoNames.ts`,
`src/features/history/steps.ts` (`describeSteps`, `undoRedoLines`), the new helpers in `src/core/ops/ops.ts`,
`e2e/undoRedo.spec.ts`.

## 1. A name is shown only for the state it was read for (medium, both reviews)

Today `lines` is the last finished read for the same file, so right after an edit, an undo or a redo the buttons
still name the previous state's step until the new read lands (about 5 to 9 queries through Rust on the desktop): the
Undo button says "Undo: Added frame 1A" while a click would take the step after it; after an undo it names the step
just undone; after a language change it says "Deshacer: Added frame 1A". A keyboard user pressing Enter twice meets
exactly that moment.

- Keep each read with what it was read for: the file, the state (the store's `records` object, which is new after
  every committed step; or the undo and redo tops' ids if the store already has them: `merge` reads the tops through
  `history()`, projectStore.ts, and the buttons could then compare ids and skip their own `undoTops` query: use
  whichever is simpler and exact), the language and the plan unit. Use its lines only while all of these still
  match; otherwise the name is the existing "a step" (`history.aStep`): "Undo: a step".
- A unit test that delays the file's queries and checks the name right after an edit, an undo, a redo and a language
  change: it must be "… a step" or the right line, never the previous one.

## 2. The read costs only what its steps name (medium-low and low, both reviews)

The buttons read after every edit while a project is open, outside the store's queue, on the same file as the writes.

- `describeSteps` runs `SELECT sha256 FROM media_files` (all of them) on every read: ask only for the hashes the
  read steps' ops name, or skip the query when none of those ops touches media. History's own lines must stay exactly
  as they are.
- Read ops only for the groups whose line needs them (`edit` and `empty_trash`); a restore, undo or redo top's own
  ops are never needed for its line (a Restore to here can hold about 125k ops, read whole today after the restore
  and again after undoing it).
- `childrenBefore` (ops.ts) runs `json_extract` over every op from the step's seq on, for a move or schedule step. For
  the newest step that's small; for an undo top deep in the stack after many undos it covers everything since. Measure
  it on the memory driver with an undo top under 50,000 later ops (a test that times or counts it), and if the cost
  grows with the later log, bound it (for example by the moved records' parents) without changing any History line.
  Report the numbers before and after.
- A unit test that spies on the file's `query` during one read after an edit and fails on an unfiltered
  `media_files` query or a scan of `op_groups` or `ops` that isn't limited to the steps named.

## 3. Pressing Undo or Redo while typing in a field (low, both reviews; the main session's decision)

Today a click moves focus in Chromium and WebView2, so the field's save-on-leave edit is queued before the click's
undo, and Undo takes the typing rather than the step it named; in WebKit a click may not move focus, so the undo takes
the named step and the typing stays in the field unsaved. The two engines must behave the same, and nothing typed may
be lost unseen. The decision: **a press on Undo or Redo first commits the field being typed in, the way leaving it
does, in every engine, then takes the newest step.** So Undo takes back the typing just committed (History shows the
edit and its undo), and Redo after typing has nothing to take (a new edit empties the redo stack, as everywhere).
- On `pointerdown` on either button, if the focused element is a text entry (the test `undoShortcuts.ts` uses), blur
  it yourself so its own blur handler commits it; the click then runs after that commit (the store's queue keeps the
  order: check it, and say how you know).
- End to end, in Chromium here (the Mac runs it in WebKit, so no engine-specific code in the test): type into a
  frame's Action box, click Undo without leaving the field: the field shows the text from before the typing, and
  History's two newest lines are the edit and "Undid: …" of it. Then type again and click Redo: nothing is redone and
  Redo says "Nothing to redo".

## 4. Smaller fixes

- **The tip's words** (low-medium): the tip shows the line as plain text, so shot and scene numbers aren't in mono as
  History draws them (`LineText`, HistoryTile.tsx) and DESIGN.md asks. Draw the tip's line with History's own
  `LineText` and the keys in `font-mono`, through `Trans` parts, never concatenation. The `aria-label` stays plain
  text.
- **Escape** (low): Escape hides the tip only while the button has focus; a tip opened by hover can't be put away.
  Use a window `keydown` listener while the tip shows, as `SavedSignButton.tsx` and `ToolStrip.tsx` do.
- **A failed read** (low): today it calls `showNotice` after every edit, and a read still running when the project
  closes can raise one too. A name that can't be read falls back to "a step" quietly: no notice, no console error.
  Test both (a read that throws; `close()` in the same tick as a read).
- **The icons** (low): add a test like `src/ui/canvas/toolIcons/toolIcons.test.ts` for `src/ui/topBarIcons` (every
  icon the bar uses has its file, viewBox, `currentColor`, the stroke, no `<title>`), and a short README there like
  toolIcons' (how to replace a drawing). A missing file must fail that test, not draw an empty button silently. On
  screen the stroke is about 0.94 px (a 32-unit drawing at 20 px), thinner than the History button's glyph beside it
  (1.5 px, `glyphs.tsx`): make the two strokes match on screen (for example `vector-effect="non-scaling-stroke"`, or a
  viewBox the size it's drawn at); say which, and send a new PNG of the bar, light and dark.

## 5. Tests the reviews asked for

- A unit test of the buttons with a spy on the store's `undo` and `redo`: with nothing to take, a click, Enter and
  Space call neither; with something to take, each calls the right one once.
- The names follow a project switch (another project's lines never show) and a language change; the tip shows on
  keyboard focus and Escape hides a hovered tip. Unit or end to end, whichever proves it.
- Every assertion from round 1 stays; none from before #241 changes.

## Not to change

The buttons on the Projects screen while a project is open stay (they mirror ⌘Z there). Undo and redo themselves, what
is stored, History's lines and paging, `e2e/visual.spec.ts` and every baseline picture, CLAUDE.md, docs/PLAN.md,
docs/HANDOFF.md, design/DESIGN.md (the main session updates its top bar line), `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; unit: `node test-results/build627b/vitestUpper.cjs src/app
src/core/ops src/core/i18n src/features/history src/ui`; end to end, alone, counts read from the output:
`e2e/undoRedo.spec.ts e2e/history.spec.ts e2e/shell.spec.ts e2e/a11ySweep.spec.ts e2e/docking.spec.ts
--project=chromium --workers=4`. Logs under `test-results/undo-redo/`. Never start a command with `python`. Nothing
fetched through npx. No new dependency.

## Report back

For each numbered item: what you changed, and for item 2 the numbers before and after; each new test's name and
result; each check's output line with counts; the new PNGs' paths.
