# Brief: the name field has focus at once after "+ New person" (Kevin, Nov 20)

Work in the repo folder on branch `fix/new-person-focus` (already checked out, made from `v2`; don't switch). You
measure first, then fix the app, add tests and run the checks below. You never commit, push or merge. Read CLAUDE.md's
Workflow and Safety sections first.

## What happened

On checkpoint nov20-a (GitHub's Mac, WebKit), `e2e/perspectiveViews.spec.ts` › "a gaffer sees Grip & electric first,
the rest under Rest of crew; Full view shows every department again" was flaky: the person typed as "Sam Ortiz" was
saved as "am Ortiz". The spec's `addPerson` clicks "+ New person" and types the name straight away, as a person does.

Why a letter can be lost: `src/features/people/PeopleTile.tsx`, the New person button. Its click starts the edit
(`edit(...)`, which is `projectStore.getState().applyWith`, the op and its save), and only when that promise
resolves does it call `setChosen(id)` and then, one animation frame later, `nameField.current?.focus()`. Until then
the button still has focus, and a key typed in between goes to the button.

Kevin, Nov 20, his words:

> perspectiveViews (the lost first letter): measure how long the name field takes to get focus after "+ New person",
> in both engines. About 100 ms or less: no person can lose a letter, so the test waits for the focus. More, or it
> waits on the save: fix the app so the field has focus at once.

It waits on the save, so the app is fixed. The measurement is still wanted, for the report.

## 1. Measure first (before changing anything)

- In Chromium and in WebKit, in a dev build opened with `?files=memory` as the specs do: the time from the click on
  "+ New person" to the name field's `focus` event, 20 times in each engine, on a project like the spec's.
- A throwaway Playwright script or spec under `test-results/new-person-focus/` (never in `e2e/`); take the times
  inside the page (`performance.now()` in a click listener and a focus listener), not across the protocol.
- Playwright's WebKit on Windows is not the Mac's, and the suite doesn't run in it here. Try it for this one screen;
  if the app doesn't start in it, say what failed and give Chromium's numbers alone.
- Report per engine: fastest, median, slowest, and how much of it is the save (the time until the `edit` promise
  resolves) against the animation frame after it.

## 2. Fix the app: focus at once

The rule to meet: when the click on "+ New person" has been handled (its event handler has returned and React has
committed what it set), the new person's name field is the active element. Nothing a person types after the click
goes anywhere else, however long the save takes.

- Read how `applyWith` updates the store before choosing: if the records the tile reads change before the write is
  awaited, selecting the new person and focusing the field in the same commit may be all it takes. If they change only
  after the save, the tile has to show the new person's field before the record is there. Pick the smallest change
  that meets the rule, and say which it was.
- What must stay true:
  - Making the person is still one op in History, undone by one undo; typing the name is the edit it is today.
  - A double click still makes one person (the `making` guard, or what replaces it).
  - What was typed before the save landed is kept: the record arriving must not wipe or replace the field's text.
  - If the edit fails (it resolves false, and the app says so in words, as today), no person appears, nothing typed
    is saved anywhere, and focus goes back to the "+ New person" button.
  - Enter, Escape and Tab in the name field do what they do today.
  - The list's selection (`chosen`) and the editor show the new person, as today.
- Don't change the spec's `addPerson`: it types the way a person does, and must now pass as it is.
- Other tiles may give focus the same late way after a save (a new location, gear item, shoot day, scene). Don't
  change them here. List every place you find with the same pattern (file and line) in your report.

## Tests to add

1. End to end (find the spec that covers the People tile, or add to `e2e/perspectiveViews.spec.ts` if there is
   none): in one `page.evaluate`, click the "+ New person" button (`element.click()`) and return, in the same turn,
   what `document.activeElement` is: it is the name field. Before the fix this fails, since focus waited on a
   promise. Then type a name with no wait and check the person's name has its first letter.
2. The same once more with the save made slow, so the test doesn't pass by luck: find how the specs or the dev build
   can delay a write (look at how other specs or the memory file driver do it; a wrapper put on from the page is
   fine). If there is no way without changing shipped code, say so and leave this one out: don't add a test-only
   hook to the app.
3. A failed edit: only if the existing tests have a way to make an edit fail; then: no person, focus back on the
   button.
4. Unit tests for any pure helper you add.

No existing test or assertion changes. If one would have to, stop and report.

## Checks to run

- `npx tsc --noEmit`, `npx eslint` on the touched files.
- Unit: `node test-results/build627b/vitestUpper.cjs src/features/people` and any other folder you touched (this
  shell's lower-case drive letter makes plain Vitest fail every file; that helper runs it from `C:\`).
- End to end, alone (nothing else running, no edits meanwhile), counts read from the output, not the exit code:
  `npx playwright test e2e/perspectiveViews.spec.ts <the People spec, if another> e2e/planLayers.spec.ts
  --project=chromium --workers=4` (planLayers.spec adds a person the same way).
- Logs and the measuring script go under `test-results/new-person-focus/`.

## Don't touch

- CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, `.github`, `.claude`.
- No new dependency (no DOM testing library). No prettier. Single quotes, about 120 columns, comments that say why.
- Every word people see comes from `t()` in en and es; this change should add none.
- Never start a command with `python`. Nothing fetched through npx. Nothing from `private/samples`.

## Report back

The measurements (per engine: fastest, median, slowest, and the save's share); what you changed and why it is the
smallest that meets the rule; each new test's name and result; each check's output line with counts; the list of
other places with the same late focus; every test that failed on the way, by name.
