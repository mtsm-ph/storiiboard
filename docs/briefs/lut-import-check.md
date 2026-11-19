# Brief: LUTs under the hash rule at import; JFIF and Adobe blocks at their fixed sizes (Kevin, Nov 18 night 4; Nov 19)

Work in the repo folder, on the branch the main session names. Read CLAUDE.md first, then docs/SBD_FORMAT.md's
`luts` table and its "Import" rule for stored files (6.27b), then docs/briefs/6.27b-clean-pictures.md for how the
picture doors were built. Never commit, push or merge. Use Edit and Write for every change (no sed, no heredocs, no
`cargo fmt` or `prettier --write` writes). Logs and probes go in test-results/. Only the specs named below run on
this PC.

## Part 1: a damaged LUT is left out at import

6.27b made the rule for stored pictures: bytes that don't match their hash are never stored, under any name, and
the rest of the project still imports (src/core/storage/projectJson.ts `leaveOutDamagedFiles`; the doors in
src/core/storage/driver.ts and src-tauri/src/sbd.rs refuse a mismatched row whole; the notice in
src/app/projects/leftOutFiles.ts names the places). LUTs get the same rule (Kevin, Nov 18 night 4):

- **Leave it out.** In Import project data, a `luts` row whose `cube` text doesn't hash (SHA-256 of its UTF-8 bytes,
  as src/core/media/lut.ts stores it: check that is how it hashes) to its `sha256` is left out, in the same pass as
  media_files (one function or a sibling of `leaveOutDamagedFiles`, your call; say which). A row it can't read is
  left as it is, for fillStatements to refuse, as with pictures.
- **The doors.** The import's door refuses a `luts` insert whose `cube` doesn't match its `sha256`, whole, in both
  readers (sbd.rs's import path and driver.ts / memoryDriver.ts), as it does for media_files; the ordinary door
  does the same if it can, cheaply (a LUT is at most 16 MB of text; it's hashed once). Add the luts statements the
  app makes to src-tauri/testdata/picture-statements.json (or a sibling list if the file's name makes that wrong:
  say which) so both readers are tested against the same list, and the static scan and the memory driver's run-time
  check cover them. Every statement the app makes on `luts` must be on the list.
- **What the person sees.** The video keeps its `lut` id. With its row gone, the video plays **ungraded** and never
  reuses a playback copy made with that LUT: check how src/app/playback.ts, src/core/media/video.ts and lut.ts behave
  when the id names no row (the copy's key carries the LUT's SHA-256: src-tauri/src/playback.rs `key_of`), and make
  the missing case play the ungraded copy, never the graded one. The Inspector's LUT row says the LUT is no longer
  in the project rather than showing a blank or a stale name; a frame grabbed from it earlier keeps its stored
  `lut_name` (it's a record of what was used).
- **The notice.** The import's notice counts and names it like a picture: "1 of 3 LUTs was damaged and left out."
  (tn, en and es; Spanish "LUT" as the app already writes it), with the places: each video that used it, named as
  leftOutFiles names a frame's place (the frames that play that video). Copy list carries every place. Keep the
  sentence's shape the same as the pictures' one, in one notice when both happen.
- **Tests:** Vitest for the leave-out (a damaged row out, a good one kept, an unreadable one left for
  fillStatements, the report's counts), both doors (Rust and TypeScript, from the shared list), the notice's words
  in en and es, and the ungraded-playback choice. One end-to-end test in e2e/projects.spec.ts beside the damaged
  picture test: a JSON with one damaged LUT imports, the notice names it, and the video's Inspector says its LUT is
  gone.
- docs/SBD_FORMAT.md: the import rule for stored files names LUTs too.

## Part 2: JFIF and Adobe blocks only at their fixed sizes, once each (Kevin, Nov 19, LOW)

Today the keep-list keeps an APP0 JFIF block at any size and an APP14 Adobe block as often as they come. Keep JFIF
only without a thumbnail (segment length 16) and Adobe only at its fixed size (segment length 14), each at most
once; anything else is removed by the clean and refused by the doors, on both sides: src/core/media/cleanPicture.ts
and src-tauri/src/picture_door.rs, with the shared tests that check both agree. Then:

- Confirm the pictures the app makes still pass unchanged (Chromium's and WebKit's canvas JPEGs: the WebKit
  fixtures in src-tauri/testdata/pictures, and the e2e fixtures), and say whether the real-JPEG guard
  (`SB_SAMPLE_JPEGS`, src-tauri/src/exif.rs) is affected: it isn't run by you, the main session runs it.
- Old pictures come in through the import's door, which checks hashes, not blocks: confirm that is still so, so an
  older project with a JFIF thumbnail still imports.
- docs/SBD_FORMAT.md's keep-list says the sizes.

## Checks

- Rust: `cargo test` from src-tauri as the repo's scripts run it, and `npm run lint:rust`. Paste counts.
- `npm run lint`, `npx tsc --noEmit`, Vitest for every file you touched and their neighbours (run Vitest from `C:\`
  spelled upper case, as test-results/build627b/vitestUpper.cjs does). Paste counts.
- End to end, Chromium only, alone: `npx playwright test e2e/projects.spec.ts e2e/scoutPhotos.spec.ts
  e2e/deckExport.spec.ts --project=chromium`, then `npm run failed-tests`. Paste counts.

## Don't touch

- The schema and migrations (no new table or column: if the work seems to need one, stop and report); screenshot
  baselines (if a screenshot would change, stop and report); CI; .claude; CLAUDE.md, PLAN.md, HANDOFF.md; any
  dependency.
- Existing tests and assertions: never weaken, skip or delete one. If one must change, stop and report why first.

## Report

What was built, file by file; how a missing LUT plays and why it can't reach the graded copy; the statements added
to the shared list; the JFIF/Adobe change and what it removes; every check with counts; anything unsure.

## Round 2 (main session, Nov 19): a missing LUT plays ungraded

Kevin's rule (Nov 18, night 4) decides it: a video whose LUT is no longer in the project plays ungraded and never
reuses a playback copy made with that LUT. That replaces the 2.5 behaviour, so this round changes one existing test
by name, as the brief now asks:

- src/features/video/playbackCopies.ts `withLut`: when `lutForCopy` returns null because the row is gone (not when
  a stored cube can't be read: that stays a refusal), return `{ videoId, path, lut: null }`, so the copy's key has no
  LUT and only the ungraded copy can be found or made.
- src/features/video/playbackCopies.test.ts, "cancels a graded copy by its LUT, and refuses to make one whose LUT
  isn't stored": the part about a missing LUT now asserts the opposite: `driver.make` (and `find`) are called with
  `lut: null` and the state is the ungraded copy's, never `failed`. Keep its name's first half and its cancel part
  as they are; rename it to say what it now checks. Add a test that a stored cube that can't be read still refuses.
- grabStill.ts and saveClip.ts keep refusing a missing LUT with their words (a grabbed still or a saved clip says
  which LUT it used, so it can't quietly go ungraded).
- The Inspector already says "LUT not in the project": the end-to-end test also checks the clip plays (its preview
  reaches `readyState` 2 or more) with the LUT gone.
- Checks as before, plus `npx playwright test e2e/lut.spec.ts e2e/player.spec.ts --project=chromium` alone, then
  `npm run failed-tests`.

## Round 3 (main session, Nov 19): the review's low findings

- L1. src/core/storage/projectJson.ts `leaveOutDamagedLuts` pushes `''` for a row with no string id, and
  src/app/projects/leftOutFiles.ts `lutPlaces` then matches every holder whose `lutId` is null (`?? ''`). Push only
  string ids (a row with no id is still left out and still counted), and match only `lutId !== null &&
  left.has(lutId)`. Test: a records set with one picture frame and a report with `lutsLeftOut: ['']`, `luts: 1`:
  `leftOutPlaces` names nothing.
- L2. Words that are now false (en and es, new keys; keep the old key where it is still true):
  - grabStill.ts, a video whose LUT row is gone: "This video's LUT is no longer in the project, so a graded still
    can't be made. Choose its LUT again, or set it to None." (es: "El LUT de este vídeo ya no está en el proyecto, así
    que no se puede hacer un fotograma graduado. Vuelve a elegir su LUT o ponlo en Ninguno."; match the app's
    Spanish for "None" and "LUT" as it already writes them).
  - playbackCopies.ts `withLut` and anything else that refuses a stored cube it can't read: "This video's LUT can't
    be read, so its playback copy can't be made." (es: "No se puede leer el LUT de este vídeo, así que no se puede
    hacer su copia de reproducción."; match the app's existing Spanish for "playback copy").
  - Any test asserting the old sentence for these two cases changes with it: list each (file:line, old → new). A
    test asserting the old sentence for a case where it is still true stays.
- Nits: docs/SBD_FORMAT.md's luts door sentence says the import's door refuses a migration's CREATE (only the
  ordinary door takes it), wrapped to about 120 columns; sbd.rs's doc comments on `plain_insert` and `PlainInsert`
  name `luts`.
- Checks: `npm run lint`, `npm run test:rust`, Vitest on src/core/storage, src/app/projects, src/features/video,
  src/core/i18n (from `C:\` upper case), then `npx playwright test e2e/projects.spec.ts e2e/lut.spec.ts
  --project=chromium` alone and `npm run failed-tests`.
