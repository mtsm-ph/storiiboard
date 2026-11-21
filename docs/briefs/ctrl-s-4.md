# Brief: Ctrl+S, round 4 (#244): the small findings of the round-3 re-review

Work in the repo folder on branch `feat/ctrl-s` (the main session checks it out for you; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/ctrl-s-3.md` first, then
`src/core/storage/project.ts` (`close`, the `closing` map), `src/core/storage/backups.ts` (`pending`, `flushQueued`,
the timers), `src/app/projectStore.ts` (`open`), `src/app/projects/actions.ts` (`reopenChangedProject`),
`src/app/project/BackupsPanel.tsx`, `src/app/shell/saveShortcut.ts`.

The re-review found round 3's detached close sound. These are its smaller findings, and Kevin's answers (Nov 20,
night) to two questions.

0. **The hand-backup rule, as Kevin answered:** "a press replaces only a hand copy made since the last tick. A tick's
   own copy is never replaced by a press, so there's a copy for every 5 minutes whoever presses." Change the rule in
   `backUpByHand` to that. This changes, as Kevin's answer requires, exactly these expectations: round 1's "replaces a
   timed backup under 5 minutes old, the new copy complete before the old is deleted" (a press after a tick's own copy
   now makes a new copy; keep its check that a replacement's new copy is complete before the old is deleted, on a
   hand copy instead), and round 3's "lets a press replace a tick's own copy, which the next tick then adopts" (now: a
   press never replaces a tick's copy, and each tick's copy stays). Name each in your report, old and new; any other
   assertion that would have to change: stop and report. Add the reviewer's chain with presses just before each tick:
   one copy per tick at least.
1. **A close that hangs** (a share that stalls) has no time limit: opening that file again waits on `closing` for as
   long as it takes, and `whileOpeningProject` keeps every sidebar section disabled meanwhile, with no word on screen.
   Kevin: "A close that hangs gets a time limit. When it passes, the app says so in words and the sidebar and a reopen
   go on; nothing waits without an end." Give the wait a time limit (10 s); when it passes, the status line says so
   ("The backup of {project} is still being made. You can go on working." in en and es, or better words you find) and
   the sidebar and the reopen go on. Say in your report what is safe to let go on, and why: the old connection then
   only reads the file for its copy; a second connection to the same file opens beside it; the old connection's lock
   is removed on its close only when its session matches (lock.rs), so it can't remove the new lock; anything you find
   that isn't safe, keep waiting for it and say so. When the flush begins, stop the old schedule's 5-minute timer and
   its lock refresh, so a hung close neither queues more runs nor keeps the old lock fresh. A unit test with a copy
   that never settles.
2. **A hand copy already under way at a switch** (a Ctrl+S or Back up now that started at once) isn't counted by
   `pending()`, so the switch awaits the close in the queue and `file.close()` cuts that copy off. Count it, so it runs
   detached like a queued one. Back up now's failure must never show over another project (check the project, as
   `pressSave` does).
3. **The reopen path says so**: pass `{ flush: false }` from `reopenChangedProject` into the open, rather than inferring
   it from equal paths, and correct the comment that claims more than the check does.
4. **The same file by two spellings**: compare paths for the `closing` map the way the system does (case-insensitively
   on Windows, with separators made the same), so `Z:\Shoots\A.sbd` and `z:/shoots/a.sbd` wait for each other.
5. **A failed backup at a close** is dropped without a word, though the sign had promised it. Kevin: "A failed backup
   on a plain close is said in one status line the next time that project opens." Keep the failure on this computer
   (the app's own settings, by the project's path, never in the project file), say it once in the status line when
   that project next opens ("The backup asked for when {project} closed couldn't be made: {reason}" in en and es),
   then forget it. Never shown on another project. A test.
6. **Comments**: `saveShortcut.ts`'s note on `stopped` says Enter in a one-line field stops collecting; the code doesn't:
   make the comment true. `projectStore.ts`'s note claims a stalled share no longer holds the new project's edits: in
   the desktop app every open file shares one lock in Rust (`OpenFiles`, sbd.rs), so a stall inside one copy step
   still does; say so (a lock per file is a later item).
7. **A test of the wait**: open A, queue a hand copy with a gated copy, switch so A closes detached, then open A again:
   it doesn't resolve until the gate opens, and A's lock file exists afterwards.

Left as is (say so): shortcuts and Enter in a one-line field keep collecting in the gap (round 2's test); a queued
backup is lost when the whole app quits.

## Rules

No assertion from before #244, or of rounds 1 to 3, changes, except the two item 0 names. Words through `t()` in en and
es. Nothing stored changes.
No change to Rust. No new dependency. Don't touch `e2e/visual.spec.ts` or any baseline, CLAUDE.md, docs/PLAN.md,
docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/core/storage
src/app src/core/i18n`; end to end, alone, counts read from the output: `e2e/ctrlS.spec.ts e2e/projects.spec.ts
e2e/savedSign.spec.ts --project=chromium --workers=4`. Logs under `test-results/ctrl-s/` (names ending `-r4`). Never
start a command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; the new words in en and es; each new test's name and result; each check's
output line with counts.
