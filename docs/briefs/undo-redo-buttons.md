# Brief: Undo and Redo buttons in the top bar (Kevin, Nov 17 and 18; item 8, second piece)

Work in the repo folder on branch `feat/undo-redo-buttons` (already checked out, made from `feat/history-lines`, which
gives every step a line that names what changed and where; don't switch). You write code and tests and run the checks
below. You never commit, push or merge. Read CLAUDE.md (Design, Edits and undo, Navigation) and design/DESIGN.md's top
bar section first.

## What Kevin asked (his plan, Nov 18)

- At the window's top right, beside the project menu: two icon buttons, each with its name and key on hover and
  focus: "Undo: Moved wall · Ctrl+Z" (⌘Z on a Mac), "Redo: … · Ctrl+Y or Ctrl+Shift+Z" (⌘⇧Z), the step's title read
  from History, so they depend on the History lines.
- Project edits only, as ⌘Z; a layout change stays in the Layout menu.
- With nothing to undo or redo: shown disabled but still reachable by Tab (`aria-disabled`, not `disabled`), so focus
  can still read "Nothing to undo".

## What to build

- **Where:** the top bar (44 px), at the right, just before the Layout and Project menus (read the bar's component and
  DESIGN.md: boxed cells with 1.5 px rules, no radius, no shadow). Two square icon cells the bar's height. With no
  project open (the Projects screen), they are not shown.
- **Icons:** one SVG per icon, as `src/ui/canvas/toolIcons` keeps one file per tool, drawn in the same line style and
  stroke as those (a curved arrow back, and forward). Ink on paper, paper on ink in Dark, as the bar's other marks.
- **What they do:** exactly what ⌘Z and ⌘⇧Z do (`projectStore.getState().undo()` / `redo()`), so History records them
  the same way.
- **Their names:** the accessible name is "Undo: <the step's line>" and "Redo: <the step's line>"; the title (shown on
  hover and focus) adds " · Ctrl+Z" (⌘Z on a Mac) and " · Ctrl+Y or Ctrl+Shift+Z" (⌘⇧Z on a Mac). The line is the one
  History shows for the step that would be undone or redone: read it the way History does (`summary.ts`), never a
  second wording. With nothing to undo: "Nothing to undo", `aria-disabled="true"` (still focusable), no action.
- **Live:** the names follow every edit, undo, redo and project switch, without a timer.
- **Keys:** nothing changes: `undoCommandFor` (src/app/shell/undoShortcuts.ts) already redoes on Ctrl+Y off a Mac and
  on ⌘⇧Z on one. The titles only name the keys, read from the same Mac test the app already uses (TopBar.tsx has it).
- Every word through `t()` in en and es ("Undo: {step}", "Redo: {step}", "Nothing to undo", "Nothing to redo", the
  key hints per platform). List them in your report.

## Tests

- Unit: the names for a step to undo and to redo, for nothing, per platform's keys, in both languages.
- End to end (the History spec or a new `e2e/undoRedo.spec.ts`): make two edits; the Undo button's name is "Undo: <the
  second step's line>"; click it: the edit is undone, History shows "Undid: …", the Redo button names it; click Redo:
  back. With nothing to undo the button is focusable and says "Nothing to undo", and a click does nothing. The title
  names the platform's keys (the suite also runs in WebKit on a Mac: expect ⌘ there, Ctrl elsewhere, by the app's own
  Mac test, never by a skip). A layout change is not undone by the button.
- `e2e/visual.spec.ts`'s pictures will change (the top bar gains two cells): don't regenerate or touch them; the main
  session runs the baseline job at the end of the stack. Run every other spec you touch, and say which visual tests
  you expect to change.
- No existing assertion changes, except ones that state the top bar's exact contents or Tab order (list each, and
  stop to report if any is more than that).

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; unit: `node test-results/build627b/vitestUpper.cjs src/app
src/core/i18n src/features/history`; end to end, alone, counts read from the output: the specs you add or change and
`e2e/a11ySweep.spec.ts` if the top bar is in it, `--project=chromium --workers=4`. Logs under
`test-results/undo-redo/`. Never start a command with `python`. Nothing fetched through npx. No new dependency.

## Don't touch

The op log and what is stored, undo and redo themselves, the History lines' words, `e2e/visual.spec.ts` and every
baseline picture, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Report back

Where the buttons sit and how they look (a short description; and a PNG of the top bar, light and dark, under
`test-results/undo-redo/`); the new words in both languages; each test's name and result; each changed expectation;
which visual baselines will change; each check's output line with counts.
