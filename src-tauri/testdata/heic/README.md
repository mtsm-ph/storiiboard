# HEIC test pictures (6.27n)

Our own drawing, no person, no place and no one else's picture, for `src/heic.rs` (Rust turning a HEIC into a tagged
PNG on Windows) and, in part 2, the end-to-end proof that colours outside sRGB come out unclipped.

- `heic-proof.png` (13,997 bytes, SHA-256 `9c13c82a28b1f728752fa4daddf91a15ed7c55087943f598174bbae25c078837`): the
  drawing, 1024 × 768, tagged with a Display P3 profile the script builds itself: flat patches of P3's pure red, green
  and blue (outside sRGB), a colour inside sRGB, a mid grey, and a grey gradient. Drawn again, byte for byte, with
  `node scripts/heicFixtures.ts --out <folder>` (it writes the 12 MP and 48 MP pictures too, which aren't committed).
- `heic-proof-regions.json` (3,860 bytes, SHA-256 `db6e19c6342b343a74389a4259f1cf5c5a48e37e991f230c32163357b0af227e`):
  where each patch is, and the mean the drawing has inside each measured region; written by the same script.
- `heic-proof.heic` (4,736 bytes, SHA-256 `81420beba8b541a4c7ef8a07d7a99ae48041c01dc08cb9e803ff0e3c202a846b`): the
  drawing as a HEIC, made on GitHub's Mac runner (run 44666161464) with
  `sips -s format heic -s formatOptions 80 pictures/heic-proof.png --out pictures/heic-proof.heic`. A grid of four
  512 × 512 HEVC tiles, 1024 × 768, its colour said by a Display P3 ICC profile of 2,636 bytes and no four-number tag.
- `heic-proof.from-rust.png` (7,005 bytes as written on Windows, SHA-256
  `2f4d19977986f0779a3405327cc0b13f7dc0458266545fda2c2b3ff6930c8729`): what `heic_picture` answers for the HEIC: IHDR,
  the file's profile as an iCCP chunk, the IDAT chunks, IEND. `heic::tests::the_committed_answer_stays_in_step` checks
  that its pixels and its colour chunk are still today's answer (never its bytes: zlib differs between systems);
  `SBD_HEIC_WRITE_FROM_RUST=1 cargo test the_committed_answer_stays_in_step` writes it again.
