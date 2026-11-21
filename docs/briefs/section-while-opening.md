# Brief: a section chosen while a project opens (Kevin, Nov 20)

Work in the repo folder on branch `fix/section-while-opening` (already checked out, made from `v2`; don't switch).
You reproduce first, then fix the app, add a test and run the checks below. You never commit, push or merge. Read
CLAUDE.md's Workflow and Safety sections first.

## What happened

On checkpoint nov20-a (GitHub's Mac, WebKit), `e2e/planLayers.spec.ts` › "hides, locks, dims and solos layers, starts
a gaffer on lighting and grip, keeps the state, and writes no History" was flaky at its line 220. The lines:

```ts
  // A reload keeps the state: it is this computer's.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();   // line 220: timed out
```

What the failed try's page looked like at the end (its snapshot is in
`test-results/nov20a-macres/e2e/planLayers-hides-locks-dim-f5c7e-state-and-writes-no-History-webkit/error-context.md`
on this PC, with the trace beside it):

- the project was open (its name in the top bar, its scene in the sidebar);
- the sidebar's **Setup** button had focus, so the click on it did land;
- but the workspace on screen was **Storyboard** (`region "Storyboard workspace"`), not Setup.

So the section was clicked while the project was still opening, and when the project was open the app showed
Storyboard. A person can do the same on any slow open.

Kevin, Nov 20, his words:

> planLayers line 220 (Setup clicked while the project was opening, then Storyboard shown): a person can do that on
> any slow open, so fix the app. Either a section can't be chosen until the project is open, or the one chosen is
> kept: pick the smaller and say which.

## 1. Reproduce and find the cause first

The cause is not known. Where to look:

- `src/app/shell/AppShell.tsx`: `selectWorkspace` (calls `showWorkspace(id)`), `showProjects`, and the lines under
  "A project opening or switching leaves the Projects screen for its workspace".
- `src/app/shell/workspaceStore.ts`: `showWorkspace`, and `active`, which starts as `'storyboard'`.
- `src/app/shell/sidebar/Sidebar.tsx` and what it does with a section's click when no project is open.
- `src/app/openFiles.ts` (`replaceWith`, `store.getState().open(project)`), the project store's `open`, and
  `src/app/projects/` (the Projects screen and its actions) for anything that sets the workspace or remounts the
  shell when a project arrives.

Reproduce it in Chromium: after a reload, click the recent project and then the Setup section while the open is
still under way. Make the open slow rather than racing it (CPU throttling through Playwright's CDP session in
Chromium, or a delay wrapped around the open from the page: look at what the specs already do). A throwaway script
under `test-results/section-while-opening/`, never in `e2e/`. Say in your report exactly what happens, step by step:
which code ran on the click, and what put Storyboard on screen afterwards.

If you cannot reproduce it after a fair try (say so with what you tried), stop and report what you found by reading:
don't fix by guesswork.

## 2. Fix the app

Kevin gives two acceptable outcomes; build the smaller one and say which:

- **A section can't be chosen until the project is open:** while a project is opening, the sidebar's sections don't
  take a click or a key (and say so to assistive technology: disabled, not just ignored), and take them again the
  moment it is open or the open fails.
- **The one chosen is kept:** a section chosen while a project opens is the workspace shown when it is open.

Either way:

- When the open fails or is cancelled, the app is as it was before the open began, as today.
- The keyboard shortcuts for workspaces behave like the clicks.
- Switching from one open project to another opens the other in place, as today (CLAUDE.md, Navigation). Say what
  your fix does there when a section is chosen during the switch.
- No section is ever left looking current while another workspace is shown.
- Don't change `e2e/planLayers.spec.ts`: it does what a person does and must pass as it is.

## Test to add

One end-to-end test, deterministic (the open made slow as in your reproduction, with no fixed waits), in the spec
that covers the sidebar or opening a project (find it; say which): the section chosen during the open is what the
rule you built says (kept and shown; or not choosable until open, then choosable). It fails before the fix. Unit
tests for any pure helper. No existing test or assertion changes; if one would have to, stop and report.

## Checks to run

- `npx tsc --noEmit`, `npx eslint` on the touched files.
- Unit: `node test-results/build627b/vitestUpper.cjs src/app` (this shell's lower-case drive letter makes plain
  Vitest fail every file; that helper runs it from `C:\`).
- End to end, alone (nothing else running, no edits meanwhile), counts read from the output, not the exit code:
  `npx playwright test e2e/planLayers.spec.ts <the spec you added to> <the specs of the sidebar and of opening
  projects> --project=chromium --workers=4`.
- Logs and the reproduction go under `test-results/section-while-opening/`.

## Don't touch

- CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, `.github`, `.claude`.
- No new dependency. No prettier. Single quotes, about 120 columns, comments that say why.
- Every word people see comes from `t()` in en and es. If the fix needs a new word (a disabled section's title, say),
  add it in both and list it in your report.
- If the fix changes how any screen looks at rest (a screenshot would change), stop and report before building it.
- Never start a command with `python`. Nothing fetched through npx. Nothing from `private/samples`.

## Report back

The cause, step by step; which of Kevin's two outcomes you built and why it is the smaller; what changed; the new
test's name and result; each check's output line with counts; every test that failed on the way, by name.
