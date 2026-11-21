# Brief: Ctrl+S, round 3 (#244): what the re-review of round 2 found

Work in the repo folder on branch `feat/ctrl-s` (the main session checks it out for you; don't switch). You write
code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/ctrl-s.md` and `-2.md`
first, then `src/core/storage/backups.ts`, `src/core/storage/project.ts`, `src/app/projectStore.ts` (`open`,
`close`, `enqueue`, the reopen path), `src/app/projects/actions.ts`, `src/app/shell/saveShortcut.ts`.

## 1. Kevin's rule stays; the test says what it proves (decision)

A press may still replace a copy a tick wrote itself (Kevin's plan: "was itself a timed or hand backup"), and the next
tick then adopts it, so someone pressing just before each tick keeps one copy per two intervals. That follows Kevin's
rule as written; the main session puts the question to him. Change nothing in the rule. Rename the round-2 chain test
so its name claims only what it shows (each interval keeps a copy when the presses come after the ticks), and add a
test that pins today's behaviour for a press replacing a tick's own copy, so a later change is a decision.

## 2. A backup at close must never flag the new project, nor make its edits wait (medium)

Round 2 runs a queued hand backup in `close()`, which `open()` awaits inside the edit queue after the new project is
already set:
- a failure there goes to `onError`, which sets `changedOnDisk` on the store, so it lands on the project just opened
  (after a sync replaced the file, the reopened good version shows "Not saved: The project file changed on disk…"
  and a later real replacement is never noticed);
- every edit of the new project waits for the old project's full copy (on Windows a large project, or a share that
  stalls), against "no edit waits more than about 100 ms".

Make the queued backup run before a switch starts and outside the edit queue, or detached from the new project's
queue, whichever fits `projectStore` best; never when the old file was replaced on disk (the reopen path: that file
is no longer the project); and its errors never reach the open project's state (check that the schedule still belongs
to the open project, or drop them with a quiet note). Say which you chose and how the lock file and the reopen path
stay right. Tests: a switch with a hand backup queued doesn't hold the new project's first edit behind the copy (a
fake slow copy); a failed flush doesn't set `changedOnDisk` on the new project; the reopen path makes no flush.

## 3. Keys typed in the gap (low)

- Backspace and Delete in the gap are replayed in order (`execCommand('delete')`, `execCommand('forwardDelete')`),
  and Enter in a textarea as a line break; at any other key that doesn't type (Tab, an arrow, Escape, a shortcut),
  stop collecting and drop what follows it, so nothing lands in a field the person meant to leave.
- Count AltGr only by `event.getModifierState('AltGraph')` where the engine gives it, so Ctrl+Alt+letter isn't typing.
- A pointerdown anywhere ends the gap (WebKit on a Mac doesn't move focus on a click).

## 4. Smaller (low)

- A field drawn anew whose commit tidied its value (`toUpperCase` for a scene number, a trim for a name) is still
  found: match the value as the commit leaves it (case-insensitively and trimmed), still within its tile and still
  only when exactly one matches.
- `flushQueued` when the queued copy has already started: wait for that copy in its turn before the file closes.
- Say in a comment that `stopImmediatePropagation` can't stop capture-phase window listeners registered before the
  shell's (today those handle only Escape or track keys).

Left as is (say so): a queued backup is lost when the whole app quits (no close-requested handler; a later item).

## Rules

No assertion from before #244, or of rounds 1 and 2, changes, except the round-2 chain test's name (item 1). Words
through `t()` in en and es. Nothing stored changes. No new dependency. Don't touch `e2e/visual.spec.ts` or any
baseline, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; `node test-results/build627b/vitestUpper.cjs src/core/storage
src/app src/core/i18n`; end to end, alone, counts read from the output: `e2e/ctrlS.spec.ts e2e/projects.spec.ts
e2e/savedSign.spec.ts` and any spec of project switching you touch, in Chromium, and `e2e/ctrlS.spec.ts` in WebKit
on Windows, `--workers=4`. Logs under `test-results/ctrl-s/` (names ending `-r3`). Never start a command with
`python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; each new or renamed test's name and result; each check's output line with
counts.
