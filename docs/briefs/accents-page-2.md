# Brief: the page stands in for the accent worker, after its review (6.27r, #229, round 2; Nov 20)

Work in the repo folder on branch `fix/accents-page` (already checked out; don't switch). Small changes and tests.
You never commit, push or merge. Read `docs/briefs/accents-page.md` on this branch first: it is what this round
tightens. The review found nothing high or medium; these are its lows.

## 1. Guards that only a by-hand check gave

1. **The worker's bundle stays small.** Add a unit test (beside `src/ui/theme/generator/sample.test.ts` or
   `src/core/media`): `src/core/media/makeCanvas.ts` has no `import` statement at all, and
   `src/ui/theme/generator/sample.ts` imports `makeCanvas` from that file and nothing from `canvas.ts`. Read the two
   files as text, the way other tests in the repo read sources. Say why in the test's name: the accent worker shares
   sample.ts and must not take the translations into its bundle.
2. **The script's flag, automated.** Add a unit test that runs `scripts/launchCheck.sh` with a stand-in for the app
   (a small shell script the test writes into a temp folder under `test-results/`, executable, that prints the lines
   it is told to and exits with the code it is told to):
   - a plain `launch check: accents ok` … `launch check: passed`, exit 0: the script exits 0, with and without the
     flag;
   - the by-the-page line, exit 0: without the flag the script exits 1 and says `the accents came from the page, not
     the worker`; with `--accents-by-page-ok` it exits 0 and says the warning with the note;
   - an unknown flag, no path, two paths: exit 1 with the usage line;
   - the stand-in exits 16 after `FAILED at accents: …`: the script exits 1 and the flag changes nothing.
   It needs bash and an executable file, so it runs where the unit tests run in CI (Linux) and on a Mac; on Windows it
   is skipped by platform, with the reason in its name or beside it. This PC is Windows, so say plainly that it was
   skipped here and will first run in the PR's own checks; try it once by hand through Git Bash and report the
   result.

## 2. Outcomes of the accents step that are right but not pinned (`src/app/launchCheck/launchCheck.test.ts`)

New cases only:

- The worker fails at `canvas`, at `draw` and at `read`, and the page then fails with no stage: failed, with #223's
  line (`…(worker: <stage>); on the page: failed: <words>`).
- The same three, and the page gives no answer in 10 s: failed, `…; on the page: no answer in 10 s`.
- The worker fails with a stage that is not one of the four (for example `elsewhere`) and the page reads 3 accents:
  failed, with `(worker: no stage)`. (A version that read the raw `stage` property would pass by the page.)

## 3. The note stays whole

`src-tauri/src/launch_check.rs` cuts a note at 300 characters, so a long engine message repeated by the second ask
can lose the "asked again" part, which is the part the second ask exists for. In `launchCheck.ts`, when the second
answer is word for word the first failure (the same words and stage), the note says `the worker asked again: the
same`. Any other second answer is written as it is today. Update the tests of the note that pin a repeated failure
(they are this PR's own, added in round 1) and add one for a different second failure, which is still written out.

## 4. The script (`scripts/launchCheck.sh`)

- The search for the by-the-page line reads the log as text whatever bytes it holds (`grep -a`, which the Mac's and
  Git Bash's grep both have).
- The pattern that takes the note out of the line holds an unquoted `(`: quote the pattern so no bash has to guess
  (`${by_page#'launch check: accents ok ('}`), and check the result on Git Bash with the stand-in.
- Nothing else in it changes.

## 5. Two comments

- `launchCheck.ts`, the comment that says extractAccents falls back "on all three": it now also falls back on a
  reported error; make the sentence true.
- `extract.test.ts`: the test renamed in round 1 sits under "extractAccents, as before" though its behaviour is new:
  move it into the "when the worker reports an error (6.27r)" group, unchanged.

## Checks to run

- `npx tsc --noEmit`, `npx eslint` on the touched files, `bash -n scripts/launchCheck.sh`.
- Unit: `node test-results/build627b/vitestUpper.cjs src/ui/theme/generator src/app/launchCheck src/core/media
  scripts` then the whole suite once: `node test-results/build627b/vitestUpper.cjs`.
- Rust only if you touched it (you shouldn't need to): `cargo test launch_check` from `src-tauri`.
- Logs and stand-ins under `test-results/accents-page/`.

## Don't touch

The rule itself, Rust's bound, checkpoint.yml, the end-to-end specs, CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md,
docs/ALPHA_TEST.md, `.claude`. No new dependency. No prettier. Never start a command with `python`. Nothing fetched
through npx.

## Report back

Each new test's name and result (and for the script's test: skipped here or run, and the by-hand result); the note's
new form with an example; the script's two changed lines; each check's output line with counts.
