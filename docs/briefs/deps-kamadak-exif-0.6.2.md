# Brief: kamadak-exif 0.6.2 (Kevin, Nov 18 and 19)

Work in the repo folder, on branch `deps/kamadak-exif-0.6.2` (already checked out; don't switch). Read CLAUDE.md
first. Never commit, push or merge. Use Edit and Write for every file change. Logs go in test-results/.

## Goal

Move kamadak-exif from 0.6.1 to **0.6.2**, exactly (Kevin approved Nov 18; allowed from 13:41 UTC Nov 19, two weeks
after its release). Its own notes (NEWS in the library):

> 0.6.2 (2026-11-05): This version includes a security fix for GHSA-53gf-vqf6-qvp8. An already parsed IFD will not be
> visited again to prevent O(n^3) memory allocation.

Cite only those notes (Kevin, Nov 18: no more detail than the library publishes; the repo is public).

## Steps

1. src-tauri/Cargo.toml: `kamadak-exif = "=0.6.2"`, and its comment's last sentence becomes: "Pinned exactly at
   0.6.2 (BSD 2-Clause), whose notes name a security fix (GHSA-53gf-vqf6-qvp8: an IFD already parsed isn't visited
   again)." Keep the rest of the comment.
2. `cargo update -p kamadak-exif --precise 0.6.2` from src-tauri (the one download allowed). Cargo.lock must change
   only kamadak-exif's version and checksum; report any other change and stop if one appears.
3. Fix anything the upgrade forces (none is expected); name every change.
4. Our own walk (src-tauri/src/exif.rs) already refuses a directory seen before, before the library reads a block
   (`a_block_is_parsed_only_when_each_directory_is_visited_once`). Confirm it still passes, and add one test that a
   block whose IFD chain points back at an earlier directory is refused by our walk and, read straight by the
   library with our walk bypassed (call the library as exif.rs does, in the test only), now returns without
   hanging or growing: a bounded run, no timing assertion. If the library's API makes that second half impossible
   without changing exif.rs, skip it and say why.

## Checks

- From the repo root: `npm run test:rust` and `npm run lint:rust`. Paste counts (expect today's 335 passed and 2
  ignored on v2, plus yours).
- No TypeScript, Vitest or end-to-end runs: nothing outside src-tauri changes.

## Don't touch

- Any other dependency, exif.rs's code (tests only), TypeScript, CI, .claude, CLAUDE.md, PLAN.md, HANDOFF.md.
- Existing tests and assertions: never weaken, skip or delete one; stop and report if one fails.

## Report

The lock change; any forced change; the new test; the check counts.
