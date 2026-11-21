# A stalled encoder says so, and the drive's words stay for a drive (6.27m): brief

Kevin, Nov 19 (item 8, fix 3) and Nov 20 ("yes to the proposal and its two changed expectations"; "when the file
reads fine and the encoder stalled, the app should try the next encoder by itself, and show that message only when
none of them works").

## What the app does today (read from the code, Nov 20)

- A playback copy tries its encoders in order (`encoders()` in `src-tauri/src/playback.rs`): on Windows the hardware
  Media Foundation encoder, then Microsoft's software one; on the Mac VideoToolbox alone; on Linux `mpeg4`, for the
  tests.
- When one stalls (nothing new from ffmpeg for `STALL`, 90 s) and another follows, the app already goes on to the
  next by itself, provided the original still answers `video::starts` (one ffprobe of the file's start).
- Whatever follows, a stall always ends in the drive's words (`STALLED`): "That video stopped being read partway. If
  it's on a card, a drive or a network share…". An encoder hung in its driver gets those words too.
- `video::starts` reads only the file's start, so it can't tell a share that hangs partway from an encoder that hung.

## Goal

After a stall, the app reads the file itself past where ffmpeg stopped, with a time limit.

- The read hangs or fails: the drive's words stay (`STALLED`).
- The read keeps answering: "The video encoder stopped responding. Try again." No card, drive or share in it.
- These words show only when no encoder made the copy. Going on to the next encoder stays as it is today.

## Decisions

- **The words.** A new const beside `STALLED`: `ENCODER_STALLED`, "The video encoder stopped responding. Try again."
  - en.ts: `'error.copyEncoderStalled'`, the same text, right after `'error.copyStalled'`.
  - es.ts: "El codificador de video dejó de responder. Vuelve a intentarlo." (es.ts already says "codificador" and
    "vuelve a intentarlo").
  - The page shows Rust's text through `localizeError`, which matches it against en.ts's `error.` entries, so the
    const and the en.ts entry must be the same text, character for character.
- **Where the words are chosen:** the two places a stall names the failure today, both after the encoders' loop in
  `make`'s body:
  - the outcome is `Stop::Stalled`;
  - the outcome is `Stop::Failed(said)` after an earlier stall, with no read failure of its own (today's "A later
    attempt that failed with no cause of its own, after one stalled").
  In both: the check below, then `ENCODER_STALLED` if the file keeps answering, `STALLED` if not. Every other outcome
  keeps its words.
- **When the check runs:** once, after the loop, only for those two outcomes, and never after a Cancel (the existing
  `asked.stopped()` override comes first and wins). It reads past the latest stall, so the loop remembers where each
  stall stood (`reached`, the last frame ffmpeg reported) instead of the bare `stalled` flag.
- **The loop itself doesn't change.** `Err(Stop::Stalled)` still breaks on the last encoder or when
  `video::starts(path)` fails, and still goes on to the next encoder otherwise. Nothing about when a second encoder is
  tried changes, and no timing in an existing test changes.
- **No check where it could tell nothing new** (review, Nov 20):
  - the loop ended because `video::starts` itself failed: the drive is already known not to answer, so the words are
    `STALLED` with no check (the loop only notes that this is why it broke);
  - the message is about to be thrown away because an earlier copy is kept instead (`keep_earlier`): no check. If
    that needs more than a small condition, leave it and say so in the report.
- **A computer's sleep during the check is not a hang, and not an answer either.** A gap between two looks at the
  reader longer than `SLEPT` restarts the quiet time, as the encode's own watch does, and the budget doesn't count
  the sleep: its start is moved on by the same gap. Otherwise, on Windows (whose clock counts a sleep), a sleep
  longer than the budget would end the check as "keeps answering" with nothing read since the wake.
- **The check: does the file keep answering past where ffmpeg stopped?**
  - Where to start: no byte position is known, only frames. Start at `size × reached ÷ total` (the file's size, the
    last frame reported, the frames expected); at 0 when the total isn't known. Bytes before that point were just
    read and may come from the system's memory; bytes after it must come from the drive.
  - It reads forward in chunks (1 MiB) on a thread of its own, reporting each chunk to the caller.
  - **It hangs** when no chunk arrives for `CHECK_QUIET` (5 s), or a read fails, or the file can't be opened: the
    drive's words. A read that never returns can't be stopped: its thread is left to end by itself, as a hung ffmpeg
    is today.
  - **It keeps answering** when it reaches the end of the file, or has read `CHECK_SPAN` (1 GiB), or is still moving
    after `CHECK_BUDGET` (15 s): the encoder's words. A slow share that keeps going is not a hang.
  - A Cancel during the check ends the wait at once; the copy's outcome is the cancel, as today.
  - The three limits are fields of the cache with those defaults, as `stall` is, so tests shorten them.
- **The seam for the read-stall test:** how the check opens the file is a field of the cache (a function from the
  path and the starting byte to a boxed reader). The app's own is `File::open` and a seek. A test may put a reader
  that never answers in its place. No environment variable, nothing under `cfg(test)` in the check's own logic.
- **Stills and clips are not changed.** A still uses the PNG encoder in software and its own time limit; the drive's
  words fit. A clip uses the same encoder list under one total time limit and never tries the next encoder; that is a
  question for Kevin, not part of this brief.
- **The Mac's list stays one encoder.** A second one there is Kevin's to decide and needs a Mac.

## Files

- `src-tauri/src/playback.rs`: the const, the check, the cache's new fields, the two places the words are chosen,
  the tests.
- `src/core/i18n/locales/en.ts`, `es.ts`: the new key.
- Nothing else. `src-tauri/src/video.rs` is not touched (`run_stoppable` stays private: the check is not an ffmpeg
  run).

## Existing tests that change (these and no others)

Kevin approved two changed expectations. They are the two tests that expect the drive's words while the file itself
reads fine:

1. `stops_an_encode_that_says_nothing_for_the_stall_time_and_frees_the_turn` (every system; one encoder, a readable
   file): `assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), STALLED);` becomes `ENCODER_STALLED`. Nothing else in
   it changes.
2. `a_failure_after_a_stall_reports_the_stall` (Linux; the shim hangs ffmpeg's reads, the app's own read works):
   `assert_eq!(making.join().unwrap().unwrap_err(), STALLED);` becomes `ENCODER_STALLED`. Its `attempts == 2` stays.

One more test gets a line of setup and no changed assertion:

3. `stops_an_encode_stuck_on_a_read_partway_though_ffmpeg_goes_on_reporting` (Linux): the shim hangs only ffmpeg, so
   the test gives the cache a reader that never answers (the seam) and a short `CHECK_QUIET`. It must still end in
   `STALLED`, still take at least two stall times, and every assertion stays as written. Its comment says what the
   seam stands for.

If any other existing assertion fails, stop and report it: name, what it expects, what it got.

## Tests to add

Every system unless marked:

- The check by itself, with readers the test makes:
  - a real file read to its end keeps answering;
  - a reader that blocks for good is a hang, within `CHECK_QUIET` (shortened);
  - a reader that fails is a hang;
  - a missing file is a hang;
  - a slow reader that keeps handing over chunks past `CHECK_BUDGET` (shortened) keeps answering;
  - reaching `CHECK_SPAN` (shortened) keeps answering;
  - a Cancel during a blocked read ends the wait quickly.
  - The slow reader's test must be able to fail: its quiet time shorter than its budget (say 300 ms and 1 s, the
    reader handing over a chunk every 50 ms), so only chunks that restart the quiet time get it to the budget.
  - A gap longer than `SLEPT` between two looks restarts the quiet time.
- Where the read starts: the middle for half the frames, 0 when the total is unknown, never past the file's end.
- Inside `make`, through the seam:
  - a Cancel while the check waits on a reader that never answers gives `CANCELLED`, quickly;
  - the file is opened for the check exactly once when every encoder stalls, and never for a copy that was made (an
    opener that counts);
  - a stall, then `video::starts` failing: `STALLED`, and the opener is never asked (if that can be arranged without
    a shim; else say so).
- **Linux, with the shim:** the check starts from where the stalled encode had got to: the shim hangs at half the
  file, one encoder, an opener that records the byte it is asked for: between a quarter and three quarters of the
  file's size.
- Every encoder stalls on a readable file: two light encoders, a 1 ms stall: `ENCODER_STALLED`, and both were tried.
- A stall, then a reader that fails (the seam): `STALLED`.
- **Linux, with the shim:** a stalled encoder with a readable file goes on and makes the copy. The shim gets one new
  mode, `once`: the first process to reach the cut point makes a marker file (`O_CREAT | O_EXCL`) beside the clip and
  hangs; every later process reads on. Encoders `[E, E]`: the copy is whole, nothing is reported as an error, and
  `attempts == 2`. The shim's existing modes are not changed.
- Vitest: `src/core/i18n/i18n.test.ts` passes as it is (it finds the new const and wants its en.ts entry; es.ts must
  have the same key). Add nothing to its lists.

The Linux-only tests can't be compiled or run on this PC: they run in the pull request's own checks. Write them with
care, and say in the report which tests you could not run here.

## Checks to run

1. `npm run lint`.
2. `cargo test --manifest-path src-tauri/Cargo.toml` (the whole suite; playback's tests take a few minutes).
3. Vitest, the whole suite.
4. No end-to-end run: no screen or flow changes.

## Don't touch

- The encoders' loop's rules, `encoders()`, `STALL`, `KILL_GRACE`, the watch loop.
- `src-tauri/src/video.rs`, stills and clips.
- Any assertion other than the two named above; the shim's existing modes.
- `CLAUDE.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/ALPHA_TEST.md` (the main session writes those).
- CI, `.claude`, dependencies.

## Report

The files changed, the tests added, each check with its counts, the tests you could not run on Windows, and anything
uncertain: above all the check's three limits, if what you saw suggests other numbers.
