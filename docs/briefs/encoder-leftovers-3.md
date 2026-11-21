# Brief: the encoder's leftovers, round 3: tell the clip's final rewrite from a stall, by what ffmpeg really says (#235)

Branch `fix/encoder-leftovers` (the main session checks it out for you; don't switch). Never commit, push or merge.
Read `docs/briefs/encoder-leftovers.md` and `-2.md` on this branch first.

## Why (a review of round 2)

Round 2 stops watching a clip for a stall once ffmpeg has reported its last frame, so the `+faststart` rewrite at the
end (which prints no progress) isn't taken for a stall. The review says that report never comes in time: in ffmpeg
7.x and 8.x the periodic `-progress` blocks are printed only inside the main loop; after it come the stop, the
trailer (the mov trailer is where the moov atom is moved and the file rewritten) and only then the final report with
`progress=end`. A periodic block shows the last frame only if a 0.5 s tick falls in the milliseconds between the last
packet and the end of the loop. So a long clip to a slow share is still killed, and round 2's Linux test
`a_clip_whose_index_rewrite_outlasts_the_stall_time_is_saved_by_its_first_encoder` should fail.

## 1. Find out first, with the bundled ffmpeg on this PC (`src-tauri/binaries/ffmpeg-*.exe`)

Encode a clip as the app does (its own argument list, from a test fixture clip into `test-results/encoder-leftovers/`),
with `-progress pipe:1 -nostats` and the log level the app uses, and record with timestamps:

- whether any progress block before `progress=end` reports the clip's last frame;
- what ffmpeg writes to stderr around the rewrite. The review expects movenc's info line "Starting second pass:
  moving the moov atom to the beginning of the file" just before it, at log level info or above.

Report both. If neither gives a signal before the rewrite, stop and report: don't build a guess.

## 2. Build on the signal that exists

If stderr carries that line at a log level the app can use without flooding its pipe, read ffmpeg's stderr live (on
its own thread, drained to the end whatever happens, as the progress pipe is) and stop the stall watch once the line
is seen; the clip's own time limit still ends a rewrite that never finishes. Make sure:

- the extra info lines don't change how the app reads ffmpeg's errors (`read_failed_in` and the words it chooses):
  test that a read failure is still recognised with the info lines present;
- copies are not affected (they don't use `+faststart`);
- the round 2 "last frame reported" rule stays as a second way in if it ever happens.

Also, the review's low: in `the_next_encoders_file_is_made_aside_after_a_stall_and_one_made_too_late_is_removed`, poll
`no_partials_in` until it is true under the same 10 s bound instead of checking once (the file is removed just after
`late` is set).

## Tests

- The Linux rewrite test from round 2 must pass for the right reason: add an assertion that the signal was seen.
- A unit test of the line recogniser on real stderr text you recorded (no real path or name in it: replace with
  made-up ones).
- No assertion from before this PR changes.

## Checks

From src-tauri: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test video`, `cargo test
playback`, the whole `cargo test`. Say which tests ran here and which only on Linux. Logs under
`test-results/encoder-leftovers/`. Never start a command with `python`. Nothing fetched through npx.

## Report back

What ffmpeg printed (both questions, with timings); what changed; each test's name, where it runs and its result;
each check's output line with counts.
