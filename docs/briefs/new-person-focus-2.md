# Brief: focus at once after "+ New person", after its review (6.27t, #230, round 2; Nov 20)

Work in the repo folder on branch `fix/new-person-focus` (already checked out; don't switch). Small changes and
tests. You never commit, push or merge. Read `docs/briefs/new-person-focus.md` on this branch first.

The review found nothing high or medium. Round 1 made it possible, for the first time, to press a button on a person
who has no record yet (the stand-in shown while the save is on its way). These are the edges that opened, all on the
path where the save is slow or fails.

## 1. Nothing is said or moved for an edit that changed nothing (`src/features/people/PeopleTile.tsx`)

- Delete person, and a character button in Plays, pressed on the stand-in: their edit is queued behind the create.
  If the create fails, the edit finds no record, changes nothing, and still resolves as done, so the tile says "Moved
  Unnamed to the Trash." (or that a part was taken from someone), moves the selection and the focus, and overrides
  the failure's own path.
- Make each of those say its notice, move the selection and move focus only when its edit really changed something.
  Find the smallest honest way with what `applyWith` gives back (the review read `projectStore.ts` as resolving true
  for an empty change list: check how the tile can tell, without changing the store's behaviour for anyone else; if
  it truly can't, stop and report what the store would need).
- When the create succeeds, a Delete or a cast pressed while it was on its way works as it does on any person.

## 2. "This is me" on a stand-in whose save fails

`setProjectSelf` (this computer's setting) would keep the id of a person who never existed. When the create fails
and "me" is the stand-in's id, "me" goes back to what it was before. When the create succeeds it stays, as today.

## 3. The stand-in belongs to its project

`pending` is the tile's own state and isn't tied to a project: switch projects while a create is on its way and the
other project shows an unnamed row and its editor until the dropped create resolves. Keep the project with the
pending id and show the stand-in only in that project.

## 4. On failure, focus moves only if it is still the stand-in's

Today the failure path calls `newButton.current?.focus()` wherever focus is. Move focus to the button only when
focus is inside the stand-in's editor (or nowhere: on the body) at that moment; if the person has gone elsewhere in
the app, leave their focus alone.

## Tests (`e2e/people.spec.ts`; these are this PR's own tests, added in round 1)

- **The slow-save test's double-click check** can't see a fourth create that lands later: after its present checks,
  wait out one more of its delays and assert that the count of edits that landed hasn't grown.
- **The failure test:**
  - assert that the app says the failure in words (the store's notice: find how other specs read it), once, and that
    the name field's blur adds no second notice;
  - type a name with no space in it, so a key can't press the button the focus lands on;
  - add: Delete person pressed on the stand-in before a failing create: no "Trash" notice, no selection change beyond
    the failure's own, no one in the Trash;
  - add: "This is me" pressed on the stand-in before a failing create: afterwards "me" is who it was before.
- **New:** with a slow save, Delete pressed on the stand-in and the create then succeeds: the person is made and then
  trashed (two steps in History), with the notice, as for any person.
- **New:** switch to another project while a create is held back (use the way the spec already opens a second
  project, if it has one; if switching projects in a spec needs more than a few lines, write this one as a unit test
  of the helper that decides whether the stand-in shows, and say so).
- No test outside this PR's own changes. If an existing assertion would have to change, stop and report.

## Checks to run

- `npx tsc --noEmit`, `npx eslint src/features/people e2e/people.spec.ts`.
- Unit: `node test-results/build627b/vitestUpper.cjs src/features/people`.
- End to end, alone, counts read from the output: `npx playwright test e2e/perspectiveViews.spec.ts
  e2e/people.spec.ts e2e/planLayers.spec.ts --project=chromium --workers=4`. Run `e2e/people.spec.ts` three times
  over (`--repeat-each=3`) once more, to see that the timing tests hold.
- Logs under `test-results/new-person-focus/`.

## Don't touch

The store (`src/app/projectStore.ts`) unless point 1 can't be done without it: then stop and report first. The
other tiles. CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No new dependency, no prettier, no new
words on screen (if one is truly needed, en and es, and say so). Never start a command with `python`. Nothing
fetched through npx.

## Report back

What each of the four points changed; each new or changed test's name and result (and the repeat run's counts);
each check's output line with counts; anything that failed on the way, by name.
