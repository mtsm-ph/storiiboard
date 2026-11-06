# Handoff

Written Nov 5, 2026, at a pause, so the work can go on from a cloud session that has only GitHub; updated Nov 6 after
2.3a, D1 and D2. Read `CLAUDE.md` first (the working rules), then `docs/PLAN.md` (scope, phases, status), then this file.
It replaces nothing in either; it says where the work stands and what comes next.

## What a cloud session can and can't do

- **Can:** read and change the code; run `npm run lint`, `npm test` (Vitest) and the Chromium end-to-end tests on
  Linux; open, review and merge pull requests; push checkpoint branches.
- **Can't:** run the desktop app; test the GPU encoders (Media Foundation on Windows, VideoToolbox on a Mac); build or
  try the installers; run anything on a Mac or on Windows. Those come from CI:
  - every pull request runs the quick checks on Linux (lint, types, unit tests, Rust tests with the ffmpeg sidecar);
  - a push to `checkpoint/<name>` runs the smoke and screenshot tests on Linux and on the Mac, builds both installers,
    and runs the Rust tests on the Mac and on Windows (so the real encoders run there; Windows' runner has no GPU, so
    only Microsoft's software H.264 encoder runs there, never the hardware one);
  - a push to `checkpoint/baselines-<name>` regenerates the Linux and Mac screenshot baselines as artifacts.
- The Rust tests need the ffmpeg sidecars in `src-tauri/binaries` (git ignores them). In a Linux session, build them
  with `scripts/ffmpeg/build.sh x86_64-unknown-linux-gnu src-tauri/binaries` (needs `nasm`; about 10 minutes), or
  leave the Rust tests to CI. See `scripts/ffmpeg/README.md`.
- **Network (Nov 6):** the default cloud environment blocks ffmpeg.org, so the build script can't download. This
  session made a personal environment, **storiiboard** (Kevin approved it), that also allows ffmpeg.org,
  downloads.videolan.org (dav1d), github.com and codeload.github.com; start new sessions on it. GitHub's archive
  downloads were still refused through the proxy even so; `git clone --depth 1 --branch release-3.0.6` of zimg works,
  and `git archive --format=tar --prefix=zimg-release-3.0.6/ HEAD | gzip -n` reproduces GitHub's tarball byte for byte
  (its SHA-256 matches the pin), so the pinned file can be made locally.
- **The reviewer agent** (`.claude/agents/reviewer.md`: read-only, reads a diff file, reports findings by severity) is
  loaded only when a session starts on a branch that has it. This session started on `main`, which doesn't, so its
  reviews ran on the `Plan` agent type (no Edit or Write tools) with `reviewer.md`'s instructions given word for word
  and "Read, Grep and Glob only, no shell". Start sessions on `v2` to get the agent itself. Write the diff
  (`git diff origin/v2...HEAD`) to a file it can read and point it there.
- **Windows and Mac code without a Windows or a Mac (D2):** `rustup target add x86_64-pc-windows-gnu`,
  `apt-get install -y gcc-mingw-w64-x86-64`, then `TAURI_CONFIG='{"bundle":{"externalBin":[]}}' cargo clippy --target
  x86_64-pc-windows-gnu --all-targets -- -D warnings` in `src-tauri` type-checks and lints the whole app and its tests
  for Windows (the override only skips Tauri's check for the Windows sidecars). For the Mac, `rustup target add
  aarch64-apple-darwin` and a scratch crate that includes a module by `#[path]` with `libc` checks code that uses only
  `libc` (the app as a whole needs a Mac's C toolchain). Neither runs anything: the checkpoint still does.

## Merged (Phase 2, into `v2`)

| PR | Milestone |
|---|---|
| #71 | 2.1: LGPL ffmpeg and ffprobe sidecars, built in CI from one pinned release; Rust reads a video's facts |
| #72 | 2.2a: schema 8 (video records, `clip`, `from_video`, `luts`); timecode maths; Rust stills and file status; the browser stand-in |
| #73 | 2.2b: link a video to a frame by drop or browse; the inspector's Video section; the missing flag and Relink |
| #74 | 2.3a: the playback-copy engine (`src-tauri/src/playback.rs`); see "2.3a as built" in `docs/PLAN.md` |
| #76 | D1: zimg and dav1d built into ffmpeg; HDR stills and copies tone-mapped to BT.709; AV1; see "D1 as built" |
| #77 | D2: the free-space floor for copies; ffmpeg ends with the app, crash or not (`src-tauri/src/os.rs`); see "D2 as built" |

Phase 0 and Phase 1 (with its polish) are merged too; `docs/PLAN.md` has every milestone and its PR. Phase 1's gate
(a real scene boarded in one sitting) is Kevin's to run.

## Open branches and pull requests

- **PR #1, `claude/add-core-features-qkifh` (draft):** from before the v2 rebuild. Leave it alone; it's Kevin's to
  close.
- Every other branch on the remote is merged work, or a `checkpoint/*` branch (CI runs only).

### 2.3a: how it went, and what's left

Five review rounds. Round 2's four mediums (N1 to N4) and its lows were fixed in round 3; reviews 3 and 4 found more,
fixed in turn: the stall timer could never fire once ffmpeg was running (FFmpeg 8 prints progress every half second
even when stuck, so only a count that goes up now counts), and `-profile:v high` failed every Windows copy (h264_mf
takes the number, 100), which the checkpoint caught. Round 5 left nothing high or medium. The last checkpoint
(`checkpoint/playback-2.3a-r6`) ran the copies on the Mac's VideoToolbox and Windows' software encoder.

For Kevin, on his own computers, first in 2.3b's checklist and in this order (Kevin, Nov 6):
1. Windows with a GPU: a copy of a real FX3 clip made by the **hardware** Media Foundation encoder (NV12, High
   profile). CI has no GPU, so that path has never run; if it fails, the software encoder makes the copy anyway, more
   slowly.
2. A Mac: a long take on an external drive; unplug the drive halfway through the copy (the copy should fail and leave
   nothing).

Lows deferred from the 2.3a reviews (noted, not planned yet):
- (Done in D2: a crash or Force Quit no longer leaves an encode's ffmpeg running; see "D2 as built".)
- A root shared by two computers (a NAS folder picked on both): each one's start-up clean-up and Move delete the other's
  half copies, and request ids start at 0 in every run, so partial names can collide. Fix: a per-machine token in partial
  names (`lock::Machine`'s id), and delete only this machine's partials, or others' only when old.
- A Clear (or the cap) running just as a make finishes can delete the copy that make returns; 2.4 must handle a copy
  going missing under the Player anyway (below).
- The "can't be set aside" branch of the settings load has no test (it needs a folder the test can't write; root ignores
  permissions, so skip when root).
- Audio stored as separate mono tracks keeps only the first (Canon and Sony MXF, recorders' MOVs): the copy has only
  CH1. Decided by Kevin (Nov 6), done in 2.3b: mix them all into one stereo track, with the gain kept low enough that
  it never clips; a single stereo track stays as it is.

Deferred from round 1 (still open): progress and Cancel for a long Move; key stability across path spellings; playing a
copy while the original's drive is unplugged (the record could keep size and time, for 2.4); the Player's open copy
evicted by the cap, Clear or a move (2.4); FAT32 roots and copies over 4 GB; a root inside a synced folder (warn, using
`synced.rs`); Forget when the remembered list couldn't be read.

### D1: how it went, and what's left

Three review rounds, nothing high or medium after the first; each fix tested. The first commit's checkpoint built zimg
and dav1d on all three platforms (Homebrew on the Mac, MSYS2 on Windows) and ran the HDR and AV1 tests on VideoToolbox
and Media Foundation. On the way: FFmpeg 8's own filters (bwdif, scale) refuse frames tagged with a matrix swscale
doesn't know (ICtCp, constant luminance), so HDR files so tagged are re-tagged for them and zscale reads the real one
(`video::ToneMap`); the file's HDR peak (MaxCLL, else the mastering display's) is handed to tonemap for PQ, since zscale
drops the metadata; a still tone-maps only its own frame (`trim` on the file's clock, the same time the seek uses).

Two checkpoints failed on Nov 6 because the Windows runner couldn't reach ffmpeg.org (timeouts and reset connections),
and the GitHub integration can't rerun failed jobs (403). So the pins and the download moved to
`scripts/ffmpeg/sources.sh`, and the checkpoint now has a `sources` job on Linux that fetches the three tarballs once
into a cache every runner can restore (`enableCrossOsArchive`, keyed by `sources.sh`). The Mac and Windows builds take
them through `SBD_FFMPEG_SOURCES`, still checked against their checksums, and download any that's missing (with
retries for up to a quarter of an hour). If a Windows build still can't get its sources, look at the `sources` job
first, then at whether the Windows restore found the cache.

Lows deferred from the D1 reviews:
- SDR files tagged with such a matrix (YCgCo screen captures, say) still fail in stills and copies, as before D1:
  give them the same re-tag with a matrix-only zscale (`m=bt709`) after the scale.
- Dolby Vision profile 5 (IPT, no PQ tag) isn't recognised and shows as ordinary video; profiles 8.1 and 8.4 play as
  their HDR10 or HLG base layer, which is right.
- zimg's HLG uses a 1.2 gamma per channel rather than BT.2100's luminance-based one: a slight saturation shift.
- The HDR peak is read from the container only; a transport stream that carries it only in its frames gets 1000 nits.
- HDR copies may keep the original's mastering and light-level boxes beside their BT.709 tags (unverified: making a
  test file with them needs an encoder the LGPL build doesn't have).
- Windows' `ffmpeg-SOURCE.txt` names the MSYS2 packages by who owns the linked libraries (paths through `cygpath`), with
  the old name match as a fallback; check its text in the next checkpoint's artifact.

### D2: how it went, and what's left

Review round 1 (four lenses, refute-first) found two mediums, both fixed: room was made by removing a whole batch of
copies before checking the drive gave the space back (now one at a time, stopping when one's space doesn't come back,
as with a Time Machine snapshot), and the older copy tests read the runner's real disk against the 10 GB floor (tests
now start with a drive that can't tell). Its lows were fixed too: a refusal for room no longer marks an earlier copy's
sound unreadable; a Move to a drive below the floor is refused with nothing changed; a Mac's leftover ffmpeg is known
by its id and start time, so a moved app or a development build still finds it; the kill test holds the killed app's
ffmpeg by a handle on Windows. Before the PR, the whole app was linted for Windows here (MinGW, above).

Round 2 found one medium, fixed: room-making kept no memory, so on a drive that keeps a removed copy's space each new
request removed one more copy; now that drive is remembered with what it had free, and nothing more goes there for
room until it reads more free. Lows fixed with it: the drive is read for up to a second after a removal (a NAS reports
freed space late), and just before each, without charging the copy being made for what it wrote meanwhile; a copy that
can't be removed is passed over only while the rest can still make the room; the watcher removes copies only if they
could also cover what's still to be written; a Move where nothing could cross is put back, with the folder it made;
Windows reads free space through the system's own spelling of the path (past 260 characters); and a copy that ends
between two readings is checked against the floor once more before it's kept.

Round 3 found one medium in the same place: the remembered drive was forgotten as soon as its reading rose at all, and
a refused copy's own partial, once deleted, makes it rise. Rather than patch each edge, room-making was made simpler:
the watcher during a copy only reads (down to the floor, the copy stops); room is made only on the make's own thread,
before its copy and once more when the copy is whole, so two never make room at once; a remembered drive is
forgotten only once its reading shows the space came back (by half the removed copy, plus what the refusal itself gave
back), or after half an hour, or when the floor or the folder changes. A Move put back for want of room keeps the new
folder on the list if a copy crossed there but its original couldn't go. The tests got a pretend drive that answers
by thread, so the watch and the final check are each tested alone (both checked by breaking each in turn).

Round 4 found a high in a test (it took 30 minutes from `Instant::now()`, which panics on a Windows machine up for
less than that: the clock starts at boot) and a medium: with the watch only reading, a copy bigger than its estimate,
or one of unknown length, was stopped at the floor every time though older copies could make the room. Fixed: a
remembered drive keeps the time it's forgotten (a deadline, only ever added to); a copy stopped at the floor is
measured by what it wrote (bytes per frame times its frames, or twice what it wrote when its length isn't known) and
made once more if older copies can make that room. With them: a new floor no longer forgets a remembered drive (a Move
that took effect does); a refused Move keeps the new folder on the list only if it wrote a copy there.

The first checkpoint (`checkpoint/d2-windows-sys` at f4529cb) passed on Windows (the Job Object and kill tests, both
installers) but the Mac's Rust tests failed: from one moment on, every copy test there stalled (ffmpeg made no
progress for 90 s, and even a killed one didn't end for 10 s), which points at the runner (its encoder service or its
disk) rather than at one test. The only heavy new work then was the floor-watch test's two 1080p encodes, one stopped
the moment it started; it now uses a light clip. The checkpoint also prints the runner's free space before the Rust
tests and what's left running after a failure (the test step has a 40-minute limit of its own, so a hang still gets
that printout). The second and third checkpoints (9ede3c3, d29925c) passed on Windows again; both Mac installer jobs
waited 15 minutes for a `macos-latest` runner and were cancelled before they started, while the smoke job on `macos-26`
started at once, so the installers now run on `macos-26` too (decided by default, review). The fourth checkpoint
(13d923b, `checkpoint/d2-windows-sys`) passed everywhere: the Mac's Rust tests ran in a few minutes with no stall (the
first run's stall didn't come back once the floor test stopped making 1080p encodes), and Windows ran the Job Object
and kill tests again.

Round 5 left nothing high or medium; its lows are below.

Lows deferred from D2 (noted, not planned yet):
- Room is made only from the copies in the folder copies go to now; copies of ours in another folder on the same drive
  (the cache folder standing in while a picked drive is away, a Move's leftovers) aren't removed for it.
- On a Mac, `statvfs` doesn't count the space macOS can purge on its own, so the app may make room (or refuse) when
  Finder shows more free; and APFS local snapshots can keep a removed copy's space for a while.
- On a Mac, a crash still leaves a probe's or a still's ffmpeg running until it finishes (it ends when it next writes to
  the closed pipe), or for good if it's stuck reading a share that stopped answering: their timeouts are the app's,
  and only the encodes' process ids are kept.
- If `playback-running.txt` can't be written (the data folder's drive full or read-only), the encode runs unrecorded,
  and a crash then leaves it running.
- A video whose earlier copy has no sound, refused for room, gets that copy back as if its sound were unreadable, and
  each later request for it waits its turn and tries again. 2.3b could say "no room" instead (a flag on `MadeCopy`).
- Raising the floor removes nothing at once; the next copy keeps to it.
- The retry after the floor (round 4) can't tell a copy that outgrew its estimate from another program still filling
  the drive: it may remove older copies and then be stopped again. Fix: read the drive before the first attempt, and
  retry only if the copy itself brought it down (or cap what the retry may remove at the estimate's excess).
- For a video of unknown length the retry asks for twice what was written, which measures the drive's spare room, not
  the copy; better not to retry on such an estimate (or find the length first). The estimate can also fall below what
  was written when the header's frame count was short.
- A copy whose ffmpeg ended on its own just as the watch saw the floor is thrown away and made again, where the final
  check could have judged it.
- A Cancel during the retry's room-making doesn't stop the removals already under way.
- A refused Move's "crossed" check looks for a file at the destination, not one this Move wrote.
- Tests: the floor-retry test doesn't count attempts, and no test pins a refusal after measuring; Held's survival across
  a refused Move and a new floor is untested.
- A copy held by another program is found only when its turn to go comes, so older copies may already have gone when
  the rest can't make the room (renaming the candidates aside first would find it before anything goes).
- A NAS that shows freed space more than a second late gets that drive remembered after one removal; it's forgotten
  once the reading shows the space, so the next copy goes ahead, but the one asking then is refused.

## Next steps, in order

1. **2.3b**: playback copies, what you see: the queue (one `make` at a time from the page, or the queue moved into
   Rust, since each waiting `make` holds a blocking thread), the copy's state in the inspector (soundless copies say so:
   `MadeCopy.silent`), Settings → Storage (copies, size, cap, the free-space floor, Move, Clear, remembered videos and
   Forget), and ffmpeg's licence (with zimg's and dav1d's). The commands: `playback_make` (progress on a channel;
   returns `{ path, silent }`), `playback_find`, `playback_cancel`, `playback_info`, `playback_clear`,
   `playback_set_cap`, `playback_set_floor` (D2), `playback_move`, `playback_move_back`, `known_videos_count`,
   `known_videos_forget`. `playback_info` also gives `floorGb` and `freeBytes` (null when the drive can't tell); a
   Move short of room fails with its own message after moving what fits, so the page should read `playback_info` again
   after any Move, whatever it returned.
2. **2.4**: the Player tile plays real footage (frame stepping, timecode, in and out, scrubbing), through Tauri's asset
   protocol scoped to the copies' folder. Copies have their index at the end (no `+faststart`); if the Mac's webview
   stumbles on that over the asset protocol, add the index pass back with a time allowance for it and bump `RECIPE`.
   Handle a copy going missing under the Player (the cap, Clear, a Move). **Review stop A** after it: run a checkpoint,
   write the checklist into the handoff, and keep going (Kevin tests in batches).
3. **2.5** LUTs (a `.cube` per video, applied to playback copies and stills, never the original; the LUT joins the
   copy's key); **2.6** crop over the Player; **2.7** still capture into a frame (from the original, LUT and crop
   applied, `from_video` recorded); **2.8** clip capture (in and out, plays in the inspector; Save clip as file);
   **2.9** JSON export and import, lossless.
4. **Phase 2 gate**: a checkpoint (smoke and screenshots on Linux and the Mac, both installers) and a checklist. The
   gate: a still from a reference clip lands in a frame in a few clicks, on Kevin's own footage. Don't wait; Phase 3
   follows.
5. **Phase 3** (production data), after the gate checkpoint passes: first write a Phase 3 plan and a one-page decision
   sheet (each decision: the question in plain words, the options, the recommendation and why, how hard it is to
   change later), then build in milestone order. Scope: project details and company profiles; locations (address
   search, map, photos, contacts, parking and power notes); cast and crew; department workspaces from a shot's row;
   shoot days with totals and the Calendar tile (month and week); gear per day linked to shots; a client contact and
   deliverables checklist; notification history; Assets and attachments. **Stop at the Phase 3 gate** (Kevin's real
   shoot's people, places and gear are entered) with a checkpoint and a checklist.

## The rules for this run (Kevin's queued instructions)

- One milestone at a time, each its own PR into `v2`. Every PR adds or updates tests for the flow it touches and
  updates the status in `docs/PLAN.md`.
- Run the reviewer agent until nothing high or medium is left. Merge with a merge commit (`gh pr merge N --merge`)
  once the quick checks pass.
- Update the handoff after every milestone (this file, now that work can come from a cloud session).
- **Decisions:** until the public release only Kevin's test projects exist.
  - Additive format changes (new tables or new fields) are approved, each with a migration, a backup first and tests.
  - Anything easy to undo: take the recommendation and mark it "decided by default, review".
  - Changes that alter or remove existing data wait for Kevin: write them down and skip to the next milestone that
    doesn't depend on them.
  - A new dependency always waits for Kevin (CLAUDE.md), unless listed as approved above.
- **Network and privacy:**
  - Address search follows the Nominatim policy: only when the person presses Search, at most one request a second,
    results cached, a generic app name in the User-Agent, never an email address.
  - Map tiles follow the OpenStreetMap tile policy: attribution, caching, no prefetching.
  - Tests never call live Nominatim, map tiles or Open-Meteo; they use recorded responses.
  - Contact details are private: never log them. Phase 8 has an option to save a copy of a project without them.
- **Safety** (CLAUDE.md): subagents, reviewers included, are read-only; never delete anything outside the repo's own
  build output; no git worktrees or directory junctions; no secrets in code; never log personal data.
- Commits end with the co-author line the session's instructions give; PR descriptions end with the generated-with
  line.

## Decisions

- **Pending for Kevin:** none.
- **Decided by Kevin (Nov 6):** a copy of a file whose sound is several mono tracks (Sony and Canon MXF) mixes them all
  into one stereo track, its gain kept low enough that it never clips; a file with a single stereo track stays as it
  is (2.3b).
- **Decided by default, confirmed by Kevin (Nov 6)**: everything below, Mobius tone-mapping and BT.2020 as the fallback
  included. Decisions made by default from 2.3b on are listed apart, for his review.
  - 2.2 and 2.3 were each split in two PRs, to keep reviews short.
  - A video record sits under the project, not a frame, so two frames can play parts of one video; a frame's picture
    is the video's frame 0 (the in point); a still picture replacing it ends the frame's clip; a video this computer
    can't read counts as missing.
  - Videos linked before are remembered on each computer (Rust keeps the list); a project's own folder is trusted for
    videos inside it; anything else waits for Relink. Relink asks when the rate, length, name, size or start timecode
    differs.
  - The sidebar's phase labels changed in 2.2b instead of 2.4, so the screenshots regenerated once.
  - Playback copies: named by the original's path, size and modified time (in two-second steps); a keyframe every 12
    frames; AAC stereo at 160 kb/s; 12 Mb/s H.264, High profile on Windows; the 50 GB cap removes the copies used
    longest ago; no index pass (`+faststart`); a stall is 90 s of no progress; a copy without sound only when the sound
    itself can't be read, named `-silent`; a file cut short gets a copy if it's within a second (or 1 in 100) of its
    length.
  - The checkpoint's Mac installer runs on `macos-26`, the smoke job's image, not `macos-latest` (D2).
  - The free-space floor (D2): 10 GB by default, from 1 to 1,000 GB; a copy's room estimated at 1.6 MB a second;
    room made only from the copies in the folder copies go to now, the ones used longest ago first, and only when
    they can make all of it; a Move short of room moves what fits and says so; ffmpeg's process ids kept on a Mac
    in `playback-running.txt`, beside the settings.
  - HDR (D1): Mobius tone-mapping (203-nit reference white near SDR white; Hable left it mid-grey), the file's own peak
    for PQ, else 1000 nits; tags a file leaves out taken as BT.2020, non-constant luminance, limited range.
- **Known lows, deferred:** a Trash restore of a video still doesn't bring back its clip (undo of Remove does); after a
  project switch, a first missing-file check that times out leaves the flags off until the next focus; bit depth falls
  to 8 for a few packed pixel formats when the decoder doesn't say; the timecode track's own rate (59.94p with 29.97
  timecode) isn't read.

## Not in the repo

`REPORT.local.md` and the Phase 2 plan's working copy stay on Kevin's PC; everything a session needs from them is
above or in `docs/PLAN.md`. The permission rules file (`.claude/settings.local.json`) is local to that PC too.
