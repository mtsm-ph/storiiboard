# Brief: no section can be chosen while a project opens, after its review (6.27u, #231, round 2; Nov 20)

Work in the repo folder on branch `fix/section-while-opening` (already checked out; don't switch). You never
commit, push or merge. Read `docs/briefs/section-while-opening.md` on this branch first, and round 1's commit.

The review found one medium and four lows. Every path that puts a project in the store goes through the three
wrapped functions in `src/app/openFiles.ts` (checked: Open version too, through `openProjectFile`; no direct
`store.open(` anywhere else), so the wrapper itself stands.

## 1. Medium: the sidebar's rows of the project still open (`src/app/shell/sidebar/`)

Round 1 disabled the sections, the department workspaces and the person's own workspaces. The scene rows under
Storyboard, the board rows under Moodboard, and their "+ Add Scene" and "+ Add Board" rows were left enabled. On a
fresh open they don't exist yet, but on a switch from one open project to another (the switcher, the reopen after a
sync, a file handed over by the system) the old project's rows stay live for the whole open, and:

- the same lost click happens there (the scene list changes length when the new project arrives);
- a full click on a board row shows Moodboard for the new project with the old project's board id;
- Enter on a scene row chooses a workspace mid-open (the arrow keys now skip the disabled sections and land on rows);
- "+ Add Scene" pressed during a switch is dropped without a word.

Disable every one of those rows while a project opens, the same way as the sections (real `disabled`), and take
them back the moment the open ends, fails or is cancelled. `SceneList` and `BoardList` already take `canAdd`: give
them what they need, keep their props small.

## 2. Lows

1. **Focus given back.** A button that becomes disabled drops its focus to the body. When an open begins without a
   click in the sidebar (the reopen after a sync, a file handed over by the system) and focus is on a section or a
   row, it ends on the body. Remember where it was when the open began; when the open ends, if focus is still on the
   body (nothing else took it), give it back to that same section or row if it is still in the page, else to the
   section now current. Don't take focus from anywhere else.
2. **The close after a failed sync reopen.** In `src/app/projects/actions.ts`, when a reopen fails or is cancelled
   the project is closed after the count has already gone back to 0, with real I/O between. Count that close as
   opening too (wrap it the same way), so the sections stay disabled until the sidebar has shrunk.
3. **No hover on a disabled section.** The sections, department and own-workspace buttons use plain `hover:` classes,
   which still match a disabled button, so a section lights up under the pointer during an open and then ignores the
   press. Use the `enabled:hover:` form the scene and board rows already use. Nothing changes at rest; check that no
   screenshot can change (an enabled button looks the same; `e2e/visual.spec.ts` doesn't hover).
4. **Tests that pin each wrapped open.** `src/app/openFiles.test.ts`: the check that the flag is on at the moment the
   project arrives covers `openProjectFile` only. Add the same check for `createProjectFile` and for
   `reopenProjectFile`.

## Tests

- Round 1's end-to-end test stays. Add, in `e2e/projects.spec.ts`, a switch between two projects with the open held
  back (as round 1's test holds it): the old project's scene rows, board rows and "+" rows are disabled during the
  switch; a press on a board row released after the new project arrives chooses nothing; Enter on a row does nothing;
  once open, every row and section works. If making two projects in that spec takes more than a few lines, say how
  you did it.
- A unit or end-to-end test for the focus given back (a sync reopen started from code, as the review suggests:
  `projectStore.setState({ changedOnDisk: true })` in the memory build), and one for the close after a failed reopen
  if it can be made deterministic; if not, say why.
- No existing test or assertion changes. If one would have to, stop and report.

## Checks to run

- `npx tsc --noEmit`, `npx eslint` on the touched files.
- Unit: `node test-results/build627b/vitestUpper.cjs src/app`.
- End to end, alone, counts read from the output: `npx playwright test e2e/planLayers.spec.ts e2e/projects.spec.ts
  e2e/sidebar.spec.ts e2e/sections.spec.ts e2e/departmentWorkspaces.spec.ts e2e/manageWorkspaces.spec.ts
  --project=chromium --workers=4`, and any spec that covers boards in the sidebar.
- Logs under `test-results/section-while-opening/`.

## Don't touch

CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`, `e2e/visual.spec.ts` and its snapshots. No new
dependency, no prettier, no new words on screen. Never start a command with `python`. Nothing fetched through npx.

## Report back

What each point changed; each new test's name and result; each check's output line with counts; anything that
failed on the way, by name; and whether any screenshot could change.
