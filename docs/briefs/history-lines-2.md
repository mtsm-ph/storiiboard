# Brief: History lines, round 2 (#240): what the review found

Work in the repo folder on branch `feat/history-lines` (the main session checks it out for you; don't switch). You
write code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/history-lines.md`
(round 1) first, then the round-1 code: `src/features/history/summary.ts` (the move helpers, `moveWhere`,
`wholeSceneOnDay`, the fallbacks), `src/features/history/steps.ts` (`namedRecords` and its asks), `childrenBefore`
in `src/core/ops/ops.ts`, `src/features/history/historyLines.test.ts`.

The rule from round 1 stands: a line says where only when it can say it truly; otherwise today's words. Nothing
stored changes.

## 1. A scene dragged in a real file says where (medium)

A scene's parent is the project, and the project record is written straight into the file, not as an op
(`ensureProjectRecord`, src/core/storage/project.ts), so `recordsBefore` finds no project record until some edit
writes to it, and `moveWhere` returns null: in a fresh project, dragging SC 03 after SC 04 reads "Moved SC 03", and
two scenes read "Moved 2 scenes" without the place. The unit test passed only because it put the project into its map
by hand. The project as a parent needs no record (its words are fixed: "the project"); read scenes' neighbours the
same way as frames'. A test that reads the line back from a file (the "History as read from the file" group): a scene
moved to the start, a scene moved after another, two scenes moved together, in English and Spanish.

## 2. A neighbour deleted for good never makes a line name the wrong place (medium)

Empty Trash clears a purged record's before and after in every op and removes its row, so `childrenBefore` can't see
it, and the place is worked out without it: 4C dragged after 4A reads "Moved 4C to after 4A"; after 4A is trashed
and the Trash emptied, it reads "Moved 4C to the start of SC 04", which is false (or "after 4A" where it was after a
purged 4B). Say where only when the records as they were at that step are all still known: if any record that existed
at the step was deleted for good after it (look at what Empty Trash and Clean up leave in the log; say how you tell),
the line falls back to today's words ("Moved 4C"). A test of that scenario, and one where the purged record was
elsewhere (another scene), so the line still says where.

## 3. Spanish: "del proyecto" (low-medium)

`history.movedToStart` and `history.movedCountToStart` read "al principio de {place}" and `history.theProject` is
"el proyecto", so the line says "al principio de el proyecto". Give the project its own wording ("al principio del
proyecto"), and test the Spanish start-of-project lines.

## 4. The read's cost per edit (medium-low)

History and Notifications run `loadSteps` after every edit, and every move or scheduled-scene step on the page asks
`childrenBefore`, whose second half scans every op from that step's seq to the end of the log, so the work is (moves
on the page) × (ops after them), and an old drag under a big Restore to here (about 125k ops) is scanned whole, per
move, per edit. Make one scan per load serve every ask: from the oldest ask's seq, each op read once (and its
`json_extract` done once), then matched to the asks. Measure before and after on the memory driver with 20 move
steps on a page under 50,000 later ops; report both numbers. Every line must come out exactly as before. (A bound
that doesn't grow with the log needs an index on the ops' parent: a schema change that waits for Kevin; don't add
one.)

## 5. Smaller (low)

- **A drag in a file whose sort keys couldn't be read** writes the siblings' re-keys (`board.ts`, `rekeys`) in the
  same step, so a one-frame drag reads "Moved 5 frames to the start of SC 04". Count and place only what the person
  moved: the re-keyed siblings keep their order among themselves; the moved item is the one whose place among them
  changed. A test with such a file (search the existing tests for keys that can't be read).
- **The last fallback's nouns**: `count(type, …)` names board items "rectangles" and media (PDFs, links) "pictures",
  where other lines say items and attachments. Use the nouns the other lines use.
- **A page's move** names the deck bare ("to the start of Pitch") and an unnamed page "a page": name both the way the
  existing deck lines do (look at them; quote what they quote).

## Spanish: fix only the error, list the rest for Kevin

Change only item 3's grammar. In your report, quote each of these with the round-1 Spanish and a suggestion, for
Kevin to choose (don't change them):
- "Se cambió lente en 3 cuadros de ESC 12": no article; a suggestion: "Cambio de lente en 3 cuadros de ESC 12".
- "Se movió 4A después de 3C" can read as time; a suggestion: "a continuación de 3C".
- Two voices for one kind of step: the old keys when the place isn't known ("Movido: 2 cuadros") and the new ones
  when it is ("Se movieron 2 cuadros…").
- "en {scene}" in `changesIn` against "de {scene}" in `changedCountIn` and `changesOfIn`.

## Rules

Round 1's assertions stay, and no assertion from before #240 changes beyond the three round 1 changed (the old words
of these lines). Words through `t()` / `tn()` in en and es. No new dependency. Don't touch what is stored, undo and
redo, `e2e/visual.spec.ts` and every baseline, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No
prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; the whole unit suite (round 1 changed a moodboards test):
`node test-results/build627b/vitestUpper.cjs` with no folder; end to end, alone, counts read from the output:
`e2e/history.spec.ts e2e/notifications.spec.ts --project=chromium --workers=4`. Logs under
`test-results/history-lines/` (names ending `-r2`). Never start a command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed, and for item 4 the numbers before and after; the Spanish list for Kevin;
each new test's name and result; each check's output line with counts.
