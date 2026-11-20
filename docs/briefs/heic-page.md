# HEIC on Windows, part 2: the page asks Rust for a HEIC it can't read (6.27n): brief

Kevin, Nov 19 and 20. Part 1 (`docs/briefs/heic-rust.md`) built the command `heic_picture` and a caller nothing uses
yet, `src/app/heicPicture.ts`. This part wires it in, counts photos in the status line, and proves the colour end to
end. The plan is `docs/briefs/heic-windows.md`; where it and this brief differ, this brief is the newer one.

## Goal

A HEIC added on Windows imports like any picture: the webview can't decode it, so the page asks Rust for a tagged PNG
and goes on exactly as before (the P3 canvas, the clean, the hash, the thumbnail). The Mac changes nothing. While
several files are being added, the status line counts them: "Reading 3 of 30…".

## Decisions

- **Where:** `prepareImage` in `src/core/media/image.ts`, in the `catch` after `createImageBitmap` fails. Nothing
  else about `prepareImage` changes.
  - The file doesn't look like a HEIC: today's line, unchanged.
  - It looks like a HEIC and no decoder was handed over (the browser build, the tests' memory build): today's HEIC
    line, unchanged, character for character. `e2e/pictures.spec.ts`, `e2e/media.spec.ts` and
    `e2e/scoutPhotos.spec.ts` assert it and stay as they are.
  - It looks like a HEIC and there is a decoder: the decoder gets the file and gives a PNG's bytes; the page decodes
    that PNG with `createImageBitmap` and carries on. The decoder is asked once per file, never for a file the
    webview could read.
  - The decoder refuses: its words (Rust's text) are the reason, as an `ImageError`, so they reach the person through
    `localizeError` like every other reason.
  - The webview can't decode the PNG Rust gave: an `ImageError` with `error.heicUnread`'s English text, the same
    characters as in en.ts.
- **"Looks like a HEIC":** its type, its name (today's `looksLikeHeic`), or the HEIF brand in its first bytes: the
  `ftyp` box's major or compatible brands, the same brands `src-tauri/src/exif.rs`'s `is_heif` accepts, AVIF's left
  out. Only the first bytes are read for this.
- **Core never imports from `src/app`.** The decoder is handed over: a small module in `src/core/media` holds it
  (a setter and a getter), and `src/app/heicPicture.ts` sets it when the page runs in the desktop app (`isTauriApp`),
  from wherever the app's other start-up wiring is imported, before any picture can be added.
- **The Mac:** the page asks only after its own decode failed, and WebKit reads HEIC, so nothing changes there. For a
  HEIC WebKit can't read, Rust answers with today's line on a Mac (part 1), so that case is unchanged too.
- **At most two at a time** is Rust's gate (part 1). The page's import loops keep reading one file after another;
  don't make them parallel.
- **The count.** `picturesBusy` (src/features/storyboard/picturesBusy.ts) holds how many files are being prepared;
  it gets how many of them are finished, too. Every loop that adds several files marks each one finished as it
  ends, whether it worked or not: `addFiles` (storyboard), `addBoardFiles` (moodboards), the Locations tile's `add`.
  - Where a status line already shows during an add, it reads "Reading 3 of 30…" (the one being read, of the total)
    while two or more files are in hand, and today's words for one file. That is the storyboard's footer
    (`board.addingPictures` today) and the Locations tile's photo line while its own add runs.
  - New key, used through `t()`: `pictures.reading`, en "Reading {done} of {total}…", es "Leyendo {done} de
    {total}…". No existing key's words change.
  - Two adds at once (two tiles) add up: totals and finished counts both.
  - No new status line anywhere it doesn't exist today (moodboards and the plan's underlay show none).
- No Rust changes. No new dependency. No schema or stored-format change: what is stored is what a Mac stores.

## Tests to add

- **Vitest:**
  - the decision after a failed decode, with fakes: not a HEIC (generic line, decoder not asked); a HEIC by type, by
    name, by brand alone (a file with no type and another extension); an AVIF brand is not one; no decoder (today's
    line); the decoder asked exactly once and its PNG used; the decoder's refusal becomes the reason; a PNG the
    webview can't decode gives `error.heicUnread`'s text;
  - the brand reader on the same sample headers `exif.rs`'s own tests use;
  - the decoder is set only in the desktop app;
  - the store: one add of five, each marked as it ends, failures included; two adds at once; back to nothing at the
    end;
  - the line's words in English and Spanish, and today's words for a single file.
  - `src/core/i18n/i18n.test.ts` scans `src/core/media/image.ts` for English messages: it passes as it is, with no
    change to its lists.
- **End to end, Chromium (`e2e/media.spec.ts`, new tests beside the existing ones, in their style):**
  - `src-tauri/testdata/heic/heic-proof.from-rust.png` through `prepareImage` is stored tagged Display P3, and read
    back in a `display-p3` canvas its patches are the drawing's (`heic-proof-regions.json`), within 3 levels: the P3
    red patch about (255, 0, 0);
  - the same pixels with a cICP of 12/13/0/1 in place of the profile (the PNG rebuilt in the test) read the same;
  - the control: the same pixels tagged sRGB (cICP 1/13/0/1) read about (234, 51, 35) for that patch, which shows
    the tag is what keeps the colour.
- **End to end, WebKit on a Mac only** (guarded as `e2e/perf.spec.ts` guards by engine and system; it runs on
  GitHub's Mac at a checkpoint, never here): `heic-proof.heic` itself through `prepareImage` reads the same patches
  within 3 levels. Say in the report that it could not be run here.

## Checks to run

1. `npm run lint`.
2. Vitest, the whole suite.
3. Chromium only, these specs only: `npx playwright test e2e/media.spec.ts e2e/pictures.spec.ts
   e2e/scoutPhotos.spec.ts e2e/smoke.spec.ts --project=chromium`. Read the passed and failed counts.
4. No Rust changes: no cargo run.

## Don't touch

- `src-tauri/`, `src/core/media/cleanPicture.ts`, the picture door, the shared statements.
- The text of `error.heic` and of the generic line; any existing key's words; any existing assertion.
- Any screenshot baseline: if `e2e/visual.spec.ts` would change, stop and report.
- `CLAUDE.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/ALPHA_TEST.md`, CI, `.claude`, dependencies.
- Nothing under `private/`. Kevin's own photos are never read, named or copied.

## Report

The files changed, the tests added, each check with its counts, the new strings in English and Spanish, the test you
could not run here, and anything uncertain.

## After the review (Nov 20): changes to the above

1. **An end-to-end test of the fallback itself, in Chromium:** the tests above hand `prepareImage` the PNG, which
   Chromium decodes on its first try, so the new branch never runs in a real engine. Add one beside them: in the
   page, hand `src/core/media/heic.ts` a decoder that answers with `heic-proof.from-rust.png`'s bytes, then put
   `heic-proof.heic` itself through `prepareImage` as `IMG_0005.HEIC`. Chromium's own decode fails for real, the
   brand is read, the decoder is asked once, and the stored picture's regions read within 3 levels.
2. **The footer's line subscribes by itself.** Today the count is read in `StoryboardTile` and handed down, so the
   whole board draws again as each file finishes. Make the footer's line a small component of its own that reads
   the count, so a 30-file add redraws only that line. `StoryboardTile` and `StoryboardView` take no new prop.
3. **Vitest:** the second `createImageBitmap` (Rust's PNG) is given the same options as the first; the totals come
   back off when the `failed` callback itself throws.
4. **Checks:** add `e2e/boardMedia.spec.ts` to the Chromium specs (it adds pictures to a moodboard through the same
   loop).
