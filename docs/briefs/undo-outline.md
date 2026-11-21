# Brief: undoing from History: the outline, "Bring back what was undone" and the "Before restoring" mark (item 7)

Work in the repo folder on the branch the main session checks out for you (`feat/undo-outline`, stacked on #248, Settings; don't
switch). You write code and tests and run the checks below. You never commit, push or merge. Read CLAUDE.md ("Edits,
undo and autosave", History), `docs/SBD_FORMAT.md` (op_groups and "How undo, redo and restore use the log"),
`src/core/ops/ops.ts` (`commit`, `undo`, `redo`, `restoreTo`, `GroupKind`), `src/features/history/` (HistoryTile,
steps, summary), `src/app/shell/saveShortcut.ts` (Ctrl+S, which settles the outline).

## Kevin's plan (Nov 18), word for word

"One sign at a time, all worked out from the log, nothing stored:
- Undone entries (from ⌘Z, the Undo button or Restore to here) get a Truffle outline and the word 'Undone'.
- 'Bring back what was undone' at the top of History takes back only that undo or restore, as a new op group. A later
  edit to the same field stays, and the result names which. It pulses slowly (opacity, about 2 s); under reduced
  motion it is still and solid.
- The 'Before restoring' mark: after Restore to here, the step you were at just before gets the mark and the words
  'Before restoring', with 'Go back to this point'. That is a Restore to here on that step: a whole restore, so steps
  made after it are undone too (and outlined), unlike the button, which keeps them.
- How they share the screen: while the outline and button show, the mark shows its words but not its own Go back link,
  because the button is the way back. Once they settle (Ctrl+S, three further steps or a project switch), the outline
  and button go and the mark stays in History for good, with Go back. A ⌘Z undo makes an outline and the button, never
  a mark: only a restore makes one.
- In History only. The outline, the button and the mark show only in the History tile. Nothing pulses in the main
  window after a plain Ctrl+Z; there the Redo button (item 9) is the way back.
- A run of undos counts as one: consecutive undos (⌘Z pressed five times, or the Undo button) get one outline around
  the whole run, and 'Bring back what was undone' brings the whole run back, as one new op group. A restore is a run of
  its own. An edit in between ends a run.
- The mark is read from the restore's op group (it already names the point it restored to; the point before is the
  group just before it). Reopening the project: outline and button settled, marks still there."

Kevin (Nov 20, night): "the new kind, bring_back, pointing at the undo it takes back. History says 'Brought back: …'.
Nobody has an older copy of the app yet, so this is the cheapest day to add a kind, and the mark needs the pointer to
stay right after a reload."

## The format part (Kevin approved the kind; build exactly this, and document it in docs/SBD_FORMAT.md)

- **The kind**: `op_groups.kind = 'bring_back'`. The column is TEXT with no CHECK (001_initial.ts says later phases add
  kinds), so no migration and no schema_version change.
- **What it points at**: `target_group_id` = the newest undo (or the restore) of the run it takes back. The run is read
  from the log: the undos immediately before that one with no edit, redo or restore between them. A run already
  brought back (a `bring_back` pointing at it) offers no button.
- **Its ops**: ordinary ops (`update`, `create`, `trash`, `restore`, … as the undone groups' own ops were), writing the
  values the undone steps had made, except fields a later edit changed since: those keep the later edit, and the
  result names them ("Brought back 3 changes. 4A's lens kept its later edit.").
- **The stacks**: as an edit: `stack_below` = the undo top before it, `undo_top` = itself, `redo_top` = null (a new step
  empties ⌘⇧Z's stack). So ⌘Z undoes a bring_back like any edit, its ops swapping before and after.
- **What an older copy shows**: none exists yet (Kevin). For any later kind, `describeGroup` gains a default: a kind it
  doesn't know reads "a step" (today its switch has no default and would give nothing); undo and redo work on any kind,
  since they read only ops and the stack pointers.
- **JSON export and import**: a Full archive writes `op_groups` rows as they are, so a bring_back round-trips exactly
  (test it); Project data leaves History out, as today.
- **Both doors**: the JSON import (the page) and a file opened through Rust or the MCP's node driver: neither checks a
  step's kind today, and neither needs to; History is the only reader that words kinds. Say so in SBD_FORMAT.md, and
  add tests that a file holding a bring_back opens, lists and undoes through the page's driver and the node driver.
- **The mark after a reload**: read from the restore's group (`restore_to`) and the group just before it, as Kevin's
  plan says; a bring_back of that restore removes its outline but not its mark.

## The screen (History tile only)

- Undone entries (from ⌘Z, the Undo button, Restore to here) get a Truffle outline (the warning token; DESIGN.md: never
  a fill, paper text where it is filled) and the word "Undone"; a run of consecutive undos gets one outline around the
  run.
- "Bring back what was undone" at the top of History, pulsing slowly (opacity, about 2 s), still and solid under
  reduced motion; it brings back the newest unsettled run as one `bring_back` step.
- The "Before restoring" mark and "Go back to this point" (a Restore to here on that step); while the outline and
  button show, the mark shows its words without its link.
- Settling (Ctrl+S, three further steps, a project switch, a reopen): kept in memory, never stored; after it the
  outline and button go and the mark keeps its link. Ctrl+S's handler calls the settle (saveShortcut.ts).
- Every word through `t()` in en and es ("Undone", "Bring back what was undone", "Brought back: {step}", "Before
  restoring", "Go back to this point", the result line); list them.

## Tests

Unit: the run (five undos, an edit between ends it, a restore its own run); a bring_back's ops (later edits kept and
named, a trashed item, a created one); its stack pointers and a ⌘Z of it; "Brought back: …" in History; the default for
an unknown kind; the mark after a reload; settling (three steps, Ctrl+S, a switch); JSON Full archive round trip; the
node driver opens and lists a file with a bring_back. End to end (`e2e/undoOutline.spec.ts`): undo three steps, see one
outline and the button, bring them back, History reads "Brought back: …"; Restore to here, the mark appears with its
words only, settle with Ctrl+S, the link appears and goes back; reduced motion: no pulse. No existing assertion changes.

## Rules

Nothing else stored changes. Don't touch `e2e/visual.spec.ts` or any baseline (say which you expect to change: History
isn't in them), CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. Update `docs/SBD_FORMAT.md` for the
kind (that one docs file is yours here). No new dependency. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/core
src/features/history src/app mcp`; end to end, alone, counts read from the output: `e2e/undoOutline.spec.ts
e2e/history.spec.ts e2e/undoRedo.spec.ts e2e/ctrlS.spec.ts --project=chromium --workers=4`. Logs under
`test-results/undo-outline/`. Never start a command with `python`. Nothing fetched through npx.

## Report back

The format part as built (for Kevin's morning report, ten lines at most); the screen; the new words in en and es; each
test's name and result; each check's output line with counts.
