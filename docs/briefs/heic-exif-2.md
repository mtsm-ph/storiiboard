# Brief: a HEIC photo's date and place, round 2: no spinning on a crafted file; harder tests (6.27y, #236)

Branch `feat/heic-exif` (the main session checks it out for you; don't switch). Never commit, push or merge. Read
`docs/briefs/heic-exif.md` on this branch first.

The review found no panic, no unchecked read, and no block reaching the parser unchecked. It found one medium and
some lows.

## 1. Medium: a crafted file must not make the reader spin

`chosen`'s `ties` check runs, for every Exif item, over every `cdsc` reference and every id in each: a file listing
4096 `infe` boxes of type `Exif` all with the same id, and 4096 `cdsc` boxes from that id with 4096 ids each (about
34 MB), costs about 7 × 10¹⁰ comparisons before it answers. There is no time limit on this path.

- **Duplicate item ids in `iinf` are not followed** (a valid file never has them): `heic`.
- **One pass over the references:** collect the from-ids whose `cdsc` names the primary, then look each Exif item up
  in that set. No nested loop over items and references.
- **Cap the total ids read across all `iref` boxes** at the same cap as entries (`MAX_ENTRIES`): over it, not
  followed. That bounds the memory as well.
- **Test:** the review's crafted tree (repeated id, repeated `cdsc` with 4096 ids each) answers `heic` within a few
  milliseconds (time it in the test with a generous bound, say 200 ms, so it fails clearly on the old code); a tree
  just under the caps answers as before.

## 2. Lows

1. **Cuts inside the boxes the reader walks.** The present "cut at every length" test cuts the whole file, so a cut
   inside `meta` stops at the top level and never reaches the reads inside `iinf`, `infe`, `iref`, `cdsc` and
   `iloc`. Add a test that shortens each of those bodies by 1 to n bytes with the enclosing sizes rewritten to stay
   consistent, and asserts `heic` with no panic for every cut.
2. **Overflow of `base + offset` and of a length**: a test with `base_offset` `u64::MAX` and offset 1, and one with
   length `u64::MAX`: `heic`, no panic.
3. **Two of `iinf`, `pitm`, `iref` or `iloc` in `meta`**: today the first is kept, so an empty first `iinf` and a
   second holding the Exif item answers `none` ("no EXIF"), which is false. Seeing two of any of those four answers
   `heic`. Test it.

No change to the JPEG path, `block_is_safe`, the decode, or any existing assertion. (`jpeg_with` being `pub(crate)`
unused outside its module: leave it or take it back, as clippy prefers.)

## Checks

From src-tauri: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test exif`, `cargo test
heic`, the whole `cargo test`. Logs under `test-results/heic-exif/`. Read nothing from private/samples. Never start a
command with `python`. Nothing fetched through npx.

## Report back

What changed per point; each new test's name and result (and the crafted tree's time before and after, if you can
measure the old one quickly); each check's output line with counts.
