# Brief: the wording small fixes (Kevin, Nov 19)

Branch `polish/wording-nov19`, from `v2`. Work in the repo folder. Read CLAUDE.md first. Never commit, push or merge.
Use Edit and Write for every change. Logs and probes go in test-results/. Every word people see comes from
src/core/i18n/locales/en.ts and es.ts through `t()`/`tn()`. Entries under `error.` match English messages raised in
Rust, so a Rust message and its `error.` key change together. Write the Spanish as es.ts already does, with the same
terms ("copia de reproducción" and so on, as es.ts has them).

## The four fixes

1. **A count of one reads as a sentence.** `projectJson.lutsLeftOut` (src/app/projects/leftOutFiles.ts:105) says
   "1 of 1 LUTs was damaged and left out." When the project had one LUT and it was left out, it says "The LUT was
   damaged and left out." (a new key, in es too). Counts above one, or one of several, stay as they are.
2. **A message names what was being made: a still, a clip or a playback copy.**
   - `error.lutUnreadable` ("This video's LUT can't be read, so its playback copy can't be made.") is raised for a
     still and a clip too. Find every place in Rust that raises it, and every LUT message raised while making a
     still, a clip or a playback copy (`error.lutGone`, `saveClip.lutMissing` and any other). Each names the one that
     was being made.
   - Proposed English: "This video's LUT can't be read, so the still can't be made." / "…so the clip can't be made." /
     "…so its playback copy can't be made." Keep the existing ones that already name the right thing.
   - Rust tests: each path gives its own message.
3. **A stalled encoder says the encoder stopped responding and to try again, with no drive.** In
   src-tauri/src/playback.rs, `STALLED` ("That video stopped being read partway. If it's on a card, a drive or a
   network share…") is the message for every stall, including an encoder hung in its driver. The code already tells
   the two apart: on `Stop::Stalled` it asks whether the original still answers (`video::starts(path)`, around line
   1352).
   - Original no longer answers: the read stalled, and `STALLED` stays.
   - Original still answers, and no encoder was left to try: the encoder stopped responding. New message, proposed
     "The video encoder stopped responding. Try again." It mentions no card, drive or share.
   - The "later attempt failed after a stall" case (around line 1397): use the encoder message when the stall it
     points to was an encoder's (the original still answered), else `STALLED`.
   - An `error.` key in both languages. Rust tests for both outcomes, built as the existing stall tests are (their
     shims). The existing tests that expect `STALLED` must still hold for a read stall. If one of them is really an
     encoder stall, stop and report it: never change its assertion yourself.
4. **grabStill's new words get a test.** Find each message src/features/video/grabStill.ts can show (from #201 and
   since) that no test in grabStill.test.ts asserts, and add a test for each, showing when it appears.

Out of scope: "This picture is no longer in the project." It goes with the stacked screenshot milestones.

## Report

A table of **every string changed or added**, key by key, old and new, in English and Spanish. It goes into the PR
description as it is. Also every file changed, and the check counts.

## Checks (paste counts)

`npm run lint`, `npx tsc --noEmit`, `npm run test:rust`, `npm run lint:rust`, Vitest on every touched file and its
neighbours plus the i18n tests (from `C:\`, upper case), then `npm run failed-tests`. If a string appears in an e2e
spec, run that spec in Chromium alone. If a screenshot would change, stop and report.

## Don't touch

Screenshot baselines, CI, .claude, CLAUDE.md, PLAN.md, HANDOFF.md, dependencies, the schema. Never weaken, skip or
delete an existing test or assertion.
