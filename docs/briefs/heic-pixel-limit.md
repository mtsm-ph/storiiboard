# Brief: a HEIC's pixels are limited before any decode (Kevin, Nov 20)

Work in the repo folder on branch `fix/heic-pixel-limit` (already checked out, made from `v2` after HEIC on Windows
merged; don't switch). You write code and tests and run the checks below. You never commit, push or merge. Read
CLAUDE.md's Workflow and Safety sections, then `docs/briefs/heic-windows.md` and `docs/briefs/heic-rust.md` (what
`src-tauri/src/heic.rs` is and why each of its rules is there).

## Why

`heic_picture` (Windows) has ffmpeg decode a HEIC under a 64 MiB cap on the file and a 10 s limit on the time, but
nothing limits the pixels. A HEIC of a few kilobytes can describe a picture, or tiles, of gigabytes once decoded, and
ffmpeg is asked to decode them before the time limit can stop it.

Kevin, Nov 20, his words:

> A pixel limit, read from ffprobe's answer before any decode. Over 120 megapixels is refused: "This HEIC photo is
> too large to read (over 120 megapixels). Convert it to JPEG first." / "Esta foto HEIC es demasiado grande para
> leerla (más de 120 megapíxeles). Conviértela primero a JPEG." Tiles that add up to far more than the picture's own
> size are refused too: pick the allowance so a real 102 MP camera file passes, and say what you chose. Today a small
> crafted file can ask ffmpeg for gigabytes.

## The rule

Read from ffprobe's answer (the one probe that already runs), before the decode is started and before anything else
is asked of ffmpeg:

1. **The picture's own pixels** (the chosen tile grid's width × height; for a picture that is one stream, that
   stream's): over 120,000,000 is refused with the new words. Exactly 120,000,000 passes.
2. **The tiles of the chosen grid, added up** (each tile's width × height, counted once for each time the grid uses
   it): refused with the same words when the sum is more than twice the picture's own pixels plus 1,000,000.
   - Why that allowance: tiles overhang the picture by less than one tile per row and per column, so real files sit
     between 1.0 and about 1.5 times (an iPhone's 48 MP photo in 512 px tiles: 1.03; a 102 MP 11648 × 8736 frame in
     4096 px tiles: 1.48). Twice leaves room for a layout nobody has shown us; the extra megapixel keeps a tiny
     picture in one 512 px tile from being refused. A crafted file with a 16 × 16 picture over huge tiles is far past
     it. If the code or ffmpeg's own limits give a better-founded number, say so and why; this one is the default.
3. A width, height or tile size that is missing, zero, negative or not a number where the rule needs it: refused as
   unreadable (the existing words for a photo that can't be read), never passed on to the decode. Multiplying must
   not overflow: use checked or wide arithmetic.
4. The check runs for every picture the command reads, grid or single stream, and on the grid the decode will use
   (the default one, else the largest: the same choice `read_picture` already makes). Other grids in the file (a
   gain map's) are not decoded, so they are not counted.
5. Nothing about the Mac changes: there the page's own decoder reads HEIC and this command answers `error.heic`.

If ffprobe's present entries (`PROBE_ENTRIES`) don't carry a tile's width and height or the grid's size, add exactly
what is missing and keep the answer bounded as it is now.

## Words

- A new message, in Rust as English and in en.ts and es.ts under a new key beside the other `error.heic*` lines
  (the app finds a Rust message's translation by its exact English: see how the others are done, and the two tests in
  `src/core/i18n/i18n.test.ts` that hold the two sides together):
  - en: `This HEIC photo is too large to read (over 120 megapixels). Convert it to JPEG first.`
  - es: `Esta foto HEIC es demasiado grande para leerla (más de 120 megapíxeles). Conviértela primero a JPEG.`
- The existing line for a file over 64 MB stays as it is.

## Tests (Rust, in heic.rs's tests, with ffprobe answers built as JSON the way the present tests build them)

- A single stream of exactly 120,000,000 pixels passes the check; 120,000,001 is refused with the new words.
- A grid whose own size is over the limit is refused whatever its tiles are.
- A grid within the limit whose tiles add up to 1.03 times, 1.48 times and exactly twice plus 1,000,000: pass. One
  pixel more: refused.
- The 102 MP case by its numbers: 11648 × 8736 over nine 4096 × 4096 tiles passes; over 512 × 512 tiles (23 × 18)
  passes.
- A 16 × 16 picture over one 16384 × 16384 tile, and over 256 tiles of 8192 × 8192: refused.
- A tile used twice by the grid counts twice.
- Missing, zero and negative sizes, a size as a string of letters, and sizes whose product overflows 64 bits:
  refused as unreadable, no panic.
- The refusal comes before the decode: with the command's own test seam (see how
  `a_grid_refused_by_its_boxes_is_never_written…` shows nothing was written), a refused photo starts no decode and
  writes no file.
- The real fixture (`src-tauri/testdata/heic/`) still decodes exactly as before.
- The message has its en and es lines (the i18n tests).

No existing test or assertion changes. If one would have to, stop and report.

## Checks to run

- From `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test heic`, then the
  whole `cargo test`.
- `npx tsc --noEmit`; unit: `node test-results/build627b/vitestUpper.cjs src/core/i18n src/app` (this shell's
  lower-case drive letter makes plain Vitest fail every file; that helper runs it from `C:\`).
- Logs go under `test-results/heic-pixel-limit/`.

## Don't touch

- The colour tag rules, the box reader, the gate, the time limit, the 64 MiB cap, the page (`src/core/media`),
  CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, `.github`, `.claude`.
- Kevin's sample photos (`private/samples`): this change reads none of them.
- No new dependency. No prettier. Never start a command with `python`. Nothing fetched through npx.

## Report back

Where the check sits and what it reads; the allowance as built and anything that argues for another number; each new
test's name and result; each check's output line with counts; every test that failed on the way, by name.
