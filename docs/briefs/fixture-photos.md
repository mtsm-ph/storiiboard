# Brief: test photos a script draws (Kevin, Nov 18 night 3; Nov 19)

Work in the repo folder, on the branch the main session names. Read CLAUDE.md first. Never commit, push or merge.
Use Edit and Write for every text change (no sed, no heredocs, no `prettier --write`). Logs and probes go in
test-results/. Only the specs named below run on this PC; the whole suite runs on GitHub.

## Goal

Six JPEGs in the repo are stills from films with real actors in them. Replace them with pictures a script in the
repo draws, so nothing in the repo is someone else's picture. The files keep their names; history is not rewritten.

| File | Size now | Profile now (APP2) | Used by |
|---|---|---|---|
| e2e/fixtures/images/photo-a.jpg | 967 × 523 | sRGB IEC61966-2.1, 3,144 bytes | deckExport, swatches, boardMedia, scoutPhotos specs |
| e2e/fixtures/images/photo-b.jpg | 967 × 521 | sRGB2014 (ICC), 3,024 bytes | deckExport, scoutPhotos specs |
| prototype/uploads/small_LF7JADRW.jpg | the same bytes as photo-a | | prototype/storiiboard-views.jsx |
| prototype/uploads/small_NVTE6ECR.jpg | the same bytes as photo-b | | prototype/index.html, storiiboard-views.jsx |
| prototype/uploads/small_EE2UMJ1P.jpg | 967 × 403 | sRGB2014, 3,024 bytes | storiiboard-views.jsx |
| prototype/uploads/small_KDGP7IMR.jpg | 967 × 410 | sRGB2014, 3,024 bytes | storiiboard-views.jsx |

Each is baseline JPEG, APP0 JFIF (16) then APP2 ICC_PROFILE, nothing else. Leave main's copies alone (this
branch is off v2; nothing on main changes).

## The script

- `scripts/fixturePhotos.ts`, run with `node scripts/fixturePhotos.ts` (as scripts/failedTests.ts is run). It
  writes all six files. Running it twice writes the same bytes (a seeded random generator; no clock, no
  `Math.random`). A comment at its top says why it exists (no one else's pictures in the repo) and how to run it.
- Drawing: in the Chromium that Playwright already installs (`@playwright/test` or `playwright-core`, whichever is
  already a dependency; nothing new), on a 2D canvas, encoded with `canvas.toBlob('image/jpeg', 0.9)`. Each picture
  looks like a photograph to the code that reads it: soft gradients for sky and floor, a few large shapes, and
  fine seeded noise so it has a photograph's detail (deckPictures' comparison needs that). Each of the six is a
  different scene, with clearly different colours: photo-a and photo-b must not match each other.
- Profiles: the script writes its own ICC v2 sRGB profile (header, `desc`, `cprt` saying it was made by this
  script, `wtpt`, `rXYZ`/`gXYZ`/`bXYZ` with the D50-adapted sRGB primaries, `rTRC`/`gTRC`/`bTRC` as a `curv` of the
  sRGB curve). Use one variant with a 1,024-entry curve for photo-a and its upload copy, and one with a 4,096-entry
  curve for the other four, so the two sizes the tests met before still differ. Insert it after APP0 as a single
  APP2 `ICC_PROFILE` block (sequence 1 of 1). No other blocks: the output must pass our own clean unchanged
  (src/core/media/cleanPicture.ts); add a Vitest test that runs all six through it and gets the same bytes back.
- Sizes exactly as in the table. Copies stay copies: small_LF7JADRW.jpg is photo-a's bytes, small_NVTE6ECR.jpg is
  photo-b's.
- A short README beside the photos (e2e/fixtures/images/README.md) lists each file, what made it, and that the
  other five fixtures there were made by hand on Nov 3 (adobe-rgb, alpha, p3-red, rotated, srgb).

## The tests that change

- **deckPictures.ts thresholds:** measure again, as its comment describes: each of the seven fixtures against its
  own stored copy, and each against every other resampled to its shape; photo-a and photo-b against their own copy
  must stay under half of MATCH_THRESHOLD (12) and over it against each other. Put the new numbers in the
  comment. If 12 no longer sits between them, stop and report: don't change MATCH_THRESHOLD.
- **Expectations that depend on the picture's content** (deckExport, swatches, boardMedia, scoutPhotos specs, and
  any Vitest test that reads these files): update the value to what the new picture gives, never loosen a check
  (no wider tolerance, no removed assertion, no `.soft` added). List every changed line in your report:
  file:line, old → new, and why it changed. A test that fails for another reason is a stop.
- Confirm no screenshot test shows these pictures (search the specs that call `toHaveScreenshot` for these file
  names and for the prototype). If one does, stop and report: a screenshot change goes to Kevin.

## Checks

- `node scripts/fixturePhotos.ts` twice; the six files' SHA-256 the same both times (paste them).
- `npm run lint`, `npx tsc --noEmit`, and Vitest for the files you touched or that read these pictures (run Vitest
  from `C:\` spelled upper case, as test-results/build627b/vitestUpper.cjs does).
- End to end, Chromium only, these specs alone: `npx playwright test e2e/deckExport.spec.ts e2e/swatches.spec.ts
  e2e/boardMedia.spec.ts e2e/scoutPhotos.spec.ts --project=chromium`. Paste passed, failed and flaky counts and
  `npm run failed-tests` right after the run.

## Don't touch

- MATCH_THRESHOLD, ASPECT_TOLERANCE, COMPARE_EDGE; the five hand-made fixtures; any screenshot baseline; CI; .claude;
  CLAUDE.md, PLAN.md, HANDOFF.md; anything on main; no new dependency.

## Report

The six SHA-256s; the measured numbers; every changed expectation (old → new, why); the check results with counts;
anything you were unsure of.

## Round 2 (main session, Nov 19): the review's low findings

- scripts/fixturePhotos.ts: each tag's size in the tag table is its data without padding (desc 139, cprt 87; the
  next offset still steps to a multiple of 4), as ICC's tag table describes. Rerun the script; all six pictures
  change bytes. Keep D50 for `wtpt` as it is.
- e2e/fixtures/images/README.md: "running it again writes the same bytes" says "in the same Chromium version";
  "no picture here is anyone else's" says the pixels are drawn here, and that adobe-rgb.jpg and p3-red.jpg carry
  colour profiles (data, not pictures) made by others, as embedded in many files.
- e2e/deckExport.spec.ts:485: wrap the comment to about 120 columns (comment only).
- Checks: the script twice (same six SHA-256s; paste them), `npm run lint`, Vitest on scripts/fixturePhotos.test.ts
  and cleanPicture.test.ts, then the four specs in Chromium alone and `npm run failed-tests`.
