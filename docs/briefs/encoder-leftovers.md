# Brief: the stalled encoder's leftovers: clips, and a read that hangs (Kevin, Nov 20)

Work in the repo folder on branch `fix/encoder-leftovers` (already checked out, made from `v2`; don't switch). You
write Rust and its tests and run the checks below. You never commit, push or merge. Read CLAUDE.md's Workflow and
Safety sections, then `docs/briefs/stalled-encoder.md` whole (what 6.27m built in `src-tauri/src/playback.rs`, its
decisions, its seams and its tests) before the code.

## Where 6.27m left things

For playback copies: when an encoder stalls (nothing new from ffmpeg for the stall time), the app reads the file
itself from about where ffmpeg had got to. If it reads on, the encoder is at fault: the app goes on to the next
encoder, and "The video encoder stopped responding. Try again." shows only when none works. If the read hangs or
fails, the drive's words stay.

It left three things. Kevin, Nov 20, his words:

> The stalled encoder's leftovers: clips try the next encoder as copies do, with the same words; a read that hangs
> after a stall stops at once with the drive's words (the read-stall test then measures one stall time, and that's
> fine). No second encoder on the Mac for now.

## What to build

1. **Clips (`src-tauri/src/video.rs`, Save clip as file):** today a clip is rendered with the same list of encoders
   under one time limit, never goes on to the next encoder after a stall, and a hung one ends in the drive's "took
   too long" words. New: a clip behaves as a copy does.
   - An encoder that stalls on a clip: the same check of the file (the same function, not a second copy of it), from
     about where that encode had got to.
   - The file reads on: go on to the next encoder in the list. None left: the same words a copy gives (the encoder's
     message, with its own en and es line already in the locale files; reuse the constant and the key, add no new
     words unless a clip truly needs different ones, and then say why).
   - The read hangs or fails: the drive's words, as a clip gives them today.
   - A cancel still cancels at once, at every point: while encoding, while the check reads, between encoders.
   - A clip that an encoder makes whole is the same file as today: same recipe, same name, same sound, frame-accurate
     as it is now. Say whether a clip made by the second encoder can differ from the first's in anything a person
     would notice, and where the code says which encoder made it.
   - Keep the clip's overall time limit meaningful: say how it combines with a stall and a second encoder, and choose
     what a person would expect (no clip should now be able to run without bound).
2. **A read that hangs after a stall stops at once (copies and clips):** when the check after a stall finds the read
   hanging or failing, the work ends there with the drive's words. It does not go on to another encoder to wait a
   second stall time on a drive that isn't answering.
3. **No second encoder on the Mac.** The Mac's list stays as it is.

## Existing tests

- **Named by Kevin, changes with this brief:** the read-stall test,
  `stops_an_encode_stuck_on_a_read_partway_though_ffmpeg_goes_on_reporting` (Linux): today it expects at least two
  stall times before the drive's words; it now measures one. Change exactly the time it expects, and its comment.
- If another existing test of 6.27m pins "goes on to the next encoder even though the read hangs", that expectation
  changes with point 2 too: change exactly that and list it (name, old, new). If any other existing assertion would
  have to change, in playback.rs or video.rs, stop and report it first.
- Clip tests that pin today's words for a hung encoder: when the file reads on they now expect the next encoder or
  the encoder's words. List each one you change (name, old, new); change nothing about what a readable, healthy clip
  gives.

## Tests to add (with the shim and seams 6.27m's tests use; Linux-only where they are)

- A clip: the first encoder stalls on a readable file and the second makes the clip: the clip is whole, nothing is
  reported as an error.
- A clip: every encoder stalls on a readable file: the encoder's words, once, after the list.
- A clip: the encoder stalls and the read hangs: the drive's words after one stall time and the check's quiet time,
  never a second stall time.
- A copy: the same hung-read case ends after one stall time (the named test covers it; add the companion that shows
  no second encoder was started: count the processes).
- A cancel during a clip's check ends it at once.
- The file is read for the check at most once per stall, never for a clip that was made.

## Checks to run

- From `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test playback`,
  `cargo test video`, then the whole `cargo test`. Most of these tests run only on Linux: say which of yours ran
  here on Windows and which will first run in the PR's own checks.
- `npx tsc --noEmit`; unit: `node test-results/build627b/vitestUpper.cjs src/core/i18n src/features/video` (this
  shell's lower-case drive letter makes plain Vitest fail every file; that helper runs it from `C:\`).
- Logs go under `test-results/encoder-leftovers/`.

## Don't touch

- Stills. The copies' behaviour apart from point 2. The stall time, the check's limits, the recipe (`RECIPE`), the
  encoders' lists.
- The page, unless a clip's message key has to be wired where a copy's already is: then say what and why.
- CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, `.github`, `.claude`. Cargo.toml and Cargo.lock.
- No prettier. Never start a command with `python`. Nothing fetched through npx.

## Report back

How a clip now walks its encoders and where the shared check lives; how the clip's time limit combines with a stall;
each changed expectation (name, old, new); each new test's name, where it runs and its result; each check's output
line with counts; every test that failed on the way, by name; anything you would question.
