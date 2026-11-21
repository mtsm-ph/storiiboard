# Brief: a HEIC photo's date and place (Kevin, Nov 20)

Work in the repo folder on branch `feat/heic-exif` (already checked out, made from `v2` after HEIC on Windows merged;
don't switch). You write code and tests and run the checks below. You never commit, push or merge. Read CLAUDE.md's
Workflow and Safety sections; `src-tauri/src/exif.rs` whole (its header says what it guards and why); and the box
reader in `src-tauri/src/heic.rs` with `docs/briefs/heic-rust.md` (how it walks `meta`, `pitm`, `iref`, `iprp`, its
bounds, and how its tests build box trees byte by byte).

## Why

A location's photo keeps its EXIF date, time and GPS (6.27), which is what draws the sun from a photo. Today
`exif.rs` answers `heic` for any HEIF file without reading it ("its EXIF not read yet"), so a HEIC imports without
date or place. iPhone scout photos are HEIC.

Kevin, Nov 20, his words:

> A HEIC photo's date and place: build it now, its own PR. iPhone scout photos are HEIC, so the sun from a photo works
> for almost none of them today, on either system. Find the Exif item with the box reader heic.rs already has (iinf,
> iloc), then give it the same block check and parse a JPEG's gets. Copy no library code into the repo unless that
> can't work, and then ask me first.

So: no code copied from the EXIF crate or any other library, no new crate, no second TIFF reader. If you find this
can't work without one of those, stop and report why: Kevin decides.

## What to build (Rust; both systems: this is not Windows-only)

1. **Find the Exif item's bytes** with the box reader in `heic.rs` (add what it lacks, in its style: every read
   checked, every list capped, never a panic, std only):
   - `iinf` (versions 0 and 1) and its `infe` entries (versions 2 and 3): the items whose type is `Exif`.
   - Which one: the `Exif` item that `iref` ties to the primary item (`pitm`) with a `cdsc` reference; when no `cdsc`
     says, the only `Exif` item if there is exactly one; otherwise none.
   - `iloc` (versions 0, 1 and 2): that item's extents. Read only an item stored in this file by file offsets
     (construction method 0, data reference index 0); extents are joined in order. Anything else (stored in `idat`,
     built from other items, in another file, an extent that runs past the file, sizes of 0 where the format gives a
     meaning you'd have to guess) is not followed.
   - A cap on the item's size: pick one with a reason (a JPEG's block can't pass 64 KiB; cameras' maker notes make a
     HEIC's larger) and say it. Over the cap is not followed.
   - The item's payload starts with a 4-byte big-endian offset to the TIFF header, counted from after those 4 bytes
     (an iPhone writes 6, for `Exif\0\0`). The block handed on starts at the TIFF header. An offset past the end is
     not followed.
2. **Then exactly what a JPEG's block gets** in `exif.rs`: `block_is_safe` first, `Reader::new().read_raw` only if it
   passes, the same tags and the same values out. No tag is added: orientation is not read here (a HEIC's turn comes
   from its own boxes, and heic.rs's decode already applies it).
3. **What `answer` says for a HEIF file** (the page shows a line by this reason):
   - the block found, safe and parsed: `read`, with its values, as for a JPEG;
   - the block found but refused by `block_is_safe` or by the crate: `refused`, as for a JPEG;
   - the boxes followed and there is no `Exif` item: `none`, as for a JPEG without EXIF;
   - the boxes can't be followed, or the item is stored a way this reader doesn't follow: `heic`, as today (the
     photo imports, without date or place, and the line says so).
   Keep `is_heif`'s meaning and the AVIF rule as they are.
4. **The page:** find where the reasons are turned into the status line (`location.photosHeic.*` and its neighbours
   in en.ts and es.ts, the Locations tile's photo import). With this change `heic` means "this HEIC's date and place
   couldn't be read", no longer "not yet". If a line says "yet" or tells the person to make a JPEG copy for every
   HEIC, give it words that are true now, in en and es, and put both in your report for Kevin. Change no other
   wording. If nothing on the page needs to change, say so.
5. `src/app/tauriContract.test.ts` and the command's signature don't change: the same command, the same answer shape.

## Tests

Rust, with box trees built byte by byte as heic.rs's tests do (extend its `Tree` helper; a made-up TIFF block with a
made-up date and a made-up place, never a real one):

- An iPhone-shaped file (one `Exif` item, `cdsc` to the primary, `iloc` version 1, one extent, offset 6): `read`,
  with the date, time, offset and both coordinates the block holds, equal to what the same block gives through the
  JPEG path.
- `iinf` version 0 and 1; `infe` version 2 and 3; `iloc` versions 0, 1 and 2 with offset, length and base-offset
  sizes of 4 and 8 (and 0 where the format allows it); two extents joined.
- Two `Exif` items, one tied to the primary by `cdsc`: that one. Two with no `cdsc`: none (`heic`). An `Exif` item
  tied to another item only: not taken.
- No `Exif` item: `none`.
- Not followed, each answering `heic` with no panic: construction method 1 and 2; data reference index 1; an extent
  past the end of the file; the 4-byte offset past the item's end; an item over the cap; an `iloc` with no entry for
  the item; counts over the caps; the tree cut at every length (as the box reader's own test does).
- A block `block_is_safe` refuses (take one from exif.rs's own tests): `refused`, and `read_raw` is never called on
  it.
- A HEIC's EXIF orientation tag changes nothing in the answer.
- The real fixture in `src-tauri/testdata/heic/`: say what it answers (it may carry no EXIF) and pin that.
- exif.rs's existing HEIF tests that assert a HEIC answers `heic` "before any block is looked for": **this brief
  changes that expectation** where the test's file has boxes that can now be followed. Change exactly those, to the
  answer the rule above gives, and list each (name, old expectation, new) in your report. Every other existing
  assertion stays.
- An ignored test (as the real-JPEG guard is done: find `SB_SAMPLE_JPEGS`) that reads a folder named by the
  environment variable `SB_SAMPLE_HEICS` and, for each HEIC in it, prints one line: the file's number in sorted
  order, then `date yes|no, place yes|no, reason <reason>`. Never a file's name, a value, a date or a coordinate. It
  writes nothing to disk. Don't run it: the main session does, on Kevin's own photos.

Page: unit tests for whatever turns the reasons into words, if you change it.

## Checks to run

- From `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test exif`,
  `cargo test heic`, then the whole `cargo test`.
- `npx tsc --noEmit`, `npx eslint` on touched files; unit:
  `node test-results/build627b/vitestUpper.cjs src/features/locations src/core/i18n src/app` (this shell's lower-case
  drive letter makes plain Vitest fail every file; that helper runs it from `C:\`).
- End to end only if you changed the page: the Locations spec that imports photos, alone, `--project=chromium
  --workers=4`, counts read from the output.
- Logs go under `test-results/heic-exif/`.

## Don't touch

- The decode (`heic_picture`), the colour rules, the gate, the limits; `block_is_safe` and the JPEG path's
  behaviour; Cargo.toml and Cargo.lock (no new crate, no version change).
- `private/samples`: read nothing there yourself.
- CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, docs/SBD_FORMAT.md (nothing stored changes: a
  photo's date and place are stored as a JPEG's already are), `.github`, `.claude`.
- No prettier. Never start a command with `python`. Nothing fetched through npx.

## Report back

How the item is found and bounded (the cap and its reason); what `answer` gives in each case; each changed
expectation; each new test's name and result; any new or changed words in en and es; each check's output line with
counts; every test that failed on the way, by name; and anything that made you think library code would be needed.
