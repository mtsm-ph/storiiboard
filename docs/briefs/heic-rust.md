# HEIC on Windows, part 1: Rust turns a HEIC into a tagged PNG (6.27n): brief

Kevin, Nov 19 and 20. The plan and its measurements are in `docs/briefs/heic-windows.md` (on this branch; read it
after this brief). Where the two differ, this brief is the newer one. Part 2 (the page's fallback, the count in the
status line, the end-to-end proof) is its own brief: here the page gets only a thin caller that nothing uses yet.

## Goal

One command, `heic_picture`: a HEIC's bytes in, a PNG's bytes out, scaled to fit 2560 px, tagged with the file's own
colour, so Windows can store from a HEIC what the Mac stores. Plus the committed fixtures and their script.

## Decisions

- **Not on the Mac.** WebKit reads HEIC itself and the Mac must not change. On macOS the command answers with today's
  line, the same text as en.ts's `error.heic`, character for character. Windows and Linux (the tests) decode. Keep
  the rule a function of the system's name so a test covers both answers on any system.
- **What is refused before any decode:** input over 64 MiB; anything `exif.rs`'s `is_heif` doesn't call a HEIF (AVIF
  stays out). `is_heif` becomes `pub(crate)`, nothing else in exif.rs changes.
- **The temp file:** the HEIF reader has to seek, so the bytes go to a file in the app's cache folder under a random
  name of our own (`lock::random_id`, made with `create_new`). It is gone after every outcome: done, refused, failed,
  timed out. A killed ffmpeg can still hold it for a moment on Windows: remove it the way `video.rs`'s runner removes
  a `leftover`.
- **Running the sidecars:** reuse `video.rs`'s own runner (`command`, `run_stoppable` and what they need) by making
  those `pub(crate)`. Change nothing they do, and none of their words. `-nostdin`, no console window and
  `keep_with_app` come with them. Add `-protocol_whitelist file`, as `still_graded` has.
- **ffprobe first** (`-show_streams -show_stream_groups`, JSON), its output read up to a cap (1 MiB):
  - the picture is the Tile Grid group marked default, else the first Tile Grid group, else the first video stream
    not marked `dependent`;
  - **HDR:** a transfer of `smpte2084` or `arib-std-b67` on the picture's stream is refused with Kevin's line:
    "This is an HDR photo, which Storiiboard can't read on this computer yet. Export it as a JPEG first." Decide by
    the transfer only: sips-made SDR files carry content light level data too.
  - **depth:** a pixel format over 8 bits gives a 16-bit PNG (`rgb48be`), else `rgb24`.
- **The decode:** one ffmpeg run, the picture through `scale`, one PNG on stdout (capped at 64 MiB of output):
  `-filter_complex "[0:g:N]scale=…[o]" -map "[o]" -frames:v 1 -c:v png -pix_fmt … -f image2pipe -`, with `[0:v:M]`
  in place of `[0:g:N]` when there is no grid. No colour-space conversion.
  - **The size never depends on the turn.** ffmpeg applies a HEIC's rotation itself, and no fixture here has one, so
    don't work the size out in Rust. Fit inside 2560 × 2560, keeping the shape, never up:
    `scale=w='min(2560,iw)':h='min(2560,ih)':force_original_aspect_ratio=decrease:flags=lanczos`. The PNG's own IHDR
    says what came out.
- **The colour tag (Kevin, Nov 20), in this order:**
  1. **An ICC profile in the file is carried.** ffprobe names it in the stream's `side_data_list` ("ICC Profile").
     The grid's PNG does not carry it (probed Nov 20 on the fixtures: its chunks are IHDR, pHYs, IDAT, IEND), but a
     PNG of the picture's first stream alone does (`-map 0:v:M -frames:v 1 -vf scale=16:16 -c:v png`: IHDR, pHYs,
     iCCP, IDAT, IEND, the profile whole). So a second, tiny ffmpeg run gives the iCCP chunk, and that chunk goes
     into the answer as it is.
     - Over 64 KiB, counted as `cleanPicture.ts` and `picture_door.rs` count a profile (the iCCP chunk's data as it
       sits in the PNG, nothing inflated): the photo is refused with words. Never shown in the wrong colour.
     - ffprobe names a profile but the tiny PNG has none: refused as unreadable, never guessed.
  2. **Else the file's four-number tag becomes cICP:** `[primaries, transfer, 0, 1]` (RGB, full range), the
     primaries and transfer as ffprobe names them on the picture's stream, through a table from ffmpeg's names to
     the H.273 numbers (bt709 1, bt470m 4, bt470bg 5, smpte170m 6, smpte240m 7, film 8, bt2020 9, smpte428 10,
     smpte431 11, smpte432 12 for primaries; bt709 1, gamma22 4, gamma28 5, smpte170m 6, smpte240m 7, linear 8,
     iec61966-2-1 13, bt2020-10 14, bt2020-12 15 for transfers). An iPhone's is smpte432 with iec61966-2-1: 12/13.
  3. **Else sRGB:** a name that is missing, "unknown", "unspecified" or not in the table, for either number, gives
     cICP `[1, 13, 0, 1]`.
- **The answer's PNG holds exactly:** IHDR, then the iCCP or the cICP chunk, then ffmpeg's IDAT chunks, then IEND.
  Everything else ffmpeg wrote is dropped. CRC-32 by hand (a table in the file; scripts/heicFixtures.ts has one to
  read). No new crate.
- **Time:** 10 s for the whole call once it has its turn (every run together), then the process is killed and the
  photo is refused.
- **At most two at a time** (Kevin, Nov 20: one 48 MP photo peaks at about 300 MB). A gate in Rust around the
  decode (std `Mutex` and `Condvar`, no crate): a third call waits its turn, and its 10 s start when it gets it.
  The command runs on `spawn_blocking`, as `video_still` does.
- **Words**, each a const in heic.rs with the same text under an `error.` key in en.ts, and its Spanish in es.ts in
  that file's own style (`localizeError` matches Rust's text against en.ts, so the two must be the same character
  for character):
  - `error.heicTooBig`: "This HEIC photo is too large to read (over 64 MB). Convert it to JPEG first."
  - `error.heicNotHeic`: "That file isn't an HEIC photo."
  - `error.heicHdr`: "This is an HDR photo, which Storiiboard can't read on this computer yet. Export it as a JPEG
    first."
  - `error.heicTooSlow`: "This HEIC photo took too long to read. Try again, or convert it to JPEG first."
  - `error.heicUnread`: "This HEIC photo couldn't be read. Convert it to JPEG first."
  - `error.heicProfileTooBig`: "This photo's colour profile is too large to keep, so its colours can't be shown as
    they are. Convert it to JPEG first."
  - On the Mac: `error.heic`'s text, unchanged.
  No file name, path or ffmpeg output goes into a message or a log.
- **The page's caller, unused for now:** `src/app/heicPicture.ts`, one function that sends a photo's bytes as the raw
  request body to `heic_picture` and returns the PNG's bytes, as `src/app/photoExif.ts` calls `photo_exif`. Nothing
  imports it yet. `src/app/tauriContract.test.ts` wants every registered command called by the page: this call
  satisfies it, and its raw body needs one new entry in that test's `UNREADABLE` list, written like `photo_exif`'s.
  That entry is the only change to an existing test in this brief.

## Fixtures (already in the working tree; the main session put them there)

- `scripts/heicFixtures.ts`, `scripts/heicFixtures.test.ts` and the small change to `scripts/fixturePhotos.ts`, from
  the measuring branch.
- `src-tauri/testdata/heic/heic-proof.heic` (4,736 bytes, a grid of four 512 × 512 tiles, 1024 × 768, a Display P3
  ICC profile of 2,636 bytes and no four-number tag), `heic-proof.png` (the drawing it was made from) and
  `heic-proof-regions.json` (where each patch is and what it should read).
- You add:
  - `src-tauri/testdata/heic/README.md`: what each file is; that the HEIC was made on GitHub's Mac runner (run
    44666161464) from our own drawing with
    `sips -s format heic -s formatOptions 80 pictures/heic-proof.png --out pictures/heic-proof.heic`; each file's
    SHA-256; how to draw the PNG again (`scripts/heicFixtures.ts`). A line in `src-tauri/testdata/README.md` if that
    file lists its folders.
  - `src-tauri/testdata/heic/heic-proof.from-rust.png`: what `heic_picture` gives for the fixture, for part 2's
    end-to-end test.
- The 12 MP and 48 MP pictures are not committed. For a probe of your own, the 12 MP one is at
  `test-results/heic-artifact/heic-12mp.heic` (4032 × 3024; it must come out 2560 × 1920).

## Tests to add

- **Rust, heic.rs:**
  - the Mac's answer and the other systems', from the rule's function;
  - each refusal: too big, not a HEIF (a JPEG, an AVIF brand, three bytes), HDR by each of the two transfers;
  - reading ffprobe's JSON, on samples written in the test: a grid, no grid, a `dependent` tile skipped, 8 and 10
    bits, each colour case below;
  - the tag's choice: a profile wins over a four-number tag; smpte432 with iec61966-2-1 is 12/13; bt709 with bt709
    is 1/1; missing, "unknown" and a name not in the table are 1/13;
  - the PNG's rewrite, on PNGs built in the test: only IHDR, the tag, IDAT, IEND come out, in that order, from an
    input with pHYs, tEXt, eXIf and an iCCP of its own; several IDAT chunks stay in order; every CRC is right; a
    damaged PNG (cut short, a bad length) is refused, never a panic;
  - a profile chunk over 64 KiB is refused with its words; one of exactly 64 KiB passes;
  - **the fixture, for real** (it needs the sidecars, as the stills' tests do): 1024 × 768; chunks IHDR, iCCP,
    IDAT…, IEND; the iCCP's data the same bytes as the one-stream PNG's; every patch in `heic-proof-regions.json`
    within 3 levels (read the pixels back with ffmpeg to raw RGB, or with a decoder the tests already have);
  - `heic-proof.from-rust.png` stays in step: its pixels and its tag chunk equal today's answer (compare pixels and
    the tag chunk, not the file's bytes: zlib differs between systems);
  - the time limit, with a stand-in that outlasts it (video.rs's tests use ffmpeg `-re -f lavfi …` for this): the
    words, and the temp file gone afterwards (poll for it);
  - the temp file is gone after a pass and after each refusal that made one;
  - the gate: of three calls at once, never more than two are inside.
- **Rust, command_tests.rs:** `heic_picture` through the harness: raw bytes in, PNG bytes out for the fixture; a
  refusal's text for a non-HEIF. The harness has `call_raw` and `call_bytes` but nothing that sends raw bytes and
  reads bytes back: add that helper, changing no existing one.
- **Vitest:** `src/app/heicPicture.test.ts` (the call's name and raw body; the bytes come back; a refusal becomes
  an Error with Rust's text). `src/app/tauriContract.test.ts` and `src/core/i18n/i18n.test.ts` pass: the first with
  its one new `UNREADABLE` entry, the second as it is (never add to its `internal` list; start heic.rs's test module
  with `#[cfg(test)]` and `mod tests` on the next line, as the scan expects).

## Checks to run

1. `npm run lint`.
2. `cargo test --manifest-path src-tauri/Cargo.toml` (the whole suite).
3. Vitest, the whole suite.
4. No end-to-end run in this part: no screen or flow changes.

## Don't touch

- `src/core/media/image.ts` and every import path of the page (part 2 wires the fallback in).
- `src/core/media/cleanPicture.ts`, `src-tauri/src/picture_door.rs`, `src-tauri/testdata/picture-statements.json`:
  Rust's PNG only feeds the page's decoder, so their lists don't change.
- What `video.rs`'s runner does, and its words. `scripts/ffmpeg/build.sh` (a change there rebuilds ffmpeg everywhere).
- Any existing assertion; the `error.heic` entry's text.
- CI, `.claude`, dependencies, `CLAUDE.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/ALPHA_TEST.md`.
- Nothing under `private/`. Kevin's own photos are never read, named or copied.

## Report

The files changed, the tests added, each check with its counts, every new string in English and Spanish as a table,
the sizes and times you saw on the fixtures, and anything uncertain: above all anything about a turned photo, a
photo with no grid, or a 10-bit one, since no fixture here has those.

## After the review (Nov 20): changes to the above

Where these differ from what is written above, these are the newer ones.

1. **ffprobe is asked only for what is read.** `-show_entries` with exactly the fields the reader uses (the streams'
   index, type, pixel format, bits, primaries, transfer, the `default` and `dependent` dispositions and the types of
   their side data; the groups' index, type, `default` disposition, their streams' indexes, their components' width
   and height, and the types of their side data). No tags: a crafted name could otherwise make the answer hundreds
   of MB, and it is read whole before the 1 MiB cap is looked at. Try it on both fixtures and say in the report what
   the answer's size became.
2. **The committed answer is compared within 1 level, not exactly.** ffmpeg's colour conversion uses fast code chosen
   by processor (Intel, Apple silicon), and those may differ by a level. The tag chunk is still compared exactly.
3. **Which picture, when nothing is marked default:** among several Tile Grid groups, the largest (the first among
   equals), not simply the first: a phone's gain map is a grid too. With no grid, a video stream marked default and
   not `dependent` comes before the first one not `dependent`: a thumbnail may come first. Checked Nov 20 on two real
   iPhone photos, in place, yes or no only: the main picture's grid is marked default, is first and is the largest,
   and the profile sits on its tiles.
4. **A profile nobody carried is never ignored.** If the chosen group, or its components, lists an "ICC Profile" and
   the picture's first stream doesn't, the photo is refused as unreadable: never guessed, never shown in another
   colour.
5. **Photos left by a crash are swept.** Before writing its temp file, each call removes `heic-*.heic` files in the
   cache folder older than 10 minutes (a decode lasts seconds), errors ignored. They are a person's photos, with
   their EXIF.
6. **No run is started with no time left:** the too-slow words at once.
7. **A sidecar that can't be started keeps the runner's own words** (they say to reinstall), where that can be told
   apart without changing what `video.rs` does. Otherwise leave it and say so.
8. **The gate's test:** never more than two at once is asserted as "at most two", and that two did get in at once is
   asserted separately, so a slow runner can't fail it. If `picture` itself going through the gate can be shown by a
   test, add it.
9. **Spanish, `error.heicTooSlow`:** "Esta foto HEIC tardó demasiado en leerse. Vuelve a intentarlo, o conviértela
   primero a JPEG.", the file's own phrase for "Try again".

## After the second look (Nov 20): four more changes

Where these differ from what is written above, these are the newer ones.

1. **A colour the grid alone describes is found in the file's own bytes.** This ffprobe has no side-data section
   for a stream group or its components, so the guard in point 4 above can never see a profile that belongs to the
   grid item and not to its tiles: the photo would be tagged from its first tile (sRGB if that says nothing) and
   shown in the wrong colour with no notice, and an HDR tag on the grid alone would not be refused. So Rust reads the
   HEIF's own boxes, from the bytes it already holds, for this one question:
   - Read `meta` (a full box) and in it: `pitm` (the primary item; versions 0 and 1), `iref` (versions 0 and 1; the
     primary item's `dimg` references are its tiles, the first one its first tile), and `iprp` with `ipco` (the
     properties, counted from 1) and `ipma` (which item has which; versions 0 and 1, and the flag that makes an
     index two bytes).
   - A `colr` property is an ICC profile (`prof` or `rICC`) or the four numbers (`nclx`: primaries, transfer, matrix
     as 16-bit numbers, then the range bit).
   - **The rules, applied only when the primary item has tiles:**
     - the primary item has an `nclx` whose transfer is 16 (PQ) or 18 (HLG): the HDR refusal, whatever the tiles say;
     - the primary item has an ICC `colr` and its first tile has none: refused as unreadable;
     - the primary item has an `nclx` and its first tile has no `colr` at all: refused as unreadable.
     Never guessed, never shown in another colour. Everything else goes on exactly as today.
   - **A file whose boxes can't be followed adds no refusal:** ffmpeg stays the judge of whether it decodes. The
     reader never panics and never reads past the bytes it was given: every length is checked before a slice, a box
     size of 0 means to the end and a size of 1 means a 64-bit size follows, sizes smaller than a header are an end,
     and no list is followed past 4,096 entries.
   - It is its own small part of heic.rs (or a module beside it), with no new crate.
2. **A profile on another tile is looked up where it is proven to be printed.** The guard reads each group stream's
   `side_data_list` inside the group; nobody has checked that this ffprobe prints it there. Look each group stream's
   `index` up in the top-level `streams` instead, whose side data the tests already read back from real files.
3. **The sweep takes only names it could have written:** exactly `heic-`, 32 lowercase hex characters (what
   `lock::random_id` gives), `.heic`.
4. **Names and proofs:** the test whose name still says "else the first" is renamed for the rule it now tests (its
   assertions stay as they are); and the gate's test proves the wait if it can be done without sleeping on luck (the
   waiting call seen at the gate before the check), else leave it and say so.

### Tests to add for these

- The box reader, on box trees the tests build byte by byte: a grid with an ICC `colr` its first tile lacks is
  refused; both carrying one is fine; an `nclx` of transfer 16 and of 18 on the grid is the HDR refusal; an `nclx` on
  the grid with nothing on the tile is refused; a single picture with no tiles adds nothing; `pitm`, `iref` and
  `ipma` in both versions, and `ipma` with two-byte indexes; a tree cut at every length, sizes of 0 and 1, a size
  smaller than its header, a list longer than the limit: never a panic, never a refusal.
- The real fixture still decodes exactly as before (its profile sits on its tiles).
- A profile on another tile, found through the top-level streams.
- The sweep leaves `heic-.heic`, `heic-abc.heic` and a name with upper-case hex alone, old as they may be.

## After the box reader's review (Nov 20): the last changes

Where these differ from what is written above, these are the newer ones.

1. **The grid's own four numbers are used, not refused.** The third rule above ("an `nclx` on the grid with no `colr`
   on its first tile: refused") would refuse an ordinary photo whose tiles say their colour only inside the video
   stream, which some phones may write. The grid's `nclx` is the picture's own description, so use it: when no ICC
   profile is carried, the tag is a cICP from the **grid's** primaries and transfer if the grid has an `nclx`
   (through the same table: a number the table doesn't hold gives sRGB, as a name does), else from the first tile's
   stream as today, else sRGB. The order is now: an ICC profile carried; else the grid's four numbers; else the
   stream's; else sRGB. The HDR refusal by the grid's transfer (16 or 18) stays, and so does the refusal of an ICC
   profile on the grid that the first tile lacks.
2. **The reader needs only the boxes it reads.** Today the whole top level and the whole of `meta` must parse, so
   four stray bytes after `mdat` switch the check off, on exactly the files it exists for. Walk the top level only
   until `meta` is found, and `meta`'s children only for `pitm`, `iref` and `iprp`; a broken box after the ones
   needed changes nothing. A broken box before one that is needed still means "can't follow".
3. **The box check runs once, in the blocking part,** not on the command's own thread: a crafted 64 MiB file of tiny
   boxes takes a moment to walk.
4. **Tests for what the review found untested:** an `rICC` profile; an association with index 0; two `ipma` boxes;
   a `dimg` from another item before the primary's; a size of 0 on a box that isn't last; a child that claims to run
   past its parent; an `nclx` of exactly 10 and exactly 11 bytes; a grid with both a profile and an `nclx` over a
   tile with only one of them (each way); stray bytes after `mdat` (the check still works); and the new tag order:
   the grid's numbers win over the stream's, and a number the table doesn't hold is sRGB.
