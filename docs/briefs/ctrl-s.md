# Brief: Ctrl+S (⌘S on a Mac) and the hand-backup rule (Kevin, Nov 18; item 8, third piece)

Work in the repo folder on the branch the main session checks out for you (`feat/ctrl-s`, stacked on the Undo and
Redo buttons, #241; don't switch). You write code and tests and run the checks below. You never commit, push or merge.
Read CLAUDE.md's "Backups" bullets and "Edits, undo and autosave" first, then `src/core/storage/backups.ts` (the
schedule: `startBackups`, `runNow`, `backUpThen`, `onBackup`), `src/app/project/BackupsPanel.tsx` (Back up now),
`src/app/shell/SavedSignButton.tsx` and `savedSign.ts` (the status bar's sign), `src/app/shell/undoShortcuts.ts`.

## What Kevin decided (his plan, Nov 18, word for word where quoted)

- "Every change still saves at once. The key confirms: it commits the field being typed in (fields commit when left
  today), shows the status bar's Saved sign, and takes a backup now if anything changed since the last one; if nothing
  did, the sign says when the newest backup was taken. The backup follows every backup rule (where, clone or
  step-by-step copy, pruning)."
- "A backup asked for by hand (Ctrl+S or Settings → Backups → Back up now; one rule, one function in
  src/core/storage/backups.ts, so people who press Ctrl+S after every edit don't push the timed backups out of 'the
  last 12'):
  - Nothing changed since the newest backup: no backup; the sign says when the newest was taken.
  - The newest backup is under a minute old: no backup now. One is queued for when that minute is up (at most one
    queued), and the Saved sign still answers at once.
  - The newest backup is under 5 minutes old and was itself a timed or hand backup: the new one replaces it. The new
    copy is written first and the old one deleted only after the new one is complete; never the reverse.
  - Otherwise a new backup, as today.
  - A backup made before Compact, a migration or an Open backup is never replaced: it's a safety copy for that step.
    Pruning and the 5 GB cap are unchanged.
  - Back up now today: with nothing changed it makes none; with any change it always makes a new copy, a second one
    in the same minute named '… (2)', each counting toward the last 12. It takes this rule."
- "It never opens the browser's or WebView's own save dialog: the key is caught for the whole window, text fields
  included, in the desktop app and in dev."
- (Its part in the undo outline, item 7, comes with item 7: not now.)

## How to build it

1. **One function in backups.ts.** Add to `BackupSchedule` a `backUpByHand()` that returns what happened, e.g.
   `{ kind: 'nothing', newestAt } | { kind: 'queued', at } | { kind: 'replaced', created, replaced } |
   { kind: 'created', created }` (plus `deleted` from pruning, as `BackupRun` has). It takes its turn with every other
   copy (`inTurn`), and prunes exactly as `backUp` does, never the copy just made.
   - **Which backup may be replaced (the main session's decision):** only one this schedule wrote itself, in this
     session, as a timed or hand backup, and that `backUpThen` (Compact) has not made or adopted as its safety copy
     (`backUpThen` reuses `latest` when nothing changed: from then on that copy is Compact's and never replaced).
     Everything else (a migration's backup, which has its own name; any copy from before this session; anything else
     on disk) is never replaced: the press makes a new one instead. Nothing new is stored and no file name changes:
     keep this in memory in the schedule.
   - **"Under a minute" and "under 5 minutes"** are measured from the exact time the schedule wrote that copy (keep it
     with `latest`), not from the minute in its name. With no copy written this session, the newest on disk counts
     by the time in its name (`newestBackupAt`), and it's never replaceable.
   - **Replacing:** write the new copy under a fresh name (`freshBackupName`, as today), wait until it's complete,
     then delete the old one. If writing the new copy fails, the old one stays and the error goes where `runNow`'s
     does.
   - **The queued one:** at most one, a single `setTimeout` for when that minute is up; when it fires it runs the same
     rule again (so it usually replaces). `stop()` clears it. A second press while one is queued answers with the same
     time and queues nothing more. Its backup is told through `onBackup` as every other.
   - The timed 5-minute run is unchanged: it always makes a new copy (and its copy can later be replaced by hand).
2. **Back up now** (BackupsPanel) calls `backUpByHand()` and says what happened: a backup made (or made in place of
   the last one) as today ("Backed up at {time}"), nothing changed as today, queued with new words, for example
   "A backup was made less than a minute ago. The next one will be made at {time}." Every word through `t()` in en and
   es (Spanish in the file's own voice: read the neighbouring `backups.*` lines); list them in your report.
3. **The key.** One window `keydown` listener in the capture phase (beside the undo shortcuts in the app shell):
   ⌘S on a Mac, Ctrl+S elsewhere, by the app's own Mac test. It always calls `preventDefault()`, with or without a
   project, in text fields too, and stops nothing else. With a project open:
   - **Commit the field being typed in, the way leaving it does.** Fields commit on blur today (34 files use
     `onBlur`). The Undo and Redo buttons already do this on a press: reuse their `commitTyping`
     (src/app/shell/undoRedoPress.ts, which blurs a text entry so its own blur handler commits), then focus the
     element again, restoring its selection (`selectionStart`, `selectionEnd`, `selectionDirection`) and without
     scrolling, so typing goes on where it was. Where leaving a field
     closes its editor (an inline title, a canvas text box), it closes as leaving it does: that's the commit. Look
     through the `onBlur` handlers for one whose blur does something other than commit or close (a refocus that
     opens a menu, selects all, or starts something): list any you find and how you handled it.
   - Then `backUpByHand()`, and **show the Saved sign's tip** (the box `SavedSign` shows on hover) with its answer:
     the sign's own "Saved at {time}." and "Last backup at {time}.", plus, when queued, a new "Next backup at {time}.".
     The tip stays until the next key, click or pointer move (no timer). The tip is `aria-hidden`, so the same words go
     to a polite live region once per press.
   - The sign still learns of every backup from `onBackup` (no polling, no timer, as 6.5.4 says).
   - With no project open: only `preventDefault()`.

## Tests

- Unit (`backups.test.ts`, with the fake file and clock its tests already use): nothing changed; under a minute
  (queued; a second press queues nothing more; at the minute it runs and replaces); under 5 minutes, timed or hand
  (replaced: the new copy is complete before the old is deleted, by the order of the fake file's calls); under 5
  minutes but Compact's, made or adopted (a new copy; Compact's stays); a copy from before this session (never
  replaced); 5 minutes or more (a new copy); a failed write keeps the old one; pruning and the cap as before;
  `stop()` drops the queued one.
- Unit for the key: ⌘S on a Mac, Ctrl+S elsewhere, never Ctrl+S on a Mac or ⌘S elsewhere as the trigger, and the
  default is prevented in a text field.
- **Existing tests that state Back up now's old behaviour** (a second copy in the same minute named "… (2)" from
  Back up now): Kevin's plan changes exactly that, so those expectations change with it. List each (file, test, old,
  new). Any other existing assertion that would have to change: stop and report.
- End to end (`e2e/ctrlS.spec.ts`, Chromium; it also runs in WebKit on a Mac, so use the platform's key by the app's
  own Mac test, never a skip): type into a frame's field in the Inspector, press the key: the value is in History at
  once, the focus and caret are still in the field, `defaultPrevented` was true (record it from a listener the test
  adds), the Saved sign's tip shows "Saved at …" and the live region says it; press it again within the minute: no
  second backup in Settings → Backups and the answer says when the next one will be made. Back up now twice within
  the minute: one backup, and the queued words.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; unit: `node test-results/build627b/vitestUpper.cjs
src/core/storage src/app`; end to end, alone, counts read from the output: `e2e/ctrlS.spec.ts`, the backups specs
(`e2e/backups*.spec.ts`, whichever exist) and any spec you change, `--project=chromium --workers=4`. Logs under
`test-results/ctrl-s/`. Never start a command with `python`. Nothing fetched through npx. No new dependency.

## Don't touch

What is stored in the .sbd, backup file names and where backups go, the timed schedule's rule, the op log, the Undo
and Redo buttons, `e2e/visual.spec.ts` and every baseline picture (say if you expect any to change), CLAUDE.md,
docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Report back

What each press does in each case; the new words in en and es; the `onBlur` handlers you had to treat specially;
every changed existing expectation (file, test, old, new); each new test's name and result; each check's output line
with counts; whether any screenshot should change.
