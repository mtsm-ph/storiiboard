# Brief: the HEIC pixel limit, round 2: the right tiles, the canvas, and what the decoder really makes (6.27v, #233)

Branch `fix/heic-pixel-limit` (the main session checks it out for you; don't switch). Never commit, push or merge.
Read `docs/briefs/heic-pixel-limit.md` first: this round tightens it after a review.

## What the review found, and what is now known

1. **High: a tile placement's `stream_index` is its position in the grid's own stream list, not a file stream
   index.** FFmpeg documents `AVStreamGroupTileGrid.offsets[i].idx` as "Index of the stream in the group this tile
   references. Must be < nb_streams" of the group, and ffmpeg's own graph uses it so (`[0:g:N:idx]`). Round 1 looks
   it up among the file's streams. The two agree only when the grid's tiles are the file's first streams (as in the
   committed proof), so every test passed. **Checked on Kevin's iPhone photos (yes or no only):** in a photo with a
   gain map, the second grid's placements are positions in its own list and are not its file stream indexes; in the
   first grids the two agree. A crafted file with small streams first and huge tiles after would pass round 1.
2. **Medium: the canvas ffmpeg builds isn't checked.** ffmpeg stacks the tiles on a `coded_width × coded_height`
   canvas, then crops to `width × height` (`components[0]`). Uneven tiles can make a canvas far bigger than both the
   crop and the tile sum suggest.
3. **Medium: every size checked is what the container says, not what the decoder will make.** A tile whose box says
   512 × 512 can carry a coded picture of 16384 × 16384.
4. **Checked on Kevin's photo with a gain map (yes or no only):** when ffmpeg is asked for the first grid alone, it
   decodes no frame of the other grid's tiles. So counting only the chosen grid stays right.

## What to build (src-tauri/src/heic.rs)

1. **Tiles through the grid's own list.** For each placement, `stream_index` is a position in the chosen group's
   `streams` list; take that entry's file stream index, and that stream's width and height. A position outside the
   group's list is unreadable. Fix the test helper that builds grids (it lists only one stream in the group while its
   placements go higher) so every test's grid lists every tile.
2. **The canvas too.** Ask ffprobe for the component's `coded_width` and `coded_height` (add them to
   `PROBE_ENTRIES`), and refuse, with the same words, a canvas whose area is over the same allowance (twice the
   picture plus 1,000,000). Missing or unreadable values: unreadable.
3. **The decoder makes no bigger frame than declared.** Give the decode a per-frame pixel cap so that a coded picture
   larger than its declared size is refused by the decoder itself: ffmpeg's `max_pixels` codec option, set for that
   input's decoders, at the largest frame the file declares for what will be decoded (the largest tile of the chosen
   grid, or the single stream). First verify, with the committed proof, that ffmpeg 8.1.3's command line accepts it
   for an input's decoders: with the cap one pixel below a tile's area the decode fails (and the app gives the
   unreadable words, no panic, no file left); with the cap at the tile's area it decodes exactly as before. If ffmpeg
   doesn't accept it there, stop and report: don't find another way without a word from the main session.

## Tests

- A grid whose tiles are not the file's first streams: small streams first, the grid's tiles after, placements 0 to
  n−1. With huge tiles it is refused (round 1 would have passed it); with ordinary tiles it passes.
- A placement past the group's list: unreadable.
- The canvas: tiles of uneven size whose sum passes but whose canvas doesn't: refused; an ordinary grid: passes.
- The decoder's cap, both ways, on the proof (above).
- Every round 1 test still passes. The changes to round 1's own test helper are this PR's own; no other existing
  assertion changes.

## Checks

From src-tauri: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test heic`, the whole `cargo
test`. Logs under `test-results/heic-pixel-limit/`. Read nothing from private/samples. Never start a command with
`python`. Nothing fetched through npx.

## Report back

What changed per point; whether `max_pixels` works on the command line and how it is passed; each new test's name and
result; each check's output line with counts.
