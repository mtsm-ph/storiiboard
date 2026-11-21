# Brief: Ctrl+S, round 2 (#244): what the review found

Work in the repo folder on branch `feat/ctrl-s` (already checked out; don't switch). You write code and tests and run
the checks below. You never commit, push or merge. Read `docs/briefs/ctrl-s.md` (round 1, with Kevin's plan word for
word) first, then `src/core/storage/backups.ts`, `src/app/shell/saveShortcut.ts`, `AppShell.tsx`,
`src/app/project/BackupsPanel.tsx`, `src/core/storage/project.ts` (`close`).

## 1. A run of presses must not leave one backup for a session (high; the main session's decision)

A hand copy takes in the changes, so the next 5-minute tick finds nothing changed and makes no copy; the next press
within 5 minutes of that hand copy replaces it; and so on without end. Pressing Ctrl+S after a few edits every two
minutes for an hour leaves one backup, where the timed run alone keeps about twelve: the opposite of Kevin's purpose
("so people who press Ctrl+S after every edit don't push the timed backups out of 'the last 12'").

The decision: **a hand copy stands in for the tick it made unnecessary.** When a tick finds nothing changed since the
newest copy this schedule wrote, that copy becomes the tick's: it is no longer replaceable. So each 5-minute interval
keeps at least one copy, and a hand copy replaces only a copy of the same interval. Unit tests: the reviewer's chain
(ticks at 5 and 10 minutes; presses at 4:10, 6:10, 8:10, 10:30, 12:30, 16:10 with edits between) keeps one copy per
interval, never fewer than the timed run alone would; a press within the same interval still replaces.

## 2. Keys typed between the commit and the refocus (medium)

After the blur, focus sits on `<body>` until the write lands and a frame passes (about 20 to 150 ms): letters typed
then are lost, and window shortcuts act on them (Ctrl+Z undoes the step just committed; Alt+1 to 6, the backtick,
Ctrl+E, Ctrl+Shift+H, Ctrl+, and the sidebar toggle fire). While a press is between its blur and its refocus, the
save listener (window, capture phase) takes every keydown: `preventDefault` and `stopImmediatePropagation`, so
nothing else acts on it; printable characters are kept in order and, once the field has focus again, inserted at the
caret the way typing does (for example `document.execCommand('insertText', …)`, which fires the input event React
listens to; check it in Chromium and in WebKit on Windows); if the field doesn't come back, they are dropped. End to
end: press the key and type "xyz" at once with no wait: the field ends with the text in order and History shows one
edit for the commit and the typing as the field next commits; a Ctrl+Z pressed in the gap undoes nothing.

## 3. Smaller (low)

- **A queued backup when the project closes or switches** is dropped today, though the sign said one would be made:
  run it (if anything changed) before `stop()` in `close()`. And after `backUpByHand()` resolves, check the project is
  still the one pressed for before showing its answer on the sign.
- **The replaced copy deleted by hand meanwhile**: treat a missing old copy as already gone (the new copy is good;
  no error, pruning still runs).
- **Settings → Backups refreshes** when the queued backup (or any backup) lands: bump its list from
  `schedule.onBackup`, so it never lists a replaced file. Fix the comment at line 67 ("within a minute").
- **Finding a field drawn anew**: also require its value to equal what the field held at the blur, and stop the climb
  for its container at the tile (`[data-stack-id]`), so focus can never go to another record's field.
- **The weak unit test** "prevents the default in a text field too" passes a target the code never reads: make it
  prove the text-field case.

Left as is (say so): a press waits behind a timed copy already running before its answer shows.

## Rules

No existing assertion changes; round 1's stay. Words through `t()` in en and es. Nothing stored changes; backup file
names and places don't change. No new dependency. Don't touch `e2e/visual.spec.ts` or any baseline, CLAUDE.md,
docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/core/storage
src/app src/core/i18n`; end to end, alone, counts read from the output: `e2e/ctrlS.spec.ts e2e/projects.spec.ts
e2e/savedSign.spec.ts` in Chromium, and `e2e/ctrlS.spec.ts` in WebKit on Windows (`--project=webkit`),
`--workers=4`. Logs under `test-results/ctrl-s/` (names ending `-r2`). Never start a command with `python`. Nothing
fetched through npx.

## Report back

For each numbered item: what you changed; each new or changed test's name and result; each check's output line with
counts.
