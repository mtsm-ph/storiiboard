# Brief: the HEIC pixel limit, round 4: the cap as ffmpeg checks it, the coded size, a test that holds on a Mac (#233)

Branch `fix/heic-pixel-limit` (the main session checks it out for you; don't switch). Never commit, push or merge.
Read the three earlier briefs on this branch (`docs/briefs/heic-pixel-limit*.md`) first.

## Why (a review of round 3)

1. **A test that fails on Apple silicon.** `ffmpeg_decodes_a_1000_by_750_picture_at_its_cap_and_refuses_it_under_1024_by_750`
   expects a refusal at `1024 × 750 − 1`. ffmpeg aligns the width to its build's stride alignment: 64 on x86 with
   AVX-512, 32 with AVX2, **16 on aarch64**. On the Mac's build, 1000 aligns to 1008, so 756,000 is checked and
   767,999 decodes: the test fails in the Mac installer job, which runs the Rust tests.
2. **A thin frame lifts the cap.** ffmpeg checks `align(width) × height`: the height is not rounded. Round 3 rounds
   both sides up to 64, so a stream declared 120,000,000 × 1 (which passes the exact 120 MP check) gets a cap of
   120,000,000 × 64, clamped to about 2.15 G pixels, 18 times the limit. Same per tile.
3. **A picture stored larger than it declares.** An HEVC stream's SPS can carry a conformance window that crops the
   coded picture: ffprobe's `width` and `height` (and ffmpeg's `max_pixels` check) are the cropped size, but the
   frame is allocated at the coded size. A tile declared 64 × 64 with a coded size of 8192 × 8192 passes a cap of
   4096 and allocates 64 M pixels.

## What to build (src-tauri/src/heic.rs)

1. **The cap as ffmpeg checks it:** `round_up(width, 64) × height` (the width only; 64 covers every build's
   alignment). Keep checked arithmetic.
2. **The coded size, checked before any decode:** ask ffprobe for each video stream's `coded_width` and
   `coded_height` (add them to `PROBE_ENTRIES` for streams). For the single stream, and for every placed tile, a coded
   width over `round_up(width, 64)` or a coded height over `round_up(height, 64)` is unreadable (an honest encoder pads
   to its coding block, at most 64). First verify with the committed proof what ffprobe prints for `coded_width` and
   `coded_height` on its tiles and its grid (it may print 0 when it hasn't decoded: if it does, say so and treat 0 as
   "not known", which is not a refusal on its own). If ffprobe doesn't give a usable coded size, stop and report:
   don't decode to find out.
3. **The test that fails on a Mac:** refuse at `1000 × 750 − 1` (refused on every build) and decode at the cap; keep
   the 1024 × 768 arithmetic test of the cap function as it is.

## Tests

- The cap: 1000 × 750 gives 1024 × 750; 120,000,000 × 1 gives 120,000,000 × 1 rounded on the width only (no 64-fold
  lift); 512 × 512 gives 262,144.
- The coded size: a stream or tile whose coded size exceeds its declared size by more than the rounding is
  unreadable (JSON-built); equal or within the rounding passes; a coded size of 0 alone passes.
- The proof's real probe still passes, with its coded sizes as ffprobe prints them pinned in the test.
- The changed test above: the brief asks for exactly that change.

No assertion from before this PR changes.

## Checks

From src-tauri: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test heic`, the whole `cargo
test`. Logs under `test-results/heic-pixel-limit/`. Read nothing from private/samples. Never start a command with
`python`. Nothing fetched through npx.

## Report back

What ffprobe prints for the proof's coded sizes; what changed per point; each new or changed test's name and result;
each check's output line with counts.
