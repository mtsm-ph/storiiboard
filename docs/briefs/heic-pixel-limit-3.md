# Brief: the HEIC pixel limit, round 3: the decoder's cap as ffmpeg counts it; equal tiles (6.27v, #233)

Branch `fix/heic-pixel-limit` (the main session checks it out for you; don't switch). Never commit, push or merge.
Read `docs/briefs/heic-pixel-limit.md` and `-2.md` on this branch first.

## 1. High, confirmed: ffmpeg counts `max_pixels` on the width rounded up

Checked by the main session with the bundled ffmpeg 8.1.3 on this PC (test-results/maxpixels-probe/): a 1000 × 750
PNG with `-max_pixels 750000` is refused ("Picture size 1024x750 exceeds specified max pixel count 750000"); with
768000 it decodes. A 1024 × 750 PNG decodes at 768000 and is refused at 767999. So the check is on the frame's width
rounded up to the memory alignment (64 on this build), times its height. Round 2's cap, the exact declared area,
would refuse any ordinary photo whose width isn't a multiple of 64 (a single-stream 4000 × 3000 HEIC, a 1000 × 750
one, a grid of 500 px tiles). The proof's 512 px tiles are already aligned, which is why the tests didn't see it.

- The cap for a frame is `round_up(w, 64) × round_up(h, 64)`: 64 is the largest alignment any ffmpeg build uses, and
  an HEVC decoder's coded size is the declared size rounded up to its coding block (at most 64), so this bounds both.
  An attacker gains at most 63 columns and 63 rows per frame.
- Tests: the cap for 1000 × 750 is 1024 × 768; for 512 × 512 it is 262144. And an ffmpeg run, as the existing
  decoder-cap test runs it, of a 1000 × 750 picture (make a PNG in the test, as other tests make pictures) at that cap
  decodes, and one pixel under `1024 × 750` is refused.

## 2. Medium: one cap for every tile

`-max_pixels` before `-i` gives every tile's decoder the largest tile's cap, so a grid of one big tile and many tiny
ones could decode every tiny one at the big one's size (n × L pixels, far past the tile sum the allowance checks).
HEIF requires every input image of a grid to have the same width and height (ISO/IEC 23008-12, image grid). So:

- A grid whose placed tiles don't all declare the same width and height is unreadable. Then the one cap is every
  tile's own cap.
- Test: a grid of one 1000 × 1000 tile and 1,999 tiles of 1 × 1 is unreadable; equal tiles pass as before.

## 3. Lows: two tests' comments

- `a_photo_refused_for_its_pixels_starts_no_decode_and_leaves_no_file`: its `proof_sized(16, 16)` case is now refused
  by the canvas check before the tile sum (the proof's canvas equals its tile sum). Keep the assertion; say so in its
  comment. The tile sum stays covered by the JSON-built tests.
- `a_place_past_the_grids_own_list_is_unreadable`, "No list at all": `read_picture` refuses it first. Say so in its
  comment, or replace that one case by one that reaches the new path (an entry list present but too short).

No other change. These are this PR's own tests; no assertion from before this PR changes.

## Checks

From src-tauri: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test heic`, the whole `cargo
test`. Logs under `test-results/heic-pixel-limit/`. Read nothing from private/samples. Never start a command with
`python`. Nothing fetched through npx.

## Report back

What changed per point; each new test's name and result; each check's output line with counts.
