# Brief: rusqlite 0.41.1 (Kevin, Nov 18 and 19)

Work in the repo folder, on branch `deps/rusqlite-0.41.1` (already checked out; don't switch branches). Read CLAUDE.md
first. Never commit, push or merge. Use Edit and Write for every file change (no sed, no heredocs, no `cargo fmt`
writes, no `prettier --write`). Logs and probes go in test-results/.

## Goal

Move the app from rusqlite 0.40.2 (libsqlite3-sys 0.38.2, SQLite 3.53.x) to **rusqlite 0.41.1**, which needs
**libsqlite3-sys 0.39.x** (SQLite 3.54). Kevin approved this upgrade (Nov 18) as its own PR. Why: RUSTSEC-2026-0459
(CVE-2026-119375, GHSA-72w2-rjgg-q729): SQLite before 3.54.0 can hand back uninitialised memory when a database is
opened with a sibling `-wal` file whose page size differs. Fixed in libsqlite3-sys >= 0.39.0. Nothing else in this PR.

Facts already checked (crates.io and GitHub, Nov 19):
- rusqlite 0.41.1: published 2026-10-28, `rust-version` 1.89.0, depends on libsqlite3-sys ^0.39.0.
- libsqlite3-sys 0.39.1: published 2026-10-25 (0.40.0 is Nov 11, too new: stay on 0.39.x).
- rusqlite 0.42.0 (Nov 11) and 0.43.0 (Nov 15) are under two weeks old: don't use them.
- 0.41.0's release notes, the parts that may touch us:
  - "Check PRAGMA <name> is valid with the help of pragma_list" (#1857);
  - "Make Statement::column_names, columns, columns_with_metadata return Iterator" (#1877);
  - "Use u64 for zeroblob" (#1867);
  - "Fix discrepancy between backup and restore" (#1893);
  - "Don't enable SQLITE_ENABLE_MEMORY_MANAGEMENT in the bundled build" (#1900);
  - a `Send` bound on create_aggregate_function / create_window_function (#1898);
  - minimal SQLite 3.45.3, bundled SQLite 3.54.0, edition 2024 (the crate's own; ours stays 2021).
- 0.41.1 adds only: no PRAGMA-name check with SQLCipher, and a panic fix for zero-argument deterministic functions.

## Steps

1. src-tauri/Cargo.toml:
   - `rusqlite = { version = "0.41.1", features = ["bundled"] }` (features unchanged);
   - `rust-version = "1.89"` (from 1.88), because rusqlite 0.41 declares 1.89. Nothing else in the file.
2. Update the lock to exactly those versions: `cargo update -p rusqlite --precise 0.41.1` from src-tauri (this is
   the only download allowed: crates.io, by cargo). Check that Cargo.lock has rusqlite 0.41.1 and
   libsqlite3-sys 0.39.1 (if cargo picks 0.39.0, use `cargo update -p libsqlite3-sys --precise 0.39.1`). List every
   other lock entry that changed and why (for example hashlink or fallible-iterator moving with rusqlite). If any
   changed crate is younger than two weeks (published after 2026-11-05), stop and report it; don't pick around it on
   your own.
3. Build and fix every compile error and new warning the upgrade forces, in src-tauri only. Keep each fix the
   smallest that keeps today's behaviour. **Name every forced code change** in your report: file, line, what the
   0.41 change was, what you changed.
4. Read the 0.41 source in cargo's registry (not the web) for the two behaviour changes that could reach us
   without a compile error, and report what you found:
   - #1857 PRAGMA names: every `pragma_update`, `pragma_update_and_check`, `pragma_query`, `pragma_query_value` and
     `pragma` call in src-tauri (backup.rs sets `journal_mode` and `synchronous`; find the rest). Does each name still
     pass the new check? The Rust tests that run these paths must still pass.
   - #1893 backup and restore: backup.rs makes full copies with SQLite's step-by-step backup API. Does the change
     alter what our copy does (pages per step, the destination's state, errors)? If yes, stop and report before
     changing backup.rs.
   - Also say whether we call anything that SQLITE_ENABLE_MEMORY_MANAGEMENT affected (sqlite3_release_memory,
     soft heap limits).
5. Add one Rust test (in the module that opens projects, src-tauri/src/sbd.rs, next to its other tests) that the
   bundled SQLite is at least 3.54.0 (`rusqlite::version_number() >= 3_054_000`), with a one-line comment naming
   RUSTSEC-2026-0459, so a later downgrade can't bring the bug back unnoticed.
6. docs/SBD_FORMAT.md: if it names the SQLite or rusqlite version anywhere, update it; if not, leave it.

## Checks to run

- From src-tauri: `cargo test` (all Rust tests, the `test` feature's command tests included, as the repo's scripts
  run them: see package.json's Rust scripts and use the same command) and `npm run lint:rust` from the repo root.
  Paste the pass counts. Before the change, the suite had 321 passed and 1 ignored (Nov 18); any difference is
  explained.
- `npm run lint` and `npx tsc --noEmit` are not needed unless you touched TypeScript (you shouldn't).
- Don't run Vitest or the end-to-end tests: nothing outside src-tauri changes, and the full suites run on GitHub at
  the checkpoint.

## Don't touch

- Any TypeScript, any test outside src-tauri, CI files, .claude, CLAUDE.md, PLAN.md, HANDOFF.md.
- kamadak-exif (its own PR later), ring, any other dependency's version.
- Existing tests and assertions: never weaken, skip or delete one. If one fails because of the upgrade, stop and
  report it with the failure.

## Report

Lock entries changed (name, old → new, published date); every forced code change; the PRAGMA, backup and memory
findings; the new test's name; the check results with counts; anything you were unsure of.
