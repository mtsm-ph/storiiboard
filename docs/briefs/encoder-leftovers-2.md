# Brief: the stalled encoder's leftovers, round 2: the clip's last rewrite, its destination, three small points (6.27x, #235)

Branch `fix/encoder-leftovers` (the main session checks it out for you; don't switch). Never commit, push or merge.
Read `docs/briefs/encoder-leftovers.md` on this branch first: this round fixes what its review found.

## 1. High: a healthy long clip to a slow drive must not be taken for a stall

A clip keeps `-movflags +faststart`: at the end of the encode ffmpeg rewrites the whole file to move its index to the
front, and prints no progress while it does. Round 1's watch takes any 90 s without a rising frame count as a stall,
so a 10-minute clip saved to a share that moves about 15 MB/s (a rewrite of about 120 s) would be killed every time,
the source would answer, the next encoder would do the same, and the person would read "The video encoder stopped
responding. Try again." for a clip that saved fine before. (Copies leave `+faststart` out for exactly this reason:
see the comment above `STALL` in playback.rs.)

- Once ffmpeg has reported the clip's last frame (its count reaches the clip's frame count), stop the stall watch for
  that encoder; the clip's own time limit stays in force and ends the run as today if it never finishes. Don't change
  the clip's recipe (`+faststart` stays).
- Test (Linux, with the shim, as round 1's clip tests): the clip's encode finishes its frames quickly, then the
  writing of the output is slowed past the stall time (the shim already slows reads of files whose name holds
  "cutme"; give it what it needs to slow the rewrite, for example `CUT_SLOW_MS`, without changing how the existing
  tests use it): the clip is saved, one attempt, no error.

## 2. Medium: the clip's destination

A clip's destination is wherever the person saves it, often a NAS or a USB drive. If that drive stops answering
mid-encode, ffmpeg blocks on its write and the watch sees a stall; the check reads only the source, which answers, so
round 1 goes on to the next encoder and opens its new partial on the dead drive, on the calling thread, with no
limit and no way to cancel.

- After a stall, before trying the next encoder, also check the destination folder answers: one small operation
  (for example creating and removing an empty file beside the clip, or reading the folder's metadata) on a thread of
  its own, under the check's quiet time and cancellable. If it doesn't answer, end at once with the drive's words a
  clip gives (as for a hung read of the source).
- The next encoder's partial is created only after that check, and its creation can't block the caller forever
  (on the same kind of thread, under a limit, cancellable).
- Tests: a destination that stops answering after the first stall ends with the drive's words, one attempt, and a
  Cancel during that check ends at once. Use the seam round 1 used for the source's reader, or a new one beside it:
  never a real network drive.

## 3. Low points

1. The read-stall test's new upper bound (`took < 2 * cache.stall`) includes probes and start-up and may be flaky on a
   busy runner. Keep Kevin's "one stall time" as the lower bound (`took >= cache.stall`) and prove "never a second
   encoder" by `attempts == 1` instead of the upper time bound. This is round 1's own change to that test.
2. A Cancel that lands right after the last stall or failure can give the encoder's words instead of "cancelled":
   end a clip as a copy ends, checking the stop flag one last time before returning an error.
3. The assertion message in `the_file_is_read_for_the_check_once_when_every_encoder_stalls_and_never_for_a_copy_made`
   still says "once, after the loop": the read now happens in the loop. Update the words of the message only; the
   assertion itself stays.

No other existing assertion changes.

## Checks

From src-tauri: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test playback`, `cargo test
video`, the whole `cargo test`. Say which new tests run here and which only on Linux. Logs under
`test-results/encoder-leftovers/`. Never start a command with `python`. Nothing fetched through npx.

## Report back

What changed per point; each new or changed test's name and where it runs; each check's output line with counts.
