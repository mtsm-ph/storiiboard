# Handoff

Written Nov 5, 2026, at a pause, so the work can go on from a cloud session that has only GitHub; updated Nov 9 at the Phase 3 gate (first updated Nov 6 after
2.3a, D1, D2 and 2.3b, all merged). Read `CLAUDE.md` first (the working rules), then `docs/PLAN.md` (scope, phases, status), then this file.
It replaces nothing in either; it says where the work stands and what comes next.

## Only Kevin (keep current; the same list ends every report)

What only Kevin can do or answer, one line each, with what it unblocks. Nothing a session, a review or CI can settle.

- **Run the launch check on your own Mac** (about five minutes). On #223's branch, `ci/launch-check-accents`:
  `npm run tauri build -- --debug --no-bundle`, then `bash scripts/launchCheck.sh src-tauri/target/debug/storiiboard`.
  It prints eight lines. `accents ok`: the failure on nov20-c is GitHub's virtual Mac, and the question becomes what
  the check should do there. A failure: the line says which call failed and what the page gets, and choosing a
  project's key image or logo is broken in the Mac app. The check's own picture is ruled out, and the likely call is
  the worker reading its canvas back, `(worker: read)` (start here, below). Unblocks: #206, #213, #219 and #223.
- **Name the next checkpoint, and say whether a job that is green with a flaky test is enough to merge on.** Tonight
  it was read as no, and no checkpoint was clean anyway. Flaky this night, none touched by the PRs beside them:
  - perspectiveViews.spec.ts, "a gaffer sees Grip & electric first…" (nov20-a, the Mac): the first letter typed
    after "+ New person" was lost (the person was "am Ortiz"). The spec's `addPerson` types before the name field
    has focus.
  - planLayers.spec.ts line 220 (nov20-a, the Mac; not the scroll bar this time): after the reload, Setup was
    clicked while the project was still opening, and the app then showed Storyboard.
  - pictures.spec.ts, "a paste while typing in a field…" (nov20-b, the Mac): "Target page, context or browser has
    been closed" during set-up, which reads as the browser on the runner.
  - themes.spec.ts, "every family's theme passes axe on the board, light and dark" (nov20-c, Linux): its axe run
    passed the test's 120 s on the first try and took 1.8 min on the retry. CLAUDE.md's rule for that is fewer
    workers, never a longer limit.
  For the first two: fix the test (wait for the field's focus; wait for the project to be open), or the app (the
  name field takes focus at once; a section chosen while a project opens is kept)? Unblocks: #208, #214, #215,
  #218 and #221, which wait only for a checkpoint.
- **#222, the Layers tile against the scroll lane: three choices.** At its default size the tile already overflows
  by its keys line (433 px of content in 376), so it gets the 16 px lane, the Grip row wraps and the list no longer
  shows whole. (1) Stop the tile overflowing at its default size: the keys line shows only when there is room, or
  moves; recommended, since it also removes the bar this started from. (2) Let the row wrap and change that test's
  expectation. (3) A narrower lane. Unblocks: #222, and then `checkpoint/baselines-nov20` for its pictures.
- **The agents' model (#211, open, not merged).** The overnight message carried two opposite lines: typed, "set
  `model: inherit` in builder.md and reviewer.md as a docs-only PR first"; in the note, "Don't change those files
  tonight." #211 is the first line, ready; `v2`'s agent files are unchanged. Merge it or close it. Unblocks: which
  model builders and reviewers run on from the next chat.
- **#207: player.spec's busy-page test, the one it rewrote, failed twice with the same numbers on nov20-a** ("frame
  22 reported after 1 missed (1 allowed)"). The out frame's callback ran 98 and 90 ms after its picture (over 2
  frames late); the clip paused in that very callback; frame 22 had already been shown. #207's count gives credit
  for frames skipped between two reports (1 here), not for a callback that is late for its own frame (2 here). The
  app did its part; the count is short. Proposed: what a run past the out point is allowed also counts how late the
  turning callback ran (whole frames of its `now` minus its presentation time). Both kept reports pass with it
  (test-results/nov20a-frames on Kevin's PC; they belong with the fix as fixtures). It loosens a test's allowance,
  so it is Kevin's. Unblocks: #207.
- **The launch check: what it can and can't prove** is in docs/briefs/launch-check.md (in #213). Its first Mac runs
  added one line to "can't": Playwright's WebKit is newer than any Safari, so a green end-to-end run on the Mac does
  not mean the Mac app can do it.
- **The stalled encoder (#214), three things it leaves:** a second encoder on the Mac (it has one, so a stall there
  has nothing to fall back to; a software one changes clips too and needs a real Mac); clips (the same encoder list
  under one time limit, never the next encoder, the drive's "took too long" words for a hung one); stopping at once
  when the read hangs (saves a second 90 s wait, changes what the read-stall test measures). Unblocks: each, if
  wanted.
- **HEIC on Windows (#215, #218), what was chosen where the plan was silent:**
  - Five new lines in English and Spanish (too large, not a HEIC, took too long, couldn't be read, its profile is
    too large): only the HDR line is Kevin's wording. They are in #215's description.
  - "At most two at a time" is a gate in Rust; within one add, photos are still read one after another. Reading two
    side by side means changing the three add loops.
  - The storyboard's footer now also counts photos added in the Locations tile (the count was already shared with
    moodboards).
  - A HEIC whose grid carries a colour profile that its tiles don't is refused as unreadable, never guessed. None
    has been seen: Kevin's two iPhone photos and the fixture carry it on both.
  - With no profile, the grid's own colour numbers are used over its tiles'. One that says "unspecified" (2, or the
    reserved 0) falls to what the tiles' stream says for that number, so the two numbers can come from two places; a
    stated number the page can't be told makes the photo sRGB. No such file has been seen.
  - No limit on a photo's pixels: a 200 MP HEIC would take over 1 GB while decoding, or be refused as too slow. Name
    a number to refuse it first.
  - Not covered: a HEIC as a project's key image on Windows (the accent reader takes its own path), and a HEIC
    original printed in a deck.
  - The Mac test in #218 (Apple's decode against ffmpeg's, within 3 levels) has never run.
  Unblocks: nothing; each can change after the merge.
- **An HDR HEIF from Kevin's camera** in private/samples, when he can. Unblocks: HDR HEIF beyond a refusal.
- **The work list after the night's five items: nothing on it could start, and one item needs a word.** OSV-Scanner
  2.7.1 is dated Nov 23; the bigger screenshot milestones are Kevin's by his Nov 20 note. One of the items kept in
  `private/NOV20_START.md` ("Still on the list from before") could be built now, but it sits outside the current
  phase: the question is in the Nov 20 morning report and at the end of `private/NOV20_NIGHT.md`. Unblocks: the
  next thing to build while the open PRs wait for a checkpoint.
- **Three things to delete** (deleting is Kevin's; no work waits on any):
  - The Nov 19 session's scratch folder: it still holds a decoded copy of one of Kevin's HEICs and two error logs,
    one with its file name. Kevin, Nov 20: "Leave the old scratch folder to me." Closes the Nov 19 slip.
  - Inside private/samples, the folder `.probe` that the Nov 20 night's yes-or-no probes wrote (decoded copies of the
    two sample photos and ffprobe's answers; nothing of them left that folder).
  - The branch `docs/nov20-night-2` (its PR, #216, was closed: a script lost the names in code marks; #217
    replaced it).

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
| #79 | 2.3c: silent tracks left out of the mix; a relink's undo never leaves the other file's copy; see "2.3c as built" |
| #80 | 2.4: the Player plays real footage (stepping, timecode, in and out, scrubbing) from playback copies; review stop A reached; see "2.4 as built" |
| #81 | 2.5: LUTs per video (a .cube grades the playback copy, never the original; one edit each, undoable); see "2.5 as built" |
| #82 | 2.6: framing a frame's clip over the Player (the window moves and zooms over the take, one undo step each); see "2.6 as built" |
| #83 | 2.7: still capture into a frame (from the original, graded, framed, one undo step); see "2.7 as built" |
| #84 | 2.8a: the frame's clip plays in the inspector (in to out, framed, from the copy, only when asked); see "2.8a as built" |
| #78 | 2.3b: the copies as the person sees them (queue, inspector, Settings → Storage, licences); mono tracks mixed; see "2.3b as built" |
| #85 | 2.8b: Save clip as file (from the original, framed, graded, frame-exact, with sound, `SC004_4A.mp4`); see "2.8b as built" |
| #86 | 2.9: project data as JSON, out and back (the whole project, History and Trash included); see "2.9 as built" |

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

Its two tests on Kevin's own computers (the hardware encoder, a drive unplugged) head 2.3b's checklist, below.

Lows deferred from the 2.3a reviews (noted, not planned yet):
- (Done in D2: a crash or Force Quit no longer leaves an encode's ffmpeg running; see "D2 as built".)
- A root shared by two computers (a NAS folder picked on both): each one's start-up clean-up and Move delete the other's
  half copies, and request ids start at 0 in every run, so partial names can collide. Fix: a per-machine token in partial
  names (`lock::Machine`'s id), and delete only this machine's partials, or others' only when old.
- A Clear (or the cap) running just as a make finishes can delete the copy that make returns; 2.4 must handle a copy
  going missing under the Player anyway (below).
- The "can't be set aside" branch of the settings load has no test (it needs a folder the test can't write; root ignores
  permissions, so skip when root).
- (Done in 2.3b: sound stored as separate mono tracks, as Canon and Sony MXF keep it, is mixed into the copy's
  stereo, Kevin's decision of Nov 6; it used to keep only CH1.)

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

### 2.3b: how it went, and what's left

What it is: "2.3b as built" in `docs/PLAN.md`. The page's side of the copies: the queue
(`src/features/video/playbackCopies.ts`), the drivers (`src/app/playback.ts`: the desktop one over Tauri's commands, the
browser build's stand-in), the inspector's copy line, and Settings → Storage's sections for this computer
(`src/app/project/PlaybackCopies.tsx`). Rust adds the mix of several mono tracks (`playback.rs`, `video::audio_tracks`)
and `licence_text` (`src-tauri/src/licences.rs`). The end-to-end tests found that Escape in a window opened from inside
Settings closed Settings too; fixed in `InAppWindow` for every window.

Review round 1 (Nov 6): one high, four mediums, all fixed and tested.
- The high: any failed attempt dropped the mix of mono tracks, so on Windows without a GPU (the hardware encoder fails
  first, then the software one makes the copy) every copy kept CH1 only. The mix is now given up only when it's the
  cause (the mix alone tried for a second, as the first track is); then the tracks that decode are mixed. Tests: the
  mix kept after a failing first encoder; a broken first track leaves the second, never a copy without sound.
- Make playback copy lost keyboard focus (the button went as the copy was queued): Make and Cancel are one button now.
- The cap or floor saved on leaving the field moved focus to the status line, and a change made while another action
  ran was dropped while the field still showed it: saves now go beside actions, leave focus alone, and snap back if not
  saved.
- Lows fixed with them: a cancelled copy's late result no longer overwrites the same video queued again; a copy known
  as made is looked for again when asked for; a lower cap tells the inspector; an undo of a relink makes the inspector
  look again; Forget saves before forgetting and says so in its own words; a cancelled confirm leaves focus on its
  button; the status line is read after the copies are; Move says a copy is being made before asking for a folder;
  the copies unreadable say why and offer Move back; Spanish thousands in the GB fields; an entry out of range says so;
  the e2e Cancel no longer races the stand-in; stronger test assertions (handle, localized failure, levels within 1 dB).
- The a11y sweep's "Tab goes round" test clicked blank space in Storage with no project open, which had no controls
  before 2.3b; it now uses Project's panel, which still has none (Tab from a panel with controls goes into them).

Review round 2: nothing high or medium (two mediums raised, both refuted). Its lows, fixed with tests: when a mix
can't be made but each track decodes alone, the first track alone (round 1 had made that copy fail); a mix that reads
counts as the sound read; a Cancel stops the trying of tracks one by one; tracks that can't be counted give no copy
yet rather than one with CH1 alone; Forget refuses when its list couldn't be read at start (it would come back); a
failure keeps its words through a Clear, a Move or a cap change; a shown copy is looked for again once another is
made (only shown ones: each look counts as a use for the cap); the copy button lets go of focus it no longer has,
sends focus to Relink if the video went missing, ignores a double click and a held key, and takes focus on a click
(a Mac's WebKit doesn't); thousands only as grouped ("12.5" in Spanish was saved as 125); a failed re-read says so;
Enter saves the cap or the floor where it is, focus kept, and each save is said; the re-queue test can now fail.

Review round 3 (round 2's fixes only): one medium, fixed: the copy button let go of focus when the whole window lost
it (another app in front), so a copy finishing meanwhile left focus on the page; it now lets go only when focus is on
something else (an end-to-end check sends the window's blur and fails without the fix). Its two lows, fixed: tracks
that can't be counted no longer mark an earlier copy without sound as settled for the session; a field reset after a
save keeps what the person typed on since.

Checkpoint r1 (`checkpoint/playback-2.3b-r1`, before round 1's fixes): smoke and screenshots passed on Linux and the
Mac. Windows' Rust tests failed on the mix, as round 1 found ("the second track is heard: -91 dB": the hardware encoder
failed, the mix was dropped); fixed. The Mac's failed once in `holds_a_finished_copy_to_the_floor_before_it_keeps_it`
(D2's test, one mono track, so not the mix): its second copy failed in the encoder, which the test can't say more of.
It passed at D2's checkpoint; 2.3b added copy-making tests that run beside it, and VideoToolbox is the Mac's only
encoder. The tests now print ffmpeg's own words for a failing test (`#[cfg(test)]` only), so a repeat says why.

Checkpoint r2 (`checkpoint/playback-2.3b-r2`, round 1's fixes): all green. The Rust tests passed on the Mac
(VideoToolbox; the floor test too) and on Windows (the mix kept after the hardware encoder failed), both installers
built and their `.sbd` association checked, and the smoke and screenshot tests passed on Linux and the Mac.

Checkpoint r3 (`checkpoint/playback-2.3b-r3`, round 2's fixes): all green again on the Mac and Windows. Round 3's
fixes (ae5d298) came after it and change nothing a platform does differently; the quick checks passed on them.

For Kevin, on his own computers, in this order (Kevin, Nov 6):
1. **Windows with a GPU: a copy of a real FX3 clip made by the hardware Media Foundation encoder** (NV12, High
   profile). Link the clip to a frame; the copy starts on its own. Task Manager's Performance tab, under the GPU, should
   show its Video Encode graph rise while the copy is made. CI has no GPU, so that path has never run; if it fails, the
   software encoder makes the copy anyway, more slowly, and the graph stays flat.
2. **A Mac: a long take on an external drive; unplug the drive halfway through its copy.** The inspector should say the
   copy failed, with Try again, and the copies' folder (shown in Settings → Storage) should hold nothing of it.
3. A Sony or Canon MXF that keeps its channels as separate mono tracks: open its copy from the copies' folder in
   QuickTime or VLC (the Player comes in 2.4); both channels' sound should be there, on both sides, never clipped.
4. Settings → Storage in the installed app: the free space roughly as Finder or Explorer shows it (a little under on a
   Mac); Licences… shows the text of each of the five files; Move to another drive… and Move back; Clear…, after which
   the inspector says "No playback copy yet."
5. Forget remembered videos…: afterwards a video outside its project's folder shows as missing, with Relink.

Lows deferred (noted, not planned yet):
- A copy refused for room (the floor) shows as failed and waits for Try again: nothing asks for it again once room
  comes back (a Clear, a bigger cap, a lower floor).
- Reopening the same project (after a sync conflict, say) stops the copy being made and drops the queue, as any project
  switch does; it could carry on instead.
- After a mix that couldn't be checked (the file stopped answering) and a second failure, the sound test tries only
  the first track; an earlier copy without sound is likewise kept by a test of the first track only.
- The cap or the floor going back after a failed save has no test that can fail: the unit tests draw the page once
  (no DOM library; adding one waits for Kevin), and the stand-in's saves never fail.
- The e2e run in a cloud session is Chromium only (WebKit isn't installed here); the screenshot tests differ there by
  about 1% of pixels, all text antialiasing, as the container's Chromium build isn't the baselines'. The checkpoint
  compares them on CI's own browsers.

## Next steps, in order

0. **2.3c** (PR #79, merged Nov 7; checkpoint r5 all green): silent tracks left out of the mix; a relink's undo never leaves the other file's
   copy. Review round 1: two mediums fixed (five 4-second windows could miss a mic live for minutes of a long take,
   and a take of unknown length was read whole: now forty 1-second windows, never more than 40 s read, its own 90 s
   allowance), and lows (a track ffmpeg says nothing of is kept; the Trash no longer stops a copy; two tests made able
   to fail). Left as lows: a Cancel during the listening waits for it to end (up to 90 s on a share that stopped
   answering), as the sound checks do; a relink undone before its old copy finishes makes that copy again from the
   start. Review round 2: lows only, fixed (a restore from the Trash makes the inspector look again at once; the
   40 s cap on a take of unknown length tested); the hook-level test of that restore waits for a DOM test library
   (a new dependency, Kevin's call).
   Checkpoint r1: Windows green; the Mac's Rust tests failed four copies that stalled together, ffmpeg stuck in
   VideoToolbox's service, as at D2: the runner's virtual GPU hangs when several encode sessions run at once, and 2.3c
   added copies. The app makes one at a time; the Mac tests now do too (a test-only turn in `encode`). That alone
   didn't do it (r4: the same four failed, the first hang at a different copy than r1's): VideoToolbox on the runner's
   virtual GPU wedges once a run opens many sessions in a row, whichever copy it lands on. The sound tests, which test
   the sound, now encode their picture with FFmpeg's own MPEG-4 (as on Linux), sparing about ten sessions; every
   other test still uses VideoToolbox. The app is unchanged.
1. **2.4** (PR #80, merged Nov 7; seven review rounds, checkpoint stop-a-r7 all green; review stop A reached, its checklist below; see "2.4 as built" in `docs/PLAN.md` and Review stop A below): the Player tile plays real footage (frame stepping, timecode, in and out, scrubbing), through Tauri's asset
   protocol scoped to the copies' folder. Copies have their index at the end (no `+faststart`); if the Mac's webview
   stumbles on that over the asset protocol, add the index pass back with a time allowance for it and bump `RECIPE`.
   Handle a copy going missing under the Player (the cap, Clear, a Move). **Review stop A** after it: run a checkpoint,
   write the checklist into the handoff, and keep going (Kevin tests in batches).
2. **2.5** LUTs (PR #81, merged Nov 7; three review rounds, checkpoint 2.5-r2 all green; see "2.5 as built" in
   `docs/PLAN.md` and "2.5: decisions" below): a `.cube` per video, applied to playback copies (stills in 2.7), never
   the original; the LUT joins the copy's key. Then **2.6** crop over the Player (PR #82, merged Nov 7; three review rounds,
   checkpoints all green; see "2.6 as built"); **2.7** still capture into a frame (PR #83, merged Nov 7; two review rounds;
   see "2.7 as built"; from the original, LUT and crop
   applied, `from_video` recorded); **2.8** clip capture, in two: **2.8a** the frame's clip plays in the inspector (PR #84, merged
   Nov 7; two review rounds; see "2.8a as built"), then **2.8b** Save clip as file (PR #85, merged Nov 7; four review rounds; see "2.8b as built"; rendered
   from the original,
   graded and framed, frame-accurate, with sound, named like the frame exports: `SC004_4A.mp4`);
   **2.9** JSON export and import, lossless (PR #86, merged Nov 7; three review rounds; see "2.9 as built" and "2.9: decisions").
3. **Phase 2 gate** (reached Nov 7): every Phase 2 milestone is merged. The gate checkpoint, `checkpoint/phase2-gate`
   on `v2` at d42f6ed (2.9's merge), passed every job Nov 7 (smoke and screenshots on Linux and the Mac, both installers); the
   checklist is "Phase 2 gate: Kevin's checklist" below. The gate itself: a still from a reference clip lands in a
   frame in a few clicks, on Kevin's own footage (item 3). Don't wait; Phase 3 follows.
4. **Phase 3** (production data; plan and decision sheet written Nov 7: "Phase 3 milestones" in `docs/PLAN.md`,
   `docs/PHASE3_DECISIONS.md`; build from 3.1), after the gate checkpoint passes: first write a Phase 3 plan and a one-page decision
   sheet (each decision: the question in plain words, the options, the recommendation and why, how hard it is to
   change later), then build in milestone order. Scope: project details and company profiles; locations (address
   search, map, photos, contacts, parking and power notes); cast and crew; department workspaces from a shot's row;
   shoot days with totals and the Calendar tile (month and week); gear per day linked to shots; a client contact and
   deliverables checklist; notification history; Assets and attachments. **Stop at the Phase 3 gate** (Kevin's real
   shoot's people, places and gear are entered) with a checkpoint and a checklist.
5. **Phase 3 gate** (reached Nov 9): 3.1 to 3.11 are merged (#88 to #104); 3.4 waits for Kevin. The gate checkpoint,
   `checkpoint/phase3-gate` on `v2` at 5cf9875 (3.11's merge), passed every job Nov 9 (smoke on Linux and in WebKit on the Mac, both installers; run 42596717084). The checklist is "Phase 3 gate:
   Kevin's checklist" below, riskiest first. **Stop here:** Phase 4 (call sheets) starts in plan mode once Kevin says
   go (CLAUDE.md: build only the current phase).

### 2.5: decisions taken (Kevin can overrule any; none changes the file format)

- A LUT belongs to the video record, so every frame of a take shows the same grade. A frame of its own grade would
  need a second video record for the same file (Link video again); say if frames should carry their own.
- For HDR footage (HLG, PQ) a LUT replaces the tone-mapping rather than following it: a camera's LUT is made for the
  signal it recorded. A LUT made for tone-mapped Rec.709 would look wrong on HDR footage; say if that's the case.
- A LUT change asks for the graded copy straight away, as a relink does, so the Player shows the grade without a click.
- LUT rows stay in the project once stored, even when no video names one (an undo, a LUT taken off). They're small
  (a 33-point cube is about 1 MB); a "remove unused LUTs" belongs with Clean up old pictures if they ever add up.
- Only 3D `.cube` files. A 1D LUT, or a 1D shaper before the 3D one, is refused with words saying why.

### Next session: start here (Nov 20, after the overnight run; written at 05:30 EST)

Kevin's overnight note (Nov 20) is word for word in `private/NOV20_NIGHT.md` on his PC. The night's three checkpoints
are spent (nov20-a, -b, -c); `checkpoint/baselines-nov20` was not run, because nothing mergeable needed it.

**Nothing but docs merged.** Each checkpoint had one red job, each for a cause in the code, never the machine:

| Checkpoint | Held | Red job | Why |
|---|---|---|---|
| nov20-a (run 44685330762) | #207, #208 | End to end (macOS, WebKit) | #207's own test failed twice with the same numbers |
| nov20-b (run 44696981565) | #206, #213 | Installer (macOS) | the launch check: the Mac app could not read a PDF |
| nov20-c (run 44705837514) | #206, #213, #219, #208, #214, #215 | Installer (macOS) | the launch check: the accent reader's worker failed |

On nov20-c every other job was green: the Mac's whole WebKit suite with nothing flaky (611), Linux Chromium (610,
one flaky), both installers' Rust suites (405 on the Mac, 395 on Windows), and the launch check on Windows Server,
all eight steps.

**Open, in the order they stack; each has its own Linux checks green and at least one review:**

- **The launch check's stack:** #206 (the workers' policy) ← #213 (the launch check, 6.27l) ← #219 (the Mac's PDF
  reading, 6.27p) ← #223 (the accents step says where it failed, 6.27q).
  - **What the launch check found on its first runs on a Mac.**
    1. **The Mac app could not read a PDF** (nov20-b). pdf.js's `getTextContent` reads a stream with `for await`,
       which Safari's engine lacks, macOS 26's included; Chromium and Playwright's WebKit have it, so every
       end-to-end test passed. Older than #206: it came with pdf.js 5.7. Fixed in #219 (readPdf.ts reads through
       `streamTextContent` and a reader) and **confirmed in the Mac's real webview on nov20-c: `pdf-text ok`.**
    2. **The accent reader's worker answered "The object is in an invalid state."** (nov20-c). One of
       `createImageBitmap`, the canvas, `drawImage` or `getImageData` threw inside the worker. The same worker
       passes the themes spec in Playwright's WebKit on the same runner. It is GitHub's virtual Mac only, or every
       Mac (then choosing a project's key image fails in the Mac app: there is no fallback when the worker itself
       reports an error). No run can tell yet. #223 makes the next one say which call failed and what the page gets
       from the same picture.
       - **The check's own 16 × 16 picture is not the cause** (read at 05:25 EST, in #223's comments). It is a
         valid PNG by a strict read (every CRC, the zlib stream, every pixel), and in WebKit's source a picture that
         can't be decoded fails with words of its own ("Cannot decode the data in the argument to
         createImageBitmap"). The bare "invalid state" words are what `getImageData` gives when a canvas's pixels
         can't be read back (CanvasRenderingContext2DBase.cpp), so expect `(worker: read)`.
       - **The lean is the runner, and only a real Mac says.** Safari's engine is understood to draw a canvas in
         its GPU process (not checked in the source that night), and GitHub's Macs have only a virtual GPU
         (VideoToolbox wedged on it too, 2.3c). #223's line also says what the page gets from the same picture: if
         the page reads it where the worker can't, the page standing in for a worker that reports an error is the
         small fix (today only a worker that can't start or takes too long is replaced by the page, extract.ts).
  - **The quickest answer is Kevin's own Mac** (Only Kevin): on #223's branch, a debug build and
    `bash scripts/launchCheck.sh src-tauri/target/debug/storiiboard`.
  - The stack can't merge while the Mac's installer job is red at that step.
- **#208 (the wording, 6.27k) ← #214 (a stalled encoder says so, 6.27m).** What the app did before: on Windows it
  already went on from the hardware encoder to the software one after a stall, but every stall ended in the drive's
  words; the Mac has one encoder. #214 reads the file itself past where ffmpeg stopped and chooses the words; its
  Linux-only tests pass in its own checks (a stalled encoder with a readable file goes on and makes the copy). Both
  passed everything on nov20-c; they wait only because that run had a red job.
- **#215 (HEIC on Windows, part 1: Rust, 6.27n) ← #218 (part 2: the page).** Part 1 was in nov20-c as it stood then
  and passed on all three systems; it has had three more rounds since, each reviewed and checked on Linux (and by
  its Rust suite on Kevin's PC), none in a checkpoint: a colour the grid alone describes is read from the HEIF's own
  boxes and used or refused, never ignored (two rounds), and a grid whose colour number is "unspecified" no longer
  hides what its tiles' stream says (the last, `f88cb3c`). Part 2 has never been in a checkpoint: its
  WebKit-on-a-Mac test has never run.
- **#221 ("This picture is no longer in the project.", 6.27o):** three strings in en and es, two tests' expected
  words. No screenshot shows them. Never in a checkpoint.
- **#222, a draft (controls clear of an overlay scroll bar, 6.27o):** built and reviewed, and stopped: the 16 px lane
  makes the Layers tile's rows wrap at its default width, which fails planLayers.spec's "each layer is one line…
  every row shows without scrolling". Three choices are in the PR (Only Kevin).
- **#207** (player.spec's count) and **#211** (the agents' model): Only Kevin.

**The next checkpoint, when Kevin names one:** `v2` + #206 + #213 + #219 + #223 + #208 + #214 + #215 + #218 + #221.
PLAN.md's rows conflict between the stacks (keep every row, in order) and `src/main.tsx` is edited by both #213 and
#218 (keep the launch check's branch first, then `installHeicDecoder()` among the lines of a normal start). Expect
Installer (macOS) red at `accents` again unless Kevin's Mac shows it is the runner; this time the line will say where.

**Briefs:** docs/briefs on each branch (launch-check, pdf-text-safari, launch-check-accents, stalled-encoder,
heic-windows, heic-rust, heic-page, scroll-lane-and-picture-words). The night's probes and logs are under
`test-results/` on Kevin's PC (`nov20a-frames`, `nov20a-macres`, `review`, `heic-artifact`).

### Earlier: start here (Nov 20: Kevin's answers to the evening report; nothing of them started)

The whole list, Kevin's words and what each item needs are in `private/NOV20_START.md` on Kevin's PC (git-ignored).
Read it after this file. In short:

- **Checkpoints Kevin named, and only these:** `checkpoint/nov20-a`, `checkpoint/nov20-b`,
  `checkpoint/baselines-nov20`.
- **1.** #207 and #208 together on `checkpoint/nov20-a`; every job green: merge both.
- **2.** #206 doesn't merge yet: it changes how the main window is made and nothing automated starts the built app.
  A launch check is stacked on it (the brief first, and Kevin is told what the check can and can't prove), then
  `checkpoint/nov20-b` on the stack and both merge together. ALPHA_TEST.md's debug-build line for the workers'
  policy then loses its [Kevin] mark.
- **3.** The stalled encoder: yes to the proposal and its two changed expectations. First tell Kevin what the app
  does today when the file reads fine and the encoder stalled; it should try the next encoder by itself.
- **4.** HEIC on Windows: the numbers, the tag rule and the 10 s limit are approved; build it (plan and results in
  private/briefs/heic-windows.md). At most two photos decode at a time, and the status line counts them.
- **5.** The scratch copy of Kevin's photo: see Only Kevin.
- **6.** The two ready screenshot changes (controls clear of an overlay scroll bar; "This picture is no longer in
  the project.") don't wait for the bigger ones: `checkpoint/baselines-nov20`, every changed picture listed in the
  PR with a before and after of each kind, merged when only those two changes explain the pictures.
- **Kevin's photos (Nov 20):** anything a probe writes from them stays inside private/samples, and no file name of
  his is printed, in a log or in chat.
- **Still listed:** OSV-Scanner 2.7.1 on or after Nov 23, its own PR; the bigger screenshot milestones.

### Earlier: start here (Nov 19, evening: Kevin's answers worked through)

- **Merged:** #205 (docs, after a read; Kevin, Nov 19: docs-only PRs need no checkpoint).
- **Open, each with one review and PR checks green, waiting for a checkpoint Kevin names:**
  - #206 (6.27i): a policy on every worker (src-tauri/worker-csp.txt). Before the fix, Chromium's and WebKit's workers
    ran with no policy at all (a probe: eval, Function and fetch all allowed).
  - #207 (6.27j): player.spec counts missed frames from the jump in media time, capped by the time the picture took.
  - #208 (6.27k): the wording fixes, every string in en and es in its description. The stalled encoder waits
    (Only Kevin).
- **measure/heic:** run 44666161464 green; its numbers are in private/briefs/heic-windows.md. The branch stays for
  the build, which commits the small pictures as fixtures with the script and the sips command.
- **Next:** the HEIC build once Kevin approves the numbers; then 2 (planLayers: controls clear of an overlay scroll
  bar) with the stacked screenshot milestones; OSV-Scanner 2.7.1 on or after Nov 23, its own PR.

### Next session: start here (Nov 19, morning: the night run)

- **Merged into v2 (after checkpoint/nov19-a, run 44494150067, green in every job):**
  - #199: rusqlite 0.41.1.
  - #200: test photos drawn by script.
  - #201: LUTs under the hash rule at import, plus the JFIF and Adobe sizes.
  - #202: player frame reports.
  - Two machine-only reds were rerun and came back green: the Smoke job stalled 30 min in apt, and #202's PR check
    stalled in `npm ci`.
- **#203 (Advisories, 6.27g):** one review, two rounds, PR checks green. Its first real run found exactly what the
  brief expected: pdfjs ignored (from OSV and npm audit), minimatch dev only, glib Linux only, five unmaintained
  crates. Checkpoint/nov19-b (run 44515010617) was red only on WebKit planLayers.spec (see Only Kevin), in code
  #203 doesn't touch.
- **#204 (kamadak-exif 0.6.2, 6.27h):** stacked on #203, brief in docs/briefs.
- **Checkpoint/nov19-c (run 44536909144), v2 + #203 + #204:** green in every job, nothing failed or flaky (WebKit
  607, Chromium 607, smoke 26; planLayers passed). #203 then #204 merged into v2 (4660de8). That was the third and
  last checkpoint of the night.
- **Kevin's answers (Nov 19, afternoon), the work order:** 1, docs-only PRs merge after the main session's own read,
  with no checkpoint (#205). 4, the PDF worker's policy: list every worker the app starts and what it needs, then a
  policy at least as strict as the page's on each (the PDF worker: no network, no eval); a Rust test, the e2e server
  sends the same header (a PDF import runs under it in WebKit and Chromium), a line in ALPHA_TEST.md; say what each
  webview did before the fix. 3, player.spec counts missed frames from the jump in media time, same meaning and
  limit; the kept frame reports of the old flaky runs pass with it, a real overshoot still fails; confirm the app
  doesn't use `presentedFrames`. 8, one small-fixes PR for the wording ("The LUT was damaged and left out."; a
  message names a still, a clip or a playback copy; a stalled encoder "stopped responding, try again", no drive;
  grabStill's words get a test), every changed string in en and es in its description. Then HEIC's step 0 probes and
  timing on a one-off workflow from branch `measure/heic` (its small pictures committed as fixtures with the script
  and the sips command), numbers to Kevin before the build; a profile neither P3 nor sRGB is carried (at most 64 KiB,
  else refused with words); HDR HEIF refused on Windows with a line, and an ALPHA_TEST.md [Kevin] line for one on the
  Mac. 2, planLayers: fix the app, keep controls clear of a scroll bar wherever it overlays content (decided by
  whether it overlays, not by the system), in every scrolling tile, with the stacked screenshot milestones, a before
  and after picture in the PR. 6, OSV-Scanner 2.7.1 on or after Nov 23, its own PR, the hash from the project's
  checksum file. 7, the Advisories job's four choices stay. Order: 1, 4, 3, 8, HEIC probes, then 2.
- **HEIC on Windows:** plan and brief in private/briefs/heic-windows.md, waiting on Kevin.
- **Next after Kevin:** the stacked screenshot milestones, with "This picture is no longer in the project.". Also
  the small wording points: an unreadable cube's still or clip says "playback copy"; "1 of 1 LUTs was damaged";
  grabStill's new words have no direct test; a stalled encoder's wording.

### Next session: start here (Nov 18: the nov17-627 checkpoint read; by-hand passes no longer hold any phase)

- **By-hand passes (Kevin, Nov 18):** none holds a phase any more. Kevin tests once, thoroughly, when the alpha is
  fully built: through Phase 7 and the web page export, plus the plans in private/. Phase 8 (release work)
  follows his alpha test and its fixes; the 3D set follows the first release. One list, docs/ALPHA_TEST.md, by
  feature in a production's order, added to with every milestone; things only Kevin can judge are marked.
  Reviews, full runs and checkpoints are unchanged; every red or flaky result is reported to him.
- **Now (Nov 18, late):** checkpoint/627-clean (run 44452187334) green in every job; one flaky test, WebKit
  player.spec "a page too busy to see every frame…" (the one with a cause hunt to come). #196 merged into v2
  (5e994d0). The HEIC report is sent; its findings are in private/PHASE8_LIST_ADDITIONS.md. Next: rusqlite 0.41.1
  on `deps/rusqlite-0.41.1`, then kamadak-exif 0.6.2, one full checkpoint for both, then the Advisories job.
- **Night run (Kevin, Nov 19, before bed; resumed):** order: the rusqlite PR, the photo replacement, the LUT check on
  import, the player.spec flake, kamadak-exif 0.6.2 (allowed from 13:41 UTC Nov 19), the Advisories job after
  rusqlite merges, then the HEIC brief (plan only). Checkpoints on my own when a PR or stack is ready, named
  checkpoint/nov19-a, -b, -c (three at most); a PR merges only after a checkpoint including it is green in every job
  (a machine-only red is rerun). To Only Kevin, then on to the next independent thing: anything changing a
  screenshot, the file format or a schema; a dependency he hasn't approved; anything on main or that deletes; a red
  or flaky job not explained by the machine. Only touched specs on the PC. One report in the morning: merged, open,
  waiting on him.
- **Paused earlier (Kevin, Nov 19), his follow-ups:**
  - Order: rusqlite 0.41.1 and kamadak-exif 0.6.2 with one checkpoint; the Advisories job; the photo replacement;
    the LUT check on import; the player.spec flake; the stacked screenshot milestones; then HEIC on Windows for the
    alpha (plan in private/PHASE8_LIST_ADDITIONS.md; brief and plan to Kevin before building).
  - Small fixes: the doors keep JFIF only without a thumbnail (length 16) and Adobe only at its fixed size (14),
    each once, in Rust, in TypeScript and in the shared tests (LOW; with the next change to those files). "This
    picture is no longer in the project." (en, es) where a picture's bytes are gone; a screenshot showing it goes
    the baseline way with the stacked ones. Still listed: a stalled encoder shouldn't tell people to check their
    drive.
- **Still waiting on other things:** rooms from scans on Kevin's real files; HEIC dates on the library.
- **Checkpoint nov17-627 (run 44194206185), three red jobs, reported Nov 18:**
  - Mac WebKit: scoutPhotos.spec "…what is stored has no EXIF" failed on every try. WebKit's JPEG encoder on the
    Mac writes its own blocks: an Exif block holding only the picture's width and height (PixelXDimension 640,
    PixelYDimension 345 or 346), an empty Photoshop/IPTC block and a Display P3 colour profile. No date or place.
    Fix: strip in our code as the picture is stored (Kevin: in Rust); see the open question in the report.
  - Mac installer: 16 playback tests failed (each stalled ~100 s, "That video stopped being read partway"),
    `ffmpeg: IOServiceMatchingfailed for: AppleM2ScalerParavirtDriver`. Runner image 20261102.0473.1 on another
    host; the green run of Nov 17 (44051079024) had 20261112.0504.1, 313 passed. No playback code changed between.
  - Linux Chromium, whole suite at 8 workers: 4 failed (planUnderlay.spec ×3, themes.spec axe) and 3 flaky
    (bodiesLenses, planCameras, player), all timeouts. The runner has 4 cores. No refused page load (6.29).
- **Kevin's answers (Nov 18, night), the work list in order:**
  - A. 6.27b (docs/briefs/6.27b-clean-pictures.md): one clean in TypeScript in canvasBlob, keep-list, Rust refusing
    at the door, the JSON import through its own command for older pictures; with it, the real-JPEG guard check
    (`SB_SAMPLE_JPEGS`, run by the main session; prints yes/no only). Then review; its Linux check green; checkpoint
    `checkpoint/627-clean` (Kevin named it); every job green: merge #196; then kamadak-exif 0.6.2 as its own PR,
    on or after Nov 19.
  - B. A job red only because of GitHub's machine is rerun and said so; twice for one cause goes to Kevin. The Linux
    whole suite at `--workers=100%` (on #196's branch). 6.29's hunt stopped (reopen only if a refusal shows at 4
    workers); its brief stays uncommitted. After A: a small brief for player.spec "a page too busy to see every
    frame…" (flaky on the Mac in five runs): its cause, no retry or wait. Small-fixes list (not in #196):
    - a stalled encoder shouldn't tell people to check their drive;
    - (Kevin, Nov 18) the words where a picture's bytes are gone must be true both when it was deleted for good and
      when an import left it out: for one, "This picture is no longer in the project." (en and es), on the board and
      wherever else those words show; if a screenshot shows them, the baseline way, stacked with Settings, the Undo
      and Redo buttons and the tile accent.
  - C. Docs PR #197 (ALPHA_TEST.md, PLAN.md, PHASE7_DECISIONS.md) merges after its checks. The repo's Website field
    was cleared Nov 18. ALPHA_TEST.md gets the stored-photo line when A is built.
  - D. The kamadak-exif advisory id is unconfirmed: cite only the library's 0.6.2 notes. Migration notices, and
    reading GitHub's alerts once v2 is the default branch: on Phase 8's list (private/).
  - E. Kevin's sample photos stay in private/ and are read only where they are: nothing from them (files, names,
    paths, anything read) goes into the repo. Checks print yes or no, never a date, a time or a place.
  - F. An Advisories job (ci.yml on every PR, and the checkpoint): npm audit plus OSV-Scanner v2.7.0 (Apache-2.0)
    on package-lock.json and Cargo.lock, malware included; red only for what ships; an ignore needs Kevin's word,
    reason and date. First run Nov 18, v2 and #196 the same: pdfjs-dist and libsqlite3-sys ship; minimatch and
    typescript-eslint are dev only; glib is Linux only; five crates unmaintained (listed, not red).
  - G. Every report ends with "Only Kevin"; the same list tops this file.
  - **Nov 18, late, the order:** A (with Kevin's four additions, sent to the builder mid-run and appended to the
    brief), the guard check on Kevin's JPEGs and on ExifTool's public sample set (outside the repo), checkpoint
    `checkpoint/627-clean`, merge #196; then rusqlite 0.41.1 (Rust 1.89, rust-version moves; every forced code change
    named) and kamadak-exif 0.6.2 as two small PRs sharing one full checkpoint (Mac and Windows) before either
    merges; then the Advisories job, wired in after rusqlite merges so it starts green: OSV-Scanner 2.7.0 fetched from
    its release with its SHA-256 checked; pdfjs-dist ignored until Feb 1, 2027 or Phase 8's oldest-Mac decision,
    with its reason in the config, a test that keeps the reason true (only readPdf.ts imports pdfjs-dist, nothing
    from pdfjs-dist/web, no AnnotationLayer or enableScripting, the policy never allows inline script or eval),
    readPdf.ts's comment corrected, and the PDF worker's policy in the installed app reported. 2.7.1 on or after
    Nov 23. A new advisory reaching what ships goes to Only Kevin the same day.
  - **Nov 18, night 3:** A gets round 3 (brief's last section): ring 0.17.14 as a direct dependency for SHA-256, and
    an import with a damaged stored file imports the rest (left out, named by place, counted, in History). The
    profile cap is 64 KiB as stored, no unpacking anywhere (round 2, Kevin's night 2). After #196 merges: one small
    PR replaces e2e/fixtures/images/photo-a.jpg, photo-b.jpg and v2's prototype/uploads/ four (film stills of real
    actors) with pictures a script in the repo draws (same sizes and profiles; uploads keep their names; main's four
    stay); deckPictures.ts's thresholds measured again; every changed expectation in deckExport, swatches,
    boardMedia (and scoutPhotos) listed. No screenshot test uses them. Rooms from scans: plan in private/. The whole
    suite never runs on Kevin's PC.
  - Docs PR #198 (no user name in public files; ALPHA_TEST's [Other PC] section): merged.
  - **Nov 18, night 4:** no History line for left-out files (Kevin took it back): the import's notice carries it, with
    Copy list (every place). A's last round adds one shared statement list (JSON) both readers are tested against,
    a static scan and a run-time check in the memory driver that fail on a new statement. After #196: LUTs under the
    same hash rule as their own small PR (a damaged LUT left out and named; its videos play ungraded and never reuse
    a playback copy made with it), then the photo PR. SQLite TEMP triggers instead of the readers: Phase 8's list.
  - Vitest fails every file when the shell's folder is spelled `c:\` (lower case); run it with `C:\` (the builder's
    test-results/build627b/vitestUpper.cjs). Not a config change.
    ALPHA_TEST.md and the build stay in step from now on.
  - H. Kevin's Nov 17 afternoon note is in private/. Then the History lines milestone (after 6.6) and the rest of
    the order in private/.

### Next session: start here (Nov 17, evening: scout photos at round 4, uncommitted; new chat because the old one grew too long)

**Status.** `v2` is 7d17eb4: #192 to #195 merged Nov 17, checkpoint `checkpoint/nov17-v2` (run 44051079024) green
(Linux smoke 26; Mac WebKit 597 passed, 1 flaky: player.spec "a page too busy to see every frame shows a frame or
two past the out point…", not diagnosed; Rust Mac 313, Windows 303; both installers). The checkout is on
`polish/6.27-scout-photos` with all of 6.27 (rounds 1 to 4) **uncommitted**. Nothing else is in flight.

**Kevin's Nov 17 message (A to E) is the work order; it replaces the Nov 16 evening list where they differ.**
- A. kamadak-exif stays `=0.6.1` in 6.27 with our own check (`block_is_safe` in src-tauri/src/exif.rs: permanent,
  one-line comment, no more detail than a published advisory, the repo being public). The pin to 0.6.2 is its own
  small PR **on or after Nov 19** (cargo test and the refused-photo fixtures, each refused, the app still up); its
  request states the release notes and advisories (memory: dependency-request-advisories). Kevin named
  GHSA-53gf-vqf6-qvp8; kamadak-exif 0.6.2's own release notes name it, so it's confirmed and cited with them (#204).
- B. HEIC waits for a library release (private/PHASE8_LIST_ADDITIONS.md has the entry). No reader of our own.
- C. Scouting before a schedule: built in round 3 (the photo's date, time and place; the mark and panel say which
  place). **Still to write: the new reading rule next to the old one in CLAUDE.md** (main session, at commit).
- D. "Refused page load" in two specs: find the cause before the next full run, no retry
  (docs/briefs/6.29-refused-page-loads.md, untracked, not started). It showed only under 8 workers, and local runs
  are now 4, so the investigation runs with `--workers=8` on purpose, when Kevin isn't using the PC. The four
  first-load timeouts on the busy PC are a different symptom: no timeout raised for them.
- E. Build mode 6.6.1 to 6.6.5 starts on `v2` (briefs already in v2), not stacked on scout photos. Each of the
  five styled rooms goes to Kevin as a picture, with its tagged set pieces, before it is built.

**6.27, where it stands** (brief: docs/briefs/6.27-scout-photos.md, rounds 1 to 4; its round 2 EXIF detail was
trimmed for the public repo).
- Round 3 review: no HIGH, one MEDIUM (public words about the guard), seven LOWs; all sent to round 4.
- Round 4 (builder, Nov 17 17:31): tsc, eslint, lint:rust clean; cargo 321 passed, 1 ignored; Vitest 3,439 passed,
  1 skipped; scoutPhotos, locations and planSun specs 15 passed. One test failed once and was fixed in the round:
  scoutPhotos.spec "scouting before a schedule: a setup with no shoot day shows the light reference, and the
  switch draws the sun wholly from the photo (round 3)" (item 2 made its untyped zone unanswerable in the memory
  build; the test now types the zone; no expectation changed).
- Round 4 item 5 **not built** (one line per photo in the status line): the status line holds one string, so the
  notes stay joined by a space. Decide: leave, or brief a small change to the status line.
- "At the location's own pin" (item 2) means exactly equal coordinates.
- Round 4 review (Nov 17, new chat; diff4.patch against origin/v2, since the local `v2` is stale at d597a4c): no
  HIGH or MEDIUM, six LOWs, all sent to round 5 except the import-note test's id-based calls (accepted: same
  strings; the "couldn't be prepared" note can no longer come from `importNote`, it has its own notice). The
  brief's own round 2 and 4 wording about the guard was trimmed by the main session.
- Round 5 (builder, model check passed: claude-opus-5-5): tsc, eslint, lint:rust clean; cargo 321 passed, 1
  ignored; Vitest 3,440 passed, 1 skipped; scoutPhotos and planSun specs 8 passed; nothing failed or flaky.
  The main session fixed SBD_FORMAT's HEIC sentence (it answers `heic`). Not reviewed again (LOW fixes only).
- **Committed and pushed (Nov 17, Kevin: "do it"):** eefb838, PR #196 on v2 (CLAUDE.md's reading rule and PLAN.md
  row in it). checkpoint.yml gains a whole-suite Chromium job on Linux at 8 workers (CI can now stand in for the
  local Chromium run, and is a first place for 6.29 to show). Checkpoint `checkpoint/nov17-627`, run
  44194206185. Next: read its failed and flaky tests by name (all three jobs); 6.29 on the PC only if CI
  doesn't show it; Kevin names the merge.
- **Older next list:** (3) 6.29's cause (8 workers, when Kevin isn't using the PC); (4) the full local run
  (`--project=chromium`), every failed or flaky test named; (5) CLAUDE.md's reading rule, PLAN.md, SBD_FORMAT
  check; (6) commit with explicit paths, PR on `v2`. Kevin names the merge.
- Also uncommitted, to go in with it: playwright.config.ts (4 workers) and its CLAUDE.md line; .vscode/
  settings.json; src-tauri/tauri.conf.json's shortDescription and design/DESIGN.md:265 ("Free to use.").
- The round 2 reviewer wanted `block_is_safe` compared with `read_raw` on real JPEGs: needs Kevin's photos.

**The PC (Kevin, Nov 18): only the specs a change touches run here.** It was the whole PC slowing down, not only the
VS Code window, and it stopped once the whole suite moved to GitHub. Here: only the specs a change touches; the whole
end-to-end suite and anything else heavy run on GitHub (a checkpoint). **The PC (Nov 17).** Kevin's PC froze or crawled during runs. Changed: local e2e runs use 4 workers (Kevin: his
other projects must still run); he excluded the repo folder from Defender; Python analysis is off in this
workspace; `cargo test -j 12` in builders' checks. Measured: 64 GB, never under 48 GB free; processor peaked at
35% during Vitest and the specs; so memory is not the cause, and the graphics card can't take this work. A
read-only watch, test-results/freeze-watch.ps1, logs every 5 s to freeze-watch.log (start it before a heavy
run). Best guess for what Kevin sees as a freeze: the VS Code window hanging on a very long chat (the session was
also cut off four times mid-builder). So: **keep chats short; start a new one per milestone.** A full Rust
compile has not been measured yet. Unanswered: whether the whole PC freezes or only VS Code.

**Waiting on Kevin:** where he saw the advisory id; whether to diagnose the player.spec flake now; whether the
photo's place should be used even when a shoot day exists (round 3 applies it always); migration 012's notice; a
Mac by-hand pass of HEIC; iPhone photos; item 5 above. (Nov 18: by-hand passes no longer hold any phase; see the
Nov 18 "start here".)

**Rules that are easy to miss:** the four Nov 14 rules open every brief and review request; one builder at a
time, started without a model (the first builder run of a chat is the model check: claude-opus-5-5); no edits,
lint or Vitest while local e2e runs; stage explicit paths; new plans in private/; a checkpoint only when Kevin
names it; no public release until the app reads the switch file from the public home.

### Next session: start here (Nov 16, evening, older: the 6.5 stack merged; Kevin's evening answers)

**Kevin's Nov 16 evening message is the work list** (in this chat's transcript). Its order: A (the 6.5 stack) in
order, then D's scout photos, then E (build mode, "6.6"). B, C and F are answers on plans: recorded in `private/`
(DEPARTMENTS_DECISIONS.md, PHASE7_ANSWERS_NOV16.md, PHASE8_PRIVATE_DAY.md, PHASE8_LIST_ADDITIONS.md), nothing of
them built until his by-hand pass. **Phase 7 still waits. New plans stay in `private/` and are pasted in the
report.** He also said: **use Fable for every agent this week** (start the builder and the reviewer with
`model: "fable"`), and **tell him about every red check, also a suspected flake**.

- **A1, A2 done:** #185 to #191 merged into `v2` (d597a4c) after #185's Linux check was rerun green (it had been
  red from the planHost test below, which the Nov 16 report failed to say).
- **A3:** the full checkpoint is run 43982486430 (branch `checkpoint/nov16-v2` = v2 at d597a4c). Read its result
  and give Kevin the installers' run number. Perf, measured on the PC (logs in test-results/perf1116/): every
  step at one frame at #181's merge and at v2's head; **the held turn key drifted**: p95 50.0 ms on 4 runs of 5
  at the head (fails its < 50 budget) against 1 of 5 at #181. No one milestone: the per-edit cost crept up, most
  at #188, #190 and #191. Brief docs/briefs/6.26-held-key-cost.md (find and remove the added cost; a count-based
  guard test; the budget never moves) is written, NOT yet built.
- **A4 (6.24, branch `fix/6.24-trash-steps`):** every op group's time is strictly later than every earlier one in
  the file (`stepTime` in src/core/ops/ops.ts; the newest time read as the project opens), so equal trash times
  mean one step everywhere (walls, rooms, cameras' marks, connectors, boards, scenes, approvals). Three rounds,
  reviewed once (nothing high or medium). ops.test.ts's two tests changed by setup only, as the brief names.
  Kevin was told the choice (a later time per step, not the step recorded on the record) and may still prefer
  the other.
- **A5 (6.25):** brief docs/briefs/6.25-small-fixes.md written, not built: empty-board paste keys; 5 decimals for
  coordinates; what a person sees if migration 012 throws and that the file is left as it was. PLAN.md's five
  "open-source" passages become "free" (the main session edits them in that PR).
- **D:** docs/briefs/6.27-scout-photos.md written, not built: EXIF read in Rust with `kamadak-exif` at EXACTLY
  0.6.1 (0.6.2 not before Nov 19); schema 16, shared with the 6.6 milestones; "Use this photo's place and time".
- **E (6.6, build mode):** docs/briefs/6.6.1-room-tool.md written (the room tool; push and pull a wall), not
  built. Still to write: the eyedropper (E) and the delete tool; the time-of-day slider with floor light patches
  if they fit; the Library by room (tags proposed to Kevin in the report: living room: sofa, table, chair,
  plant; kitchen: counter-bar, table, chair; bedroom: bed, chair, table, plant; office: table, chair, sofa,
  plant; bar: counter-bar, chair, table, column; car, stairs, column also under "Anywhere"); templates saved on
  this computer as company profiles are, placing one copies it into the project; the five styled rooms are
  SHOWN to Kevin as pictures before they are built (a probe that draws each through the plan's own PNG export).
  The kit has only nine set pieces, so the styled rooms will be sparse until Kevin draws more (tell him).
- **Rules that changed today:** Storiiboard is free and closed source; the repo stays public until the app is
  built; plans for unbuilt features live in `private/` (ignored); a checkpoint only when Kevin names one; no
  public release until the app reads the switch file from the public home.
- **Checkpoint 43982486430 finished RED on the Mac** (Kevin was told at once): both installers built and passed
  their checks (Rust: Windows 303, Mac 313), Linux smoke 26 passed; the Mac's whole suite in WebKit: 591 passed,
  4 failed, 1 flaky. Failed: planUnderlay.spec "an underlay set to scale by two clicks and "4m"…" and "Set scale
  takes its clicks exactly where they are…" (half a centimetre off: suspect, the plan's first view beside the
  tool strip puts the origin on a half pixel, PLAN_STRIP_INSET 69); macWebKit.spec "Tab from the Hex field to
  outside the colour panel closes it…" (6.5.7a's test waits for a picker a Mac doesn't have); boardGrid.spec
  "snap to grid: a picture's and a deck page's corner…" (a click on a page's edge doesn't select it in WebKit).
  Flaky: planLayers.spec "hides, locks, dims and solos layers…". The Mac's log is saved at
  test-results/perf1116/mac-nov16.log. Brief docs/briefs/6.28-mac-failures.md is written; its fixes can only be
  confirmed by a Mac run (`checkpoint/e2e-<name>`, no installers), which needs Kevin's word.
- **Merging:** Kevin named #185 to #191 only. #192 (6.24) is green and NOT merged (an attempt was held back as
  not named); everything after it stacks on it and waits for his word: 6.25 (small fixes; two rounds, reviewed),
  then 6.28, 6.26, 6.27 and the 6.6 milestones.
- Migration 012 for Kevin: a schema-11 file it refuses is left byte-identical; an older file ends at schema 11
  (earlier migrations commit one by one), nothing lost, the original in the first backup; each failed try in a
  new minute leaves another backup beside the project, and a retry in the same minute fails at "A backup named …
  already exists". No product change made; his call.
- **6.28 (the Mac's failures; branch `fix/6.28-mac-failures`, stacked on #193; reviewed, nothing high):** the
  plan's and the board's insets are even (`evenInset`, src/ui/canvas/viewport.ts: 70 and 52), a section's or
  page's edge picks up to 2 px outside its box (src/ui/canvas/sections.ts), macWebKit's Hex Tab test changed as
  the brief names. The planLayers flake has no known cause (lead: the Layers tile may overflow with the Mac's
  fonts; the Mac's trace of that test would settle it, if the checkpoint uploaded traces). **Needs one Mac run to
  confirm (`checkpoint/e2e-<name>`): ask Kevin to name it.** Left as it always was: with an odd canvas width the
  plan's origin sits on a half pixel.
- **6.26 (the held turn key's cost; branch `fix/6.26-held-key-cost`, stacked on #194; two rounds, reviewed: no
  staleness):** built after the pause (Kevin said continue, Nov 17). The held key passes its budget 12 runs of
  12 on the PC (p95 33.3 to 33.4 ms); perf.spec untouched. Guards: editCost.test.ts, sunRecords.test.ts.
  `data-plan-data` and `data-handles` are dev-build-only test hooks now.
- **Refused page loads keep happening in full local e2e runs, each time on a different test, each passing
  alone:** connectors.spec (Nov 15), moodboard.spec "Shift keeps the proportions…" (Nov 16), deckExport.spec
  "prints an original only when it is the picture the deck shows…" (Nov 16), moodboard.spec "opens the Camera
  board from the picker…" (Nov 17). Kevin's rule: a second time, find the cause, no retry. As a class this is
  well past a second time: a brief to find the cause (the dev server refusing a connection under 8 workers) is
  owed; tell Kevin.
- **Status line (keep current):** Nov 17: #180 to #191 merged; #192 (6.24), #193 (6.25), #194 (6.28) and 6.26
  open, stacked, waiting for Kevin's word to merge; checkpoint 43982486430 red on the Mac (the fixes in #194 need
  one Mac run he names); next builder: 6.27 (scout photos), then 6.6.1 to 6.6.5 (briefs in docs/briefs/), then
  the refused-page-load cause.

### Next session: start here (Nov 16, earlier: "6.5 canvas polish"; older)

**Kevin's Nov 16 message is the work list** (it is in this chat's transcript; its substance is below). Order:
merge #180 (done), the app-wide sort-key pass (6.23), then build his items 1 to 9 as "6.5 canvas polish" in small
milestones under the usual rules, every milestone that changes screenshots the baseline way (regenerated on its
PR's branch, a PR comment, Kevin compares and says merge). Items 10, 11 and 16 are plans only. **Phase 7 still
waits.** When 1 to 9 are merged: a full checkpoint on `v2` for new installers, and a report. New props go in ONE
schema version, listed in SBD_FORMAT.md and the report.

- **Briefs are in docs/briefs/** (each starts with Kevin's four Nov 14 rules, word for word, since this chat's
  agents predate #167; a new chat has them in builder.md and reviewer.md, but keep them in briefs anyway):
  - 6.23-sort-keys-app-wide.md: built, reviewed twice (see below).
  - 6.5.1-dark-canvas.md (item 1), 6.5.2-tool-strip.md (items 2 and 3), 6.5.3-trackpad-mode.md (item 4),
    6.5.4-saved-sign.md (item 6): written, not yet built.
  - 6.5.8-presets.md (item 7): a draft holding Kevin's decisions (look and layout only: theme, canvas settings,
    his workspaces and the department workspaces, the plan's layer states, scene palettes in the PDF; never
    language, units, paper, directions, backups, trackpad mode, the profile; applying shows what changes first
    and saves "Before [name]").
  - Still to write: item 5 (the sun and the compass: quick sun with its own coordinates and date, coordinates
    pasted onto a location, the compass at the plan's top right, sun through the windows, heights for 3D later;
    probably two briefs), item 8 (moodboard: dot grid and snap, any colour for notes and stickies, crop with
    Ctrl/Cmd + drag and Reset crop, a border on a picture; probably two briefs), item 7's full brief.
  - Item 9 is only lines on Phase 8's list (his own icon set, a display font for titles, a shortcuts pass).
- **Plans (10, 11, 16), drafted, not committed:** docs/DEPARTMENTS_DECISIONS.md (item 11, untracked in the
  checkout); the PLAN.md additions for 10 and 16 were drafted in the chat's scratch folder (if lost, rewrite from
  Kevin's message); still to add: questions 18 to 22 in docs/PHASE7_DECISIONS.md (background cast as records;
  extras found by rule or by the assistant; photo coordinates as contact details; a read tool for a room's
  photos and measurements; a propose tool for a room), and the proposed edits to CLAUDE.md, which wait for Kevin.
  They go in one docs PR at the end.
- **6.23 (branch `fix/6.23-sort-keys`):** every caller that hands `keyBetween` a stored key goes through guarded
  helpers in src/core/ops/order.ts (`keyAfterKeys`, `keyBetweenOrNull`, `placeAmong`, `freshKeys`…); a list
  whose keys leave no room is rewritten whole in one op group. Left for Kevin: migration 012 can still throw on
  an odd key in a pre-12 file (migrations are frozen); pasting items with connectors into an EMPTY board gives a
  connector and an item the same key (older than 6.23; fixing changes a sound file's keys); no door (open, JSON
  import) checks sort keys. A builder used `sed` once on its own new test file (rule 2).
- **Merging in this run:** a milestone with no screenshot change merges once reviewed and its quick checks pass
  (the run rules below); one that changes screenshots waits for Kevin's word, and later milestones stack on it.
- **Kevin, Nov 16, later: Storiiboard is free and closed source; the repo stays public until the app is built.**
  Plans and decision sheets for features not yet built live in `private/` (git-ignored; their text goes in the
  report), never in docs/; documents already public stay. A checkpoint runs only when he asks for one by name
  (the one after 6.5 stands). A small docs PR changes "open-source" to "free" in CLAUDE.md and the README.
- **Baselines in this run (the main session's decision, to keep runs few):** Windows baselines regenerated on each
  PR that changes them; Linux and Mac ones once, at the top of the stack, before the final checkpoint.
- **Done so far:** #181 (6.23) merged. 6.5.1 (Dark view; branch `polish/6.5.1-dark-canvas`; four rounds, reviewed
  twice; no screenshot baseline differs on Windows) committed and open. This PC was busy on Nov 16: perf.spec's
  held turn key read p95 66.7 ms with and without 6.5.1, so its numbers that day prove nothing; measure again on a
  quiet PC before the checkpoint.
- #182 (6.5.1) and #183 (the wording: free, not open source; `private/` ignored) merged. 6.5.2 (the tool strip;
  three rounds, reviewed once, one medium fixed) committed and open; it changed two plan.spec tests the brief
  names (the tools are now inside the canvas). A board's first view is still centred on its origin (existing
  board tests rely on it): tell Kevin.
- #184 (6.5.2) merged. 6.5.3 (trackpad mode; three rounds, reviewed once) is open and **waits for Kevin's
  comparison**: it changes the four Settings screenshots (Windows baselines regenerated on its branch; Linux and
  Mac ones come at the top of the stack). Later milestones stack on its branch. For Kevin: with the mode off (the
  Windows default) a two-finger touchpad scroll zooms; ⌘ + wheel acts as Ctrl + wheel when off; a notch's zoom
  follows the system's delta (1.25 per 100 px), to be felt on his own mouse.
- Plans kept in `private/` (ignored): DEPARTMENTS_DECISIONS.md, PLAN_ITEMS_10_16.md, PHASE7_QUESTIONS_18_22.md,
  PHASE8_PRIVATE_DAY.md, PHASE8_LIST_ADDITIONS.md. Their text goes in the final report.
- 6.5.4 (the Saved sign; two rounds, reviewed once) is open, stacked on 6.5.3, and **waits for Kevin's
  comparison** too: 8 Windows baselines (board and Settings, which show the status bar); visual.spec now fixes its
  clock (the brief's one allowed change). A builder left a stray src/app/shell/SavedSign.tsx; the main session
  moved it to test-results/build654/ (not deleted). The backup time read at open comes from the backup's name
  (local time), so after travel it can be off until the next backup.
- 6.5.5 (quick sun, pasted coordinates, compass; three rounds, reviewed once, one medium fixed) is open, stacked
  on #186. **Schema 15** is registered there (the one version for all of 6.5: the sun path's `own_latitude`,
  `own_longitude`, `own_date`; the `settings_preset` record type; later 6.5 milestones add their props to its
  list in docs/SBD_FORMAT.md, with no new version). 014_plans.test.ts changed as the brief names. Left: the
  Locations tile shows a place's coordinates to 5 decimals and the paste's status to 4 (existing tests pin the 5).
  One refused page load in a full run: deckExport.spec "prints an original only when it is the picture the deck
  shows…" (passed alone).
- 6.5.6 (sun through the windows, heights; two rounds, reviewed once, one medium fixed) is open, stacked on #187.
  Its props are on schema 15's list. Floor light patches were left out: they need a time of day (item 16's
  slider, plan only). A window's own `height_m` is not checked against the ceiling unless sill and top are set.
- 6.5.7a (the board's dot grid and snap; any colour for a sticky; three rounds, reviewed once, one medium fixed)
  is open, stacked on #188. It changed three tests the brief names (the sticky's "six colours only"). For Kevin:
  "notes and stickies" was read as the sticky note (a board has no other note); a default text box on a dark
  sticky still prints in ink; Ctrl/⌘ suspends snap only while moving (a handle + Ctrl/⌘ is 6.5.7b's crop).
- 6.5.7b (crop and a border on a board's picture; two rounds, reviewed twice: a HIGH fixed, the handles framed
  the uncropped picture) is open, stacked on #189. For Kevin: a single selected picture shows 8 handles and a
  plain drag of a middle one keeps proportions; a PDF embeds only the kept part (the brief said "clipped"; the
  main session chose this for privacy); a builder appended to items.ts from the shell once (rule 2).
- 6.5.8 (settings presets; four rounds, reviewed twice: a HIGH fixed, arranged workspace layouts were lost on
  apply) is open at the top of the stack; it changes the four Settings screenshots (Windows regenerated) and one
  macWebKit Tab test the brief names. The whole suite at the top of the stack on the PC: 596 passed, 0 failed.
  For Kevin: History says "Saved settings preset Before Night" for an apply (no label on an op group without a
  new stored field); a record crafted too deep to serialise can't be renamed or deleted through ops.
- **Items 1 to 9 are all built.** The stack, bottom to top, each PR based on the one before: #185 (6.5.3), #186
  (6.5.4), #187 (6.5.5), #188 (6.5.6), #189 (6.5.7a), #190 (6.5.7b), then 6.5.8. #185, #186 and 6.5.8 change
  screenshots and wait for Kevin's comparison; none of the stack merges until he says so (merge bottom up:
  retarget each to v2 after the one below merges, as scratch merge-stack.sh did on Nov 15).
- **Linux and Mac baselines for the stack** are in #191's last commit (run 43952568254: 32 pictures, board and
  Settings; shell unchanged), so the Linux and Mac pictures hold all three screenshot changes at once: merge the
  stack bottom to top in one go.
- **The report of Nov 16 was sent** with the private/ plans pasted in. Waiting for Kevin: his comparison of the
  screenshots in #185, #186 and #191 and his word to merge the stack; his answers on the plans.
- **When he says merge:** for each of #185 to #191 in order: quick checks green on its head, retarget to `v2`,
  merge with a merge commit; then the full checkpoint on `v2` he asked for (push `v2` to `checkpoint/<name>`),
  measure e2e/perf.spec.ts on a quiet PC first (Nov 16's numbers were taken on a busy one and prove nothing), and
  the final report with the installers' run number.
- **Status line (keep current):** Nov 16: #180 to #184 merged; the 6.5 stack #185 to #191 open, every milestone
  of items 1 to 9 built and reviewed; stopped, waiting for Kevin's comparison and merge word. No agent running.

### Next session: start here (Nov 15, night, older: #179 merged; 6.22 built)

Kevin's Nov 15 night message answered what waited for him and ended "Then stop": **build nothing more. Phase 7
stays unbuilt until he is back from his by-hand pass (run 43789275891's installers) with what he found and his
answers to docs/PHASE7_DECISIONS.md.**

- **Merged:** #179 into `v2` (his word, Nov 15 night). `v2`'s Rust tests now compile on a Mac and start on Windows.
- **Open, waiting for his word to merge: #180, 6.22** (branch `phase6/6.22-nov15-night`, base `v2`;
  docs/briefs/6.22-nov15-night.md, three rounds, reviewed twice). His installers don't have it.
  - Set pieces print dimmed on every department's page but art's; walls, doors and windows in full (his answer).
  - `setupPlanOf` reads the index; gearOnDay.test's scan test now asserts 2 whole reads for one call and 0 more per
    further setup, exactly (his answer).
  - A door dropped on a wall never throws on a sort key an imported file made unreadable, and neither does any
    other plan write that asks for a key after the last (`keyAfterLast` in src/core/model/plan.ts: wall runs, marks,
    copied setups, the underlay, paste, the Library). The existing test that asserted the throw (planSights.test
    "never works out a sort key mid-gesture…") now asserts the drop doesn't throw, and that the live cut reads no
    records whole (the main session named it in the brief's round 2: tell Kevin).
  - Two marks of one character sharing an `order` (an odd file) reorder as the view shows them: that view's
    sequence is renumbered after the owner's last, so the owner's marks the view doesn't show come first in other
    setups' views.
  - `tsBuildInfoFile` is node_modules/.cache/tsc/…, and `*.tsbuildinfo` is ignored. Nothing in the repo's scripts
    writes it: an ad-hoc `tsc -b` did.
  - Local checks: Vitest 2,960 passed, 1 skipped; end to end (Chromium) 546 passed, 0 failed after round 2; round 3
    ran Vitest and the two plan specs only. Round 1's full run had one refused page load: moodboard.spec "Shift
    keeps the proportions in a resize and snaps a turn to 15 degrees" (passed in the next full run).
  - A builder ran an inline python script once in round 2 (rule 2 of Nov 14 covers it; told not to again).
- **Left for Kevin to decide:**
  - The same unguarded sort-key pattern outside 6.22's brief still throws on an odd file: Bring to front / Send to
    back on a plan and on boards (src/ui/canvas/zOrder.ts `sortKeysFor`), a new or reordered setup
    (src/core/model/setup.ts), src/features/moodboards/items.ts. An app-wide pass would be its own small brief.
  - His answer "leave it" closed: a light inside a wall aimed along it.
  - Still open: a held turn key at p95 33 ms; dimmed context at 45% ink on paper; a legend's continuation page
    has no watermark; Spanish (his glossary pass); the icon classes.
- **By hand, for Kevin:** as the section below lists.
- **Leftovers:** Kevin said he deletes `playwright-full.log`, `tsconfig.tsbuildinfo` and `e2e/zz-probe.spec.ts`
  himself.
- **A chat started now** has the four Nov 14 rules in builder.md and reviewer.md; this one (started before #167)
  put them at the top of every brief and review request.
- **Status line (keep current):** Nov 15, night: #179 merged; #180 (6.22) open and unmerged; no agent running;
  stopped, waiting for Kevin's by-hand pass.

### Next session: start here (Nov 15, evening, older: Phase 6 and the audit's cover merged)

Kevin's Nov 15 message (from his phone) finished the Nov 14 list on the PC. **Nothing is left to build before his
by-hand pass. Phase 7 stays unbuilt until he has done it and answered docs/PHASE7_DECISIONS.md.**

- **Merged into `v2`, in order (Nov 15):** #167 to #178 (6.12 to 6.21; docs/PLAN.md has a row for each).
- **The checkpoint for his by-hand pass:** run 43789275891 (branch `checkpoint/nov15-v2d`), every job green: both
  installers (`storiiboard-Windows`, `storiiboard-macOS`), the Rust tests on Windows (303) and the Mac (313), the
  Mac's whole suite in WebKit (546 passed, none failed or flaky). It is `v2` plus #179, which is **open and waits
  for Kevin's word**: the first checkpoint on merged `v2` (43772904480) failed both installer jobs in 6.16's new
  Rust tests (the Mac: the context macro expanded twice; Windows: the test program had no Common Controls 6
  manifest; then one test expected a fresh backup to take space, which an APFS clone doesn't) and in the new
  Windows bundle listing (a PowerShell quote). #179 fixes those and uploads the installers before the listing.
  Until #179 merges, `v2`'s Rust tests don't compile on a Mac or start on Windows. Flaky on the Mac across the
  four runs, each passing on retry: player.spec "a page too busy to see every frame shows a frame or two past the
  out point…", gear.spec "gear on a day and on a frame: the check says what the day lacks…".
- **Built on the PC on Nov 15 (after the cloud session):**
  - 6.18's fixes, three review passes (#177 and commits in #178): the cut follows a drag, a turn and a resize live,
    made by the drop's own function; a fifth of the corners; printed glow bands clipped properly. Measured on the PC
    (e2e/perf.spec.ts, three runs each): pan, zoom and drag p95 16.7 to 16.8 ms before 6.18, with it, and after the
    fixes; dragging the plan's 40 walls 83 ms before the last pass, 16.7 after. So the cut is ON; nothing was
    switched off.
  - 6.20 (Kevin's Nov 15 answers): the watermark inside the plan box; a department print shows the room with its
    set pieces (the main session's reading of "the room": tell Kevin), cameras with cones and cast marks dimmed.
  - 6.21: readers per records object (src/core/model/recordIndex.ts). Found by a perf run with 5,000 extra stroke
    records (SB_PERF_EXTRA=5000): a held turn key was p95 83 ms, now 33 ms as without them.
- **Kevin's four Nov 14 rules** are in builder.md and reviewer.md since #167. A chat started before #167 merged
  doesn't have them in its agents: put them at the top of every brief and review request (docs/briefs/
  6.20-nov15-answers.md shows the wording). A chat started on `v2` now has them.
- **The Mac's whole suite in WebKit:** run 43738354811 (6.17-review-fixes' head): 540 passed, 0 failed, 0 flaky.
  The checkpoint above runs it again on everything merged.
- **Known and left for Kevin to decide:**
  - `setupPlanOf` still scans the records once per setup on each edit, because src/core/checks/gearOnDay.test.ts
    "reads the plans' items in one scan of the records…" asserts an exact count (`toBe(3)`); indexing it makes that
    0. His word is needed to change the assertion (rule of Nov 14), or `setupReading` can take the indexed path.
  - A held turn key is p95 33 ms, not 16.7: each key repeat is a whole edit (the store copies the records, React
    re-renders the plan tile in a dev build). No small fix was found.
  - A light deep inside a wall whose beam points exactly along it lights both sides of the wall.
  - Dimmed context on a department print is 45% ink (the Layers tile's dim): faint for 7 pt labels on paper.
  - A legend's continuation page carries no watermark (it has no plan box).
  - The drop of a door onto a setup-only wall throws on an unreadable sort key from an imported file (old
    behaviour; the live cut no longer does).
  - Still open from before: Spanish (his glossary pass), the icon classes (his judgment in use).
- **By hand, for Kevin:** the list under the older "start here" below still holds (Mac: Tab in Settings,
  right-click Duplicate, Shift+F10, Copy link; Windows: deck page by its handle, the Menu key; Show backups; a wild
  wall with Stop at walls off; a department print), plus: drag a wall across a camera's cone and a light's beam
  and watch the cut follow; export a lighting print with the watermark on; the Phase 6 gate's checklist.
- **Leftovers only Kevin deletes:** `playwright-full.log` and `tsconfig.tsbuildinfo` in the repo root (both from
  before Nov 14), `e2e/zz-probe.spec.ts`.
- **Status line (keep current):** Nov 15, evening: #167 to #178 merged; #179 open with the green checkpoint; no agent
  running; waiting for Kevin.

### Next session: start here (Nov 15, earlier: cloud session handed to the PC; Kevin's Nov 14 instructions under way)

Kevin's Nov 14 message is the brief for this run (six items: merge #152 to #166; the audit's go-aheads and the
Mac's whole suite in WebKit; his Phase 6 answers; walls stop cones and beams; four rules; then a full checkpoint
and Phase 7 in plan mode). A cloud session did most of it on Nov 15 and stopped here so the work can go on from
Kevin's PC. **Start the PC chat on the top branch of the stack below, not on `v2`**: builder.md and reviewer.md
changed on #167, and agent files are read when a chat starts. First builder run: the model check, as always.

- **Merged Nov 15:** #152 to #166 into `v2`, in order (each retargeted to `v2`; `v2` had not moved, so each
  merged tree was its head's tree, already green). `v2`'s tree is exactly #166's (7d2cd18).
- **Built since, stacked, each branch on the one before, all pushed; only #167 has a PR (draft). None merged:**

  | Branch | What | Review |
  |---|---|---|
  | `chore/nov14-rules-ci` (#167) | Kevin's four rules (builder.md, reviewer.md, CLAUDE.md); checkpoint.yml: the Mac job runs the whole suite in WebKit, with the Mac's Keyboard navigation on; the installers list their bundles (audit cover 3); a `checkpoint/e2e-<name>` branch runs tests without installers and may carry `e2e/ONLY.txt` (never merged) to run a few specs; Phase 7's plan and docs/PHASE7_DECISIONS.md; briefs | mine |
  | `audit/6.13-csp` | The end-to-end tests run under tauri.conf.json's CSP (plus `'wasm-unsafe-eval'` only); a violation fails the test | done, fixes in 6.19 |
  | `audit/6.14-contract` | src/app/tauriContract.test.ts (page calls against lib.rs); B3: the test drivers refuse what Rust refuses | done, fixes in 6.15 |
  | `mac/6.19-webkit` | The Mac's first run: context menus, the menu key, click focus, the Library's cancelled drag, Tab past a colour input; 6.13's review fixes | done, fixes in 6.16 |
  | `audit/6.15-pointer-reorder` | B1: deck pages reorder by pointer events (src/ui/useRowDrag.ts); lint and a text scan fail on HTML5 drag and drop; B5; B6; 6.14's review fixes | done, fixes in 6.19b |
  | `audit/6.16-tauri-test` | Rust tests through tauri's `test` feature (dev-dependency only, Cargo.lock unchanged): 49 of 70 commands; commands generic over the runtime; 6.19's review fixes | done, fixes in 6.17 |
  | `mac/6.19b-second-run` | The Mac's second run: panels that closed on a press, whole-pixel aiming in the canvas specs (e2e/wholePixels.ts), the cross-scene drag's scroll; 6.15's review fixes | done, fixes in 6.18 |
  | `phase6/6.17-answers` | The FX3 entry checked; symbol icons as a true-size outline; per-department prints; the watermark on plan PDFs and PNGs; 6.19c: a selected wall moves by its body; 6.16's review fixes | done, fixes in the next branch |
  | `phase6/6.18-walls-stop-cones` | Walls stop cones and beams (src/core/model/planSightlines.ts; `stop_at_walls` stored only as false, no schema change); 6.19b's review fixes | **reviewed: not ready**, docs/briefs/6.18-review-fixes.md |
  | `phase6/6.17-review-fixes` | 6.17's review fixes (only footprints get the outline; thin items move by their body; file names) and two test fixes for the Mac (below); the handoff | built, not yet reviewed |

- **The Mac's whole suite in WebKit (the job is "End to end (macOS, WebKit)"):** run 1 (v2 as merged): 452 passed,
  62 failed, 76 min. Run 2 (6.19): 495 passed, 25 failed, 1 flaky, 58 min. Run 3 (6.19b; run 43717235319): 530
  passed, 1 failed (plan.spec "starts a room…"), 1 flaky (perspectiveViews "a gaffer sees Grip & electric
  first…", 60 s waiting for a person's row, passed on retry), 55 min. A six-spec trial on 6.17's head (run
  43725936783): "starts a room…" passes; two tests this run added fail there: plan.spec "a selected wall moves by
  its body…" (the test's half-pixel presses miss a 2.5 px wall when WebKit drops the fraction) and planExport.spec
  "a plan's PDF and PNG carry the project's watermark…" (its PNG half counts dark pixels, which the stamp lowers).
  Both fixes were sent to the builder on `phase6/6.17-review-fixes`. The job takes about 55 minutes on one worker.
  Artifacts can't be downloaded from a cloud session; a small agent reading the job's log through the GitHub
  tools gives the failed names and errors.
- **What the Mac runs found in the app (fixed, each with a test in e2e/macWebKit.spec.ts that shows it in
  Chromium by pressing buttons as Mac WebKit does, e2e/webkitClicks.ts):** a board's right-click menu closed
  before its command ran; Shift+F10 and the menu key opened nothing on a frame; a clicked button took no focus;
  Tab fell out of a window whose last stop is a colour input; a selected wall could hardly be moved without
  resizing it. In the tests: Tab needs the Mac's Keyboard navigation (set in the job); Playwright's Safari draws
  at pixel ratio 2 and delivers whole-pixel pointer positions.
- **Next, in order:**
  1. Read the 6.18 review's findings if this section's status line has them; otherwise review
     `phase6/6.18-walls-stop-cones` again (diff against `phase6/6.17-answers`; the brief is
     docs/briefs/6.18-walls-stop-cones.md). Known departures to judge: the cut is redone when a drag lands, not
     during it; an apex deep inside a wall draws no cone; walls cut with the art layer hidden. Perf on the cloud
     container (slow, noisy): pan at fit p95 16.8 ms before, 33 to 50 after; open after reload 1.1 s to 1.35 to
     1.87 s: measure on the PC (e2e/perf.spec.ts, SB_PERF=1) before merging.
  2. Finish `phase6/6.17-review-fixes` if the status line says it is unfinished (the brief and the two Mac test
     fixes: plan.spec's presses on whole pixels with the zoomed-out wall at least 5 px thick; planExport.spec's
     PNG half comparing the two pictures' corner and a far region).
  3. **Windows baselines:** the cloud can't make them. 6.15 added a `≡` drag handle to a deck's page rows and 6.17
     and 6.18 changed plan drawing; e2e/visual.spec.ts shows only the shell, the storyboard board and Settings,
     so no baseline should change, but run `npx playwright test e2e/visual.spec.ts --project=chromium` on the PC
     to be sure.
  4. Open PRs for the stack (one per branch, each based on the one before, as before), merge in order into `v2`
     as Kevin asked for this set, then a full checkpoint (`git push origin v2:checkpoint/nov15-v2`): first run of
     the installers' new bundle listing (a wrong path there fails the installer job: fix checkpoint.yml and
     rerun) and of 6.16's generic commands on the Mac (a Windows type-check passed in the cloud; the Mac was
     never compiled).
  5. CLAUDE.md still to gain, once merged: walls stop cones and beams and the Stop at walls switch; the symbol
     icon rule; per-department prints and the watermark on plans; the tests' CSP; the contract test; no HTML5
     drag and drop (lint and src/app/noHtmlDrag.test.ts). PLAN.md's status table and a row per milestone 6.12
     to 6.19c. docs/DESKTOP_GAPS.md already has Kevin's answers.
  6. Kevin's report (his list): what merged, the checkpoint and its installers, what the Mac's WebKit run found,
     the failed tests by name, what to test by hand, every decision waiting for him.
- **Waiting for Kevin:** docs/PHASE7_DECISIONS.md (17 questions; nothing of Phase 7 is built until he answers
  and has done his by-hand pass on Phases 3 to 6). The watermark on a plan crosses the plan box's frame line and
  the legend's last rows (it is the storyboard's rule, as asked): keep, or its own placement? A lighting print
  leaves the camera out entirely: show it faintly? The colour picker in Settings → Theme can't be reached by Tab
  on a Mac (the Hex field sets the same): add a button? Deck pages drag by a `≡` handle, not the whole row. The
  icon classes (the builder's close calls are in 6.17's report; ladder and apple box become top-view in the
  review fixes). Spanish for every new string waits for his glossary pass.
- **By hand, for Kevin:** Mac app: does Tab reach buttons from a Settings text field (PLAN.md says it skips them
  with Keyboard navigation off; wry's code says the app turns it on); right-click a board item and choose
  Duplicate; Shift+F10 on a frame; B2 (Copy link). Windows installer: drag a deck page by its handle (B1); the
  Menu key on a frame shows only the app's menu. Either: Show backups reveals the Backups folder (never run on a
  Mac or Windows); the installed app's real CSP header against tauri.conf.json's (Tauri may add to it); a
  wild wall with Stop at walls off; a department print.
- **Cloud-only notes:** local end-to-end runs there fail 14 tests for reasons of the container (all 12
  screenshot tests; callSheets "Export PDF writes the day's sheet…" and "Issue keeps the PDF as sent…"); none of
  that applies on the PC. Review diffs and builders' logs were under test-results/ (not kept).
- **Status line (keep current):** the cloud session stopped Nov 15 with everything pushed and no agent running.
  `phase6/6.17-review-fixes` is the top of the stack: 6.17's review fixes and the two Mac test fixes are built
  and green in Chromium (2874 unit tests; the suite 526 passed with only the cloud's 14 container failures); not
  yet reviewed. **6.18 was reviewed and is NOT ready to merge:** docs/briefs/6.18-review-fixes.md (high: pan and
  marquee lost 60 fps, from the corners a cut shape is drawn with; medium: the cut must follow a drag live,
  decision 5, and the shapes are written into the page on every edit; lows). Give that brief to a builder first,
  then measure e2e/perf.spec.ts on the PC before and after. A whole-suite Mac run of this branch's head was
  started as `checkpoint/e2e-mac-6`: read its result (Actions, "Checkpoint", the newest run on that branch)
  before anything else; the two tests fixed for the Mac (plan.spec "a selected wall moves by its body…",
  planExport.spec "a plan's PDF and PNG carry the project's watermark…") have not yet been seen passing there.

### Next session: start here (Nov 13, second chat: Phase 6 under way)

- **Models checked:** the first builder and reviewer runs of this chat both recorded `claude-opus-5-5` in their
  transcripts (`~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl`, the `"model"` field). In a new chat,
  check the first builder run the same way; anything else, stop and tell Kevin.
- **Merged Nov 13 (second chat):** #146 to #150 into `v2`, in order. Because `v2` had moved under the stack (#151),
  each PR was retargeted to `v2`, then brought up to date with GitHub's "Update branch" (`gh pr update-branch`),
  which starts the pull-request CI on exactly the tree the merge gives; `git merge-tree` confirmed it, and the merge
  waited for green (#146 run 43542617514, #147 43543138468, #148 43543582454, #149 43544092691; #150 docs only, no
  CI). `v2`'s tree is #150's. The checkpoint for Kevin's by-hand pass: `checkpoint/nov13-v2` at bc1c880, run
  43544879092 (result in the status line at the end of this section).
- **Kevin's Nov 13 answers:** Bodoni Moda: one optical size accepted, no generated files. The Inspector shows the
  frame's shoot day (5.11). A desktop gap audit, report only (docs/DESKTOP_GAPS.md), with one small certain fix
  (5.12). Phase 6: go, 6.0 to the gate, with his answers in docs/PHASE6_DECISIONS.md, CLAUDE.md ("Bird's-eye view")
  and PLAN.md ("Phase 6 milestones": 6.0 to 6.11; 6.6 is the new north-and-sun milestone).
- **The stack, each based on the one before; nothing here is merged until Kevin says** (he named #146 to #150 only):
  see PLAN.md's Phase 6 table and the status line below for PR numbers and states. Order: `polish/inspector-shoot-day`
  (5.11), `fix/5.12-company-logo` (5.12 and the audit), `phase6/6.0-setups` (the answers' docs, then 6.0), then one
  branch per milestone. A PR that changes baselines (6.0 changes all 60: Setup goes live in the sidebar) gets them
  regenerated on its branch (Windows here; Linux and the Mac from a `checkpoint/baselines-<name>` run's artifacts)
  with a PR comment.
- **How a milestone runs:** brief in docs/briefs (complete: the builder knows nothing else), one builder at a time,
  commit by explicit paths, a diff file in test-results/ for the reviewer, fixes back to a builder until nothing
  high or medium is left, push, PR, PLAN.md and this section updated.
- **Schema (decision 16, approved):** props only, one version, in 6.1, listing every prop Phase 6 needs in
  SBD_FORMAT.md. A new table or record type waits for Kevin.
- **For 6.10 (export), what the print path lacks for plans** (PageStage, deckRender.tsx, deckDisplay.ts,
  deckPdfWriter.ts): icon text is a custom Konva Shape the PDF writer doesn't know; `parsePathData` reads only M, L,
  C, Z (the icons use A and Q: have the generator emit cubics); `parseColour` takes hex only (rgba paint is
  dropped); stroke weights are screen px (choose a printed weight in points); `beyond` drawings (cones, beams, the
  sun, paths, labels) aren't drawn by PageStage; pages fill the paper width, never to scale; no legend or scale bar
  code. src/core/model/planLegend.ts is the legend's data.
- **Waiting for Kevin:** the audit's go-aheads (docs/DESKTOP_GAPS.md, "Waiting for Kevin"); merges of the stack.
- Run npm and npx from PowerShell, or from Bash with the folder spelled `C:/Users/...`.
- **Status line (keep current):** checkpoint 43544879092 passed every job (installers for Kevin's by-hand pass).
  Open, stacked, each reviewed with nothing high or medium left: #152 (5.11), #153 (5.12 and the audit), #154 (6.0;
  60 baselines, Kevin compares), #155 (6.1, schema 14; it also holds 6.0's second-round fixes; 40 baselines). #156 (6.2a;
  20 baselines), #157 (6.2b), #158 (6.3; it also holds 6.2b's second-round fixes), #159 (6.4; it also holds 6.3's vector icons), #160 (6.5), #161 (6.6; it also holds 6.5's second-round fixes), #162 (6.7; it also holds 6.6's second-round fixes), #163 (6.8; it also holds 6.7's second-round fixes), #164 (6.9; it also holds 6.8's second-round fixes), #165 (6.10; it also holds 6.9's second-round lows), #166 (6.11; it also holds 6.10's second-round fixes).
  **Phase 6 is built: every milestone has had its review rounds and nothing high or medium is open.** The gate checkpoint: `checkpoint/phase6-gate` at d8a2730, run 43665582987, every job green Nov 14 (smoke and screenshots on Linux and in WebKit on the Mac, both installers): Kevin's checklist runs from its installers. Next: Kevin's
  gate (the checklist below, "Phase 6 gate"), his merges, then Phase 7 in plan mode. Local end-to-end runs use 8
  workers since Nov 14 (playwright.config.ts says why).
  Local full runs use 12 workers on this 24-thread computer; tests that start in the first wave pay a slow first
  page load: four long tests have a measured 60 s limit (history, bodiesLenses, planCameras, planUnderlay), each
  with its numbers in a comment. boardMedia.spec "zooming out from 400% over 40 pictures…" failed twice with
  "expected 40, received 0" (a drop never handled, not slowness), not reproduced in 34 loaded runs: its trace is
  kept on the next failure: read it before anything else. Then the gate: a full
  checkpoint on the top branch and Kevin's checklist. The print path's gaps for plans are
  listed below under "For 6.10" and in the 6.10 brief. Screenshots the main session looks at come from a probe
  spec under test-results/probe (not committed): ask the builder for them after any milestone that draws. The test server's output is in every run's
  log now ("[WebServer]" lines): a refused page load is diagnosed from them, never just rerun. Leftovers for Kevin to delete: e2e/zz-probe.spec.ts
  (an old emptied probe, excluded from git locally; it is one of the 3 skipped tests), test-results/PlanTile.bak. For Kevin's eye: icons are stretched to their real footprint (a sofa's drawing is distorted); the
  kit's Parking "P" is SVG text, so it draws in a system font; Spanish icon names are the builder's. Flaky once each, cause not
  proven (the test server on port 1421 refused a page load under a full parallel run): plan.spec "two scenes at
  one location share a room…" and liveCards.spec "a board linked to a scene, a character and a location…"; if a
  third appears, diagnose the server before going on (docs/briefs/
  canvas-core-map.md maps the canvas core). Two stray files in the repo root for Kevin to delete, never staged:
  playwright-full.log, tsconfig.tsbuildinfo. The sensor table's Sony FX3 entry is Kevin's own figures, unchecked (Sony's site refuses
  automated reads). Spanish for setup: "Emplazamiento", tile title "Emplaz.": Kevin decides the word.

### Next session: start here (Nov 13: Phase 5 merged; Kevin's Nov 11 answers built; Phase 6 planned)

- **Models (Kevin, Nov 13; CLAUDE.md, Who does what):** the main session runs on Fable 5.2 and does what it did:
  plans, briefs, diagnosis, judging review findings, git, CI, docs and Kevin's reports. It costs the most per token,
  so it writes no long code itself and keeps its own reading small; briefs still carry everything a builder needs.
  The builder is claude-opus-5-5 at effort medium, the reviewer claude-opus-5-5 at effort high, read-only.
  **The first builder run in the new chat is the model check: its transcript must record claude-opus-5-5.** If it
  records anything else, stop and tell Kevin. (Agent files load when a chat starts: every builder run on Nov 13 was
  still claude-sonnet-5-5.)
- **Merged Nov 13:** #135 to #145 into `v2`, in order, base first. Each PR was retargeted to `v2`, `git merge-tree`
  showed its merged tree equal to its head's tree, CI was run by hand on that head (`gh workflow run ci.yml --ref
  <branch>`: a changed base starts no run by itself) and the merge waited for green. `v2`'s tree is exactly #145's.
  The full checkpoint on `v2`, `checkpoint/phase5-v2` at 91e307e (run 43525039687), passed every job Nov 13: smoke
  and screenshots on Linux and in WebKit on the Mac, both installers after their Rust tests. Kevin's gate checklist
  below runs from its installers.
- **Open, stacked, waiting for Kevin** (each based on the one before; merge in order as above):
  - #146 5.8, the small answers: the tests' server opens no socket (hot reload was already off since 5.2, but Vite's
    client still connected: `noDevSocket` in vite.config.ts swaps the client's socket out for the test server only;
    nothing is filtered); "Actualizada"; builder.md's foreground line; the opener rule.
  - #147 5.9, Show in Finder / Show in Explorer (two review rounds).
  - #148 5.10, every weight of the bundled fonts from the publishers' static files (one review round; 17.6 MB more).
  - #149 the sidebar's built sections live, only Setup muted: **all 60 baselines changed; Kevin compares and says
    merge.**
  - #150 Phase 6's plan (PLAN.md, "Phase 6 milestones") and docs/PHASE6_DECISIONS.md: 16 questions. **Nothing of
    Phase 6 is built until Kevin answers.**
- **Questions for Kevin:** Bodoni Moda's publisher ships one optical size (11), so large Bodoni titles print about
  2% wider and with less contrast than the canvas draws them: accept, or generate optical sizes with fonttools?
  The Inspector still lists "Shoot day · Phase 3" as to come, though shoot days are built: show the frame's day
  there, or drop the line? An offline Windows installer is Phase 8's, as a second download (answered Nov 11).
- **By hand, added to the Phase 5 checklist below:** Show in Finder on the Mac and Show in Explorer on Windows for a
  dropped picture (and whether a picture whose original is in Desktop or Documents raises the Mac's folder prompt
  when selected); a deck PDF with Outfit Bold, Archivo Light Italic and Jost at several weights.
- Run npm and npx from PowerShell, or from Bash with the folder spelled `C:/Users/...`: under `/c/Users/...` Vitest
  fails every file with "failed to find the current suite".
- Leftovers (build output or temp; deleting is Kevin's): test-results/probe510, test-results/*.diff, and in the
  system temp folder the font downloads `sb510-*` (fonttools 4.68.0 was installed for this user with pip).

### Next session: start here (Nov 11: Phase 5 built, at the gate)

- Phase 5 is built and reviewed, every milestone under Kevin's Nov 10 answers, as a stack of PRs each based on the one
  before: #135 (the answers and Windows 10, docs; base `v2`) ← #136 (5.0 canvas core and boards) ← #137 (5.1a text,
  stickies, shapes, fonts) ← #138 (5.1b pictures, video cards, links) ← #139 (5.2 connectors) ← #140 (5.3 sections,
  align, tidy, snap) ← #141 (5.4 live cards, brand kit, a board's links) ← #142 (5.5 decks, Present, templates) ← #143
  (5.6a deck PDF and PNGs) ← #144 (5.6b palettes from a board, swatches .png/.ase) ← #145 (5.7 performance).
- **Merging:** `gh pr merge` on PRs Kevin hadn't named was refused by the classifier, so none of #135–#145 is merged.
  Merge in order, base first, as Phase 4's were (each branch holds the ones below it; `git merge-tree` shows each
  merged tree equals its head tree). **#136 changes all 60 screenshot baselines** (Moodboard no longer "coming";
  "Week starts on" now says "By this computer's region"): Kevin compares and says merge; nothing above it changes a
  baseline.
- Checkpoints: 5.1a (all green after moving font-kit out of Cargo's Windows-only section), 5.2, 5.6a, and the gate
  checkpoint `checkpoint/phase5-gate` on #145's branch (see the report).
- Builders stalled twice (5.4, 5.6a) waiting on a test run the shell had moved to the background after 180 s; the main
  session stopped them and ran the checks itself. Briefs since say to keep long commands in the foreground; a line
  for builder.md waits for Kevin.
- Leftovers in test-results/ (build output; deleting was refused): the builders' scratch scripts and logs,
  clipBytes.ts.leftover, probe*/.

### Phase 6 gate: Kevin's checklist (riskiest first; from the installers of the checkpoint named in "start here")

The gate (Kevin, Nov 13): plan a real Bey County setup and show the PDF to a gaffer.

1. **The real setup, end to end.** In Bey County: a scene's room (trace a floor plan or a photo as the underlay,
   Set scale with a distance you know), walls with typed lengths (try 12' 6"), doors and windows, set pieces;
   two setups; cameras linked to their frames; lights with their gear items and watts, flags and diffusion at
   crew sizes; cast marks with positions; north and the sun path for the shoot day.
2. **The PDF on paper.** Plan tile → Export… → Setup plan (PDF), then the scene's packet and, from Shoot days, the
   day's. Print at 100% and lay a scale rule on a wall you typed: at 1:50 a 4.00 m wall is 80 mm (in feet, 1/4" =
   1'-0"). Read it as the gaffer would: beams, watts and heights, the legend's total, each frame's lens and field of
   view. Then show it to the gaffer.
3. **A lens you know.** FX3 body in Gear (the entry is your own figures: check 35.6 × 20.0 against Sony's page),
   a lens you own on a frame: does the cone match what the camera sees in that room? An anamorphic on its side, if
   you ever shoot it: the squeeze turns with the camera (my reading; say if it's wrong).
4. **The sun.** For a location and day you know, compare the sun's direction and height at a time with a sun app
   or the real sky; with no zone on the location and none found, it must say "No time zone", never guess.
5. **The Mac (WebKit runs only there).** Draw, drag from the Library, turn with the handles and with comma and
   period, copy from the right-click menu then paste, paste a screenshot as an underlay, drop a picture from
   Finder, pinch to zoom, and export a PDF. Text inside icons (Parking's P, marks' letters) in the bundled face.
6. **Windows.** Drag from the Library and reorder setups by drag (pointer events, not HTML5); drop a picture from
   Explorer onto the plan and onto the storyboard with both open; the deck's Pages panel drag (DESKTOP_GAPS B1).
7. **Speed on your computers.** A big plan on the Mac and on a mid Windows laptop: pan, zoom, drag. Here: p95
   16.7 ms with 300 items in Chromium.
8. **An older project.** Open a real project from before Phase 6: a backup is taken, the file reads schema 14,
   nothing shows "Changed since approval" or "Changed since issued", day numbers are as they were.
9. **Layers.** Set This is me to a gaffer and open a plan with no saved layers: lighting and grip shown, the rest
   dimmed. Solo, hide and lock; nothing of it reaches History or the file.
10. **The Setup layout.** Your saved Setup layout, if it was a default, becomes the new one (Setups and Layers
    left, Selection and Library right); a layout you changed is kept, with new tiles in the Layout menu.
11. **Left from before:** attach a company with a logo (5.12); the Inspector's Shoot day row (5.11); the Phase 5
    items above (Bodoni title, Show in Finder/Explorer, deck weights).
12. **Words.** Spanish: "Emplazamiento" for a setup (tile title "Emplaz."), the icons' names, "Espacio" for a
    room. English: "Setup", "This setup only", "Start from another setup".

### Phase 5 gate: Kevin's checklist (riskiest first)

1. On both computers, from the `checkpoint/phase5-gate` installers: build a real pitch deck in under an hour (the
   gate): New deck → Pitch or Lookbook, then edit, Present, Export as PDF; open the PDF in Preview and Acrobat.
2. Fonts: Adobe Fonts you've activated appear under "On this computer" (relaunch after activating), on the Mac and
   on Windows; a brand font in the PDF (selectable text); a font whose licence forbids embedding falls back and the
   export says so.
3. Pictures: drop photos (iPhone P3 ones too) on a board; export the deck: pictures print from their originals and
   their colours match; move an original away and export again: the notice counts the stored copy. A project in
   OneDrive: originals still print.
4. Clipboard on the Mac app (WebKit): ⌘C/⌘V on a board, a screenshot pasted onto a board, ⌘C on the board then ⌘V in
   TextEdit gives the items' words.
5. Performance: the 500-item board on your Mac and a mid Windows laptop (`SB_PERF=1 npx playwright test
   e2e/perf.spec.ts --project=chromium`, and by feel in the app): pan, zoom, drag smooth.
6. Live cards: a shot card follows the frame's lens and size; double-click jumps back; a trashed frame reads "In the
   Trash".
7. Connectors, sections, align and tidy, snap guides; quick-create with ⌘⌥→ (Ctrl+Shift+→ on Windows). On Windows
   with two keyboard layouts installed, Alt+Shift+H/V/T don't switch the input language.
8. Swatches: a .ase opens in Illustrator, InDesign or Photoshop; the Project data (JSON) export now saves on desktop
   (it was refused there since Phase 2).
9. Present on a second screen, F for full screen; nothing you press while presenting changes the project.
10. Windows 10 (item 11 of Phase 4's list) with a board open.
11. Once #147 is merged: select a dropped picture: Show in Finder (Mac) and Show in Explorer (Windows) show its
    original, selected, never opened; move the original away and the action goes. On the Mac, a picture whose
    original is in Desktop or Documents: does selecting it raise the folder-access prompt?
12. Once #148 is merged: a deck PDF with Outfit Bold, Archivo Light Italic, Jost at several weights and a large
    Bodoni Moda title: each prints in its own face and weight, with no notice.
13. A large Bodoni Moda title, screen against PDF (Kevin, Nov 13: the one optical size is accepted; the PDF's is
    about 2% wider with less contrast).
14. From docs/DESKTOP_GAPS.md, on the `checkpoint/nov13-v2` installers (made before 5.12): attach a company that
    has a logo to a project (expected to fail there, A1; fixed by 5.12); Windows: drag a page in a deck's Pages
    panel to reorder it (B1); Mac: Assets, Copy link, then paste somewhere (B2).
15. The Inspector's Shoot day row (5.11, once merged): a frame in a day shows "Day 2 · date" and opens Shoot days
    on it; a frame in none reads "Not scheduled".

### Waiting for Kevin (Phase 5)

- Merge #135–#145 (and #136's baselines).
- Board content is never themed (decided by default, 5.1a): a missing colour is ink and the board's canvas is paper
  in light and dark.
- "Show original" (reveal a picture's original in Finder/Explorer) was left out of 5.1b: CLAUDE.md allows opening only
  http(s) links and files the app wrote itself.
- Static instances of the variable bundled fonts (fonttools at build time), so Outfit and Archivo print at every
  weight; today a weight more than 100 from their default prints in Inter Tight, with a notice.
- History doesn't name the board a palette was made from (a stored label would be a format change); a notice does.
- A palette card's hex is copied from a strip button, not by clicking a swatch on the canvas.
- The Vite dev-server socket flake: a narrow filter for `ws://localhost:1421` in a shared console helper, or live
  with it (console errors are never filtered without Kevin).
- A line for .claude/agents/builder.md: long commands run in the foreground, and the report is sent when checks end.

### Next session: start here (Nov 10, night: Phase 4 merged, Phase 5 under way)

- Phase 4 merged into `v2` (Nov 10, after Kevin allowed `gh pr merge`): #120 to #133 in order, then the docs PR #134,
  merge commits, branches kept. Each branch held the ones below it, so before each merge `git merge-tree` showed the
  merged tree equal to the PR's head tree, the tree its green CI had run on. #123's checkpoint Windows job had failed
  (the video-stop test, fixed in #124). The full checkpoint on `v2`: `checkpoint/phase4-v2` (see the report).
- Kevin's Nov 10 answers, written in: Phase 5's 13 decisions (docs/PHASE5_DECISIONS.md, CLAUDE.md's Moodboards and
  decks, PLAN.md's milestones; font-kit 0.14.3 approved); the message dialog from Rust is OK, only to confirm a new
  host; keys for one's own tile server later; the emergency table accepted, Bolivia "check locally"; 4.8's department
  rules approved; 4.7's Spanish words still wait for him.
- Windows 10 22H2 is supported (Kevin, Nov 10): what could differ is in PLAN.md ("Windows 10"), the pass is item 11
  below and a line in Phase 8's release checklist, and the README lists the supported systems.
- Waiting for Kevin: an offline Windows installer for PCs without WebView2 or internet (Tauri's `offlineInstaller`,
  well over 100 MB more; recommended as a second installer at Phase 8); naming the Media Feature Pack when a playback
  copy fails on an N edition (a small fix); Intel Macs (only Apple silicon is built).
- Still to do from Nov 10: "Week starts on" becomes "By this computer's region" the next time the Settings
  screenshots change anyway.
- Builder model: every builder run's transcript recorded `claude-sonnet-5-5` at effort medium.
- Leftovers (deleting was refused): test-results/probe.test.ts.leftover, test-results/shots, test-results/e2e-run*.log,
  test-results/fp*. All build output.

### Phase 4 gate: Kevin's checklist (riskiest first)

1. On both computers, from the `checkpoint/phase4-v2` installers: a real shoot day's call sheet end to end (who's on it, calls,
   cast times, contacts), Export PDF, then Issue; open the issued PDF in Preview and in Acrobat or a browser.
2. The map (desktop only; nothing in tests touches the network): open a location with a place, pan and zoom (click
   the map first; Ctrl/⌘ + wheel always zooms), drag the pin, ⌘Z. Then a fast wheel from 16 to 10: in the cache
   folder's tiles/osm, no zoom 11–15 tiles should keep arriving once you stop.
3. Settings → Online services: "Use this server" with an own tile server: the system question must name the host;
   Cancel and Escape save nothing. (The dialog plugin's message dialog from Rust: OK'd by Kevin, Nov 10.)
4. The forecast on a location a few days out: fetched once, "Up to date until …" on Refresh, the MET credit; then
   Settings → App → Weather units.
5. Sun times at a place far from your time zone (pick a zone on the location), and a high-latitude place in June
   (Reykjavík): merged golden and blue hours with +1.
6. Find nearest hospital (Nominatim, on a press), pick one, the safety box (Emergency/Ambulance and the number), type
   another name over it (the 24-hour line and distance go).
7. The checks strip: a cast member with HMU 20 minutes after call; a location missing parking; a DAWN scene on an
   overnight day (18:00 to 08:00) must not be flagged. (#122's who's-on-the-day: a new day starts empty; Add everyone;
   a time typed on a member stays theirs when the department's call changes; ⌘Z inside a time field.)
8. Your company profile attached: the logo's colours on paper match the logo file (WebKit on the Mac stores logos in
   P3; the PDF redraws them in sRGB).
9. On a Mac: WebKit wasn't run for the call sheet tests (only the smoke set runs there); the call sheet tile and its
   PDF on the Mac are worth a look, and a half-typed time in a time field on WebKit may clear it (as the Shoot days
   tile's times already do).
10. Mark a frame Have: it leaves the sheet; the Calendar still lists its scene.
11. Windows 10 22H2 (Kevin, Nov 10; CI only runs Windows Server), from the checkpoint's Windows installer:
    - install on a PC with WebView2, on one without it and online (the installer fetches it), and once without it and
      offline (expected to fail today: the offline installer is a Phase 8 question);
    - double-click a .sbd, a second launch handing its file over, Settings → App's region formats and week start;
    - a playback copy and a grabbed still (on an N edition, only after the Media Feature Pack);
    - the Q2 board and a map, panned and zoomed, for smoothness on an older GPU;
    - a call sheet's forecast and tiles (certificates through Windows' store), Export PDF and open it.

### Next session: start here (Nov 10)

- Done Nov 10: #112 (3.17) merged after Kevin compared all 20 baselines; #119 put `services.json` on `main`
  (Nominatim on); 4.0's brief updated with Kevin's Nov 10 answers on branch `phase4/4.0-service-switch` (the file is
  on main, the codes and the tab approved, the Spanish "Según la región de esta computadora", Settings' real files),
  with README's Node 22.18 line.
- The builder still couldn't start: Nov 10's "new session" was this conversation resumed (its transcript began
  Nov 4), and agent files load only when a conversation starts. A brand-new conversation is needed. In it: check out
  `phase4/4.0-service-switch`, start the builder on the brief, confirm its transcript records `claude-sonnet-5-5`
  (Kevin: if not, stop and tell him), then on through Phase 4.
- Kevin's Nov 10 notes still to act on: 4.3 uses tzf-rs on the Rust side, not tz-lookup (MIT, OSM data about 10 MB,
  a release at least two weeks old; tell him before falling back if it doesn't build cleanly on Windows and the Mac;
  CLAUDE.md's Stack line and PHASE4_DECISIONS change with it). 4.0's Settings screenshots are shown to him the 3.17
  way.
- Done locally: `.git/info/exclude` no longer hides `.claude/agents/` (only `.claude/settings.local.json` of .claude).

### Next session: start here (Nov 9, late)

- Merged tonight: #114 (agents), #115 (Kevin's answers in the docs), #116 (3.18), #117 (3.19). #112 (3.17) has every
  Settings baseline regenerated and a comment for Kevin; it waits for him to say merge.
- Next: 4.0, the service switch. Its brief is complete: docs/briefs/4.0-service-switch.md. Start the builder with it
  (no model passed; check the subagent's transcript records `claude-sonnet-5-5`, as Kevin asked to be told how each
  agent's model was confirmed). Then 4.1 to 4.8, 4.9, 4.10 in order, each split into briefs, stopping at the gate.
- Decided by default in 4.0's brief, for Kevin's review: the file at the repo root on `main`
  (raw.githubusercontent.com), reasons as codes with translated words (never text from the file), and a new Settings
  tab, Online services (it changes the Settings screenshots again).
- Leftover: test-results/probe holds 3.19's probe files (build output; deleting them was refused by this session's
  permissions). Nothing reads them.

### Kevin's answers and the new way of working (Nov 9, evening)

- The builder couldn't run in this session: agent files are read when a session starts, and this one started
  before builder.md existed; the general-purpose agent is denied by this computer's local settings, so there was no
  stand-in either. 3.18 (subtle approval logic) and 3.19 (a CI change) were done by the main session; the long Phase 4
  code waits for a session that loads the builder.

- Workflow (#114): the main session plans, briefs, judges reviews, does git and writes reports; the builder
  (.claude/agents/builder.md, Sonnet 5.5, effort medium) writes the long code from complete briefs, one at a time in
  this checkout; the reviewer (Opus 5.5, effort high) stays read-only. Agent files are read when a session starts:
  the builder was first usable in the session after #114.
- Phase 4 answered and approved (docs/PHASE4_DECISIONS.md, CLAUDE.md's call sheet and network rules): order 3.17's
  baselines (on #112's branch, not merged; Kevin compares and says merge), 3.18, 3.19, then 4.0 to 4.10, stopping at
  the gate.
- The map: answered (4.9): react-konva, tiles through Rust with a disk cache, OSM's tile policy; the section "Map:
  before building" below is history now.
- Pins chosen (each at least two weeks old on Nov 9): suncalc 2.1.1 (Oct 5; 2.1.2 and 2.1.3 are newer than two
  weeks), qrcode-generator 2.0.4, @photostructure/tz-lookup 11.7.0 (Sep 16; 11.8.0 is Nov 5). tz-lookup's code is CC0;
  its zone shapes come from timezone-boundary-builder (OSM data); its README says it trades accuracy for size (about
  30% of random points on Earth differ from the exact library, mostly far from people), which the edit on the
  location covers.

### Phase 4: plan written, waits for Kevin (Nov 9)

- Kevin's Nov 9 order: 3.4, then his changes as small milestones (3.12 to 3.17), then the Phase 4 plan and a one-page
  decision sheet, not the build. Done: 3.4 #106, 3.12 #107, 3.13 #108, 3.14 #109, 3.15 #110, 3.16 #111 merged; 3.17
  #112 ready but held for the Settings screenshots (below); the plan in PLAN.md ("Phase 4 milestones") and
  docs/PHASE4_DECISIONS.md.
- Weather, from the sources' own pages (Nov 9): Open-Meteo's free API is non-commercial only, and its commercial plan
  is a publisher's key, no price on its page; MET Norway's Locationforecast is free for any purpose, paid apps
  included, worldwide, CC BY 4.0 ("Data from MET Norway"), with an identifying User-Agent, coordinates cut to 4
  decimals and no repeat before `Expires` (6-hourly outside the Nordics); the US National Weather Service is free for
  any purpose but US only and 7 days. Recommendation: MET Norway (a CLAUDE.md rule change, Kevin's).
- Hospitals: Overpass's public server asks commercial apps not to rely on it; Nominatim (already on the host list)
  searched in a box round the location, on a press, sorted by distance; Google Places with the person's own key when
  set. OSM data printed needs its credit and copyright address.
- Waiting for Kevin, besides Phase 4's answers: the map (Leaflet, pigeon-maps or our own on react-konva; tiles through
  Rust), and 3.17's screenshots.

### 3.19: review

- Built by the main session (a CI change; the builder wasn't loadable). Reviewer round 1: three mediums, fixed: a
  Playwright run that failed outside every test (a spec that threw as it loaded, no tests found, the web server) and a
  Vitest file failed by a hook listed as clean; and a rerun of one file rewrote the full run's report (each report's
  start time is printed now, and CLAUDE.md says to list them right after the full run). Lows: `engines` raised to
  Node 22.18; Vitest's unhandled errors, which its report can't hold, said in the docs; a job cancelled by its time
  limit keeps no report (as before; noted). Both failures outside a test were probed against the real reporters.
- The probe files are in test-results/probe (build output); deleting them was refused by this session's permissions,
  so they stay until Kevin or a clean deletes them. Nothing reads them: outside testDir, Vitest's include, tsconfig and
  eslint.
- The first full end-to-end run of 3.19 failed 7 tests, all unrelated (a11y sweep light en and es, custom fields,
  department status 3.6b, docking, PNG export work, gear), in 11.2 minutes instead of 3.9: the main session was
  editing files and running lint and Vitest beside it. The quiet rerun passed all 307. Run the suite alone.
- Checks: lint, unit tests and Rust pass; end-to-end (Chromium) 307 passed, 0 failed, 2 skipped.

### 3.18: review

- Built by the main session (the builder wasn't loadable yet). Reviewer round 1: no high; one medium, fixed: schema
  13 missed scenes schema 12 emptied (`characters: []` or blank names: the prop came off with no ids), so their
  3.6b approvals stayed "Changed"; it now takes any update with a `characters` list before, no name after, a changed
  cast and nothing else changed. Lows fixed: the comment on which fingerprints are lazy, two more `3:` pins (a cast
  and a rig, camera and art), fuller schema 13 tests (stamps unchanged where they should be, a file today's 12 already
  re-stamped gets no step), and SBD_FORMAT says a Restore to between 12's step and 13's brings the false "Changed"
  back (approving again clears it). Round 2: nothing high or medium; its one hardening (a step that left the cast as
  it was isn't 12's) is in.
- Checks: lint, unit tests 1,024 and Rust 162 pass; end-to-end (Chromium) 307 passed, 0 failed, 2 skipped.

### 3.17: review

- Decided by default, review: see PLAN.md, "3.17 as built" (the setting is this computer's; a region that starts on
  Saturday or Friday starts there, though the override offers only Sunday and Monday, as asked).
- Round 1: no high; one medium, fixed: on a Mac the region picked apart from the language (`AppleLocale`'s `rg=`,
  Spanish (Spain) set to Mexico) was dropped, so the week started where the language's region does; it's read as the
  region now. Lows fixed: Linux's `C` and `POSIX` name no region; China starts on Monday (out of the Sunday list), the
  Maldives on Friday; the region is read as the app starts, not when the Calendar first draws (no redraw from Sunday
  to Monday); the end-to-end test waits for the Spanish-named Settings to close.
- The Settings screenshots: the new "Week starts on" field is on Settings → App, which the four `settings-*`
  tests capture. Every baseline was regenerated (Windows here; Linux and the Mac from a checkpoint), Kevin compared
  all 20 (only the field changed) and said merge, Nov 10.

### 3.16: review

- Decided by default, review: see PLAN.md, "3.16 as built" (the word "changed" beside the dot; in a focus view, your
  departments alone, as the cards; the marker inside the heading, as the counts are).
- Round 1: no high; two mediums, fixed. The approved mark was a check, which beside "4 have · 1 need" read as Done
  and gave Approved two symbols: it's the Approved diamond the Inspector uses, and a count. In a focus view the cards
  count your departments alone, but the heading counted every one: it counts yours too now. Lows fixed: the dot paper
  on the dark theme, as warnings are (the warning colour is under 3:1 there); departments this version doesn't show
  aren't counted; the counts worked out once per edit, not on every selection move; the words name their subject
  ("1 department changed since approval"), and the Spanish mark is "con cambios" for any count; tests for a mixed
  sign-off, an unknown department, a focus view, every board view, and the marker after undo; a CLAUDE.md sentence.
- Round 2: no high, no medium. Lows fixed: wording ("paper", not "ink"); the summary takes the scene's id.
- A full end-to-end run failed once in player.spec (2.7's grab a still); alone it passed 8 times and its file 3
  times in a row (33 tests), and the next full run passed (307). Seen once; watch for it.

### 3.15: review

- Decided by default, review: see PLAN.md, "3.15 as built" (the scene's heading, which frames it has and a frame's
  own location count as shared; crop and the video clip are the picture; note cards and a LUT count for no one).
- Round 1: no high; two mediums, fixed. A frame's video clip (its in, out and framing, or unlinking it) no longer
  counted, though the board plays it as the frame's picture: it counts for every department again. Nothing pinned
  3.6b's fingerprint, so a later tidy could have turned every older approval "Changed": both rules' fingerprints are
  pinned as literals now. Lows fixed: a frame's own location counts; the shared part is hashed once a scene and the
  old fingerprint worked out only when an older approval is read; the CSV works a scene's approvals out once, not on
  each frame's row; a tick written `false` is the same as none; tests for every heading field, for what doesn't count,
  and that migration 9 carries by the new rule.
- Round 2: no high, no medium. Lows fixed: the old fingerprint was still worked out on every check (now only for an
  older approval, tested); a comment; long lines.
- The full end-to-end run caught a Calendar flake from 3.8: keys pressed while an arrow crossed into another month
  could be lost (about one run in eight). Fixed here (focus moves as the grid is drawn); 40 runs in a row passed.
- For Kevin: a file that went through schema 12 (3.13) with a script's scenes already shows its older approvals as
  changed (that upgrade rewrote the scenes' character lists, which 3.6b's rule counted); approving again clears it.

### 3.14: review

- Decided by default, review: see PLAN.md, "3.14 as built" (slate numbers stay, lookups go, Cast and crew and the
  names on scene approvals stay, the ids).
- Round 1: no high; two mediums, fixed. The Export dialog's line under Project data still said it held the Trash, the
  History and named versions: each choice says what it holds now (tested end to end). Erased sketch strokes, with who
  erased them, stayed in Project data, since Empty Trash's own list doesn't take strokes: Project data now leaves out
  every record in the Trash, of any kind, and what's under it. Lows fixed: the size estimate counts only what Project
  data writes (a Trash full of replaced pictures no longer refuses it); tests for a picture a live and a trashed frame
  share, the app's own `file` prop, an erased stroke; the format doc's sample header.
- Round 2: no high, no medium. Lows fixed: building the list of what's under each record was quadratic; two comments.
- The full end-to-end run caught one of its own: projects.spec's check of the old "All of it" line under Project
  data. That run's output was cut to its last lines, which hid the failure behind tail's exit code; caught from the
  count (306), fixed, and the full run passed (307).
- Left: the import of Project data is tested in the unit tests, the import end to end only with the Full archive.

### 3.13: review

- Decided by default, review: see PLAN.md, "3.13 as built" (a trashed character isn't matched; the first of two
  of one name; a value that isn't a name stays).
- Round 1: no high, no medium. Lows fixed: a scene put back in the older shape (Restore to here, or a version opened
  from before the upgrade) read no characters; it reads its names as the upgrade matched them now. A restore that
  keeps a scene as it is now keeps its characters too (tested, and the test fails without it). The import took the
  last of two characters of one name, the upgrade the first: both take the first. The import wrote an empty list.
  Tests: the characters the upgrade made go with a restore to before it and come back with its undo; a second run
  changes nothing.
- Round 2: no high, no medium. Lows fixed: the fallback never matches an empty name; it sorts only characters. The
  restore change was first widened to a frame's shoot day and gear too, which changed how those restore (a frame
  could point at a day left in the Trash); narrowed back to characters, the shoot day and gear gap noted where it is.
- Left: the upgrade's History line, when it makes characters, reads "Added 2 characters" and doesn't say the scenes
  changed too; a character with a sort key that isn't base-62 (hand-made) would stop the upgrade, and the file opens
  as before with its backup; an odd `character_ids` (not a list of ids, never written) is replaced.

### 3.12: review

- Decided by default, review: see PLAN.md, "3.12 as built" (read-only copies, every copy marked as from the internet
  so Acrobat opens it in Protected View, a day's keep, links with a name and password refused when added).
- Round 1: no high, no medium. Lows fixed: the plugin's script that sends link clicks to it is off (those calls could
  only be refused, and would have swallowed a link's click); a test fails if the page is ever given a permission
  beyond today's five, or a capability or permission set appears anywhere else; the not-a-PDF and missing-PDF
  refusals tested; copies marked as from the internet on Windows; copies tidied at start too; a copy's name keeps no
  bidi override, zero-width character or byte-order mark (a name with U+202E can't pass for a PDF's), no dot after a
  space at the start, none of the other device names (CONIN$, COM¹…), and is capped in UTF-16 units; links with a
  name and password, or too long to open, refused when added; read-only cleared only on Windows.
- Round 2: no high, no medium. Lows fixed: the permissions test is a fixed list; a comment; `.pdf.pdf` after a cut.
- Left: links saved before this with a name and password are refused by Open with the general words; on a Mac the
  copy isn't quarantined; the devtools probe (the page calling the plugin itself) wasn't run by hand, the
  capabilities test stands in for it. One unit run failed once with one test and passed the next five; its name wasn't
  caught (the summary line only); watch for it. For Kevin's checklist: Open a PDF and a link on each computer; on
  Windows, Acrobat shows Protected View.

### 3.4: review

Kevin's Nov 9 answers came with this milestone: the address search approved (one HTTP client for every network need,
MIT or Apache, rustls, pinned at least two weeks old, Tauri's own; fixed hosts; a generic User-Agent); the opener,
a map, characters as ids, the JSON export's two choices and three changes to defaults approved as 3.12 to 3.17; the
Phase 4 plan after them, not its build.

- Decided by default, review: the address as typed stays (an empty one takes the place's name); a new address takes
  the place off the map in the same edit (re-spacing doesn't); results picked after the words changed are refused; the
  cache is keyed by language too; Empty Trash of any location clears every cached address search (the cache can't say
  whose each was); a browser release build has no search.
- Before review: a live search through the client, once, by hand on Windows (rustls with the OS's certificates; names
  in Spanish when asked); the probe was a test written for it and taken out again.
- Round 1: no high; one medium, fixed: a pin outlived a changed address, so Copy map link (and Phase 4's call
  sheets) would point at the old place; results found for old words could be picked too. Lows fixed: the search
  cache outlived Empty Trash (addresses are private); the status line wasn't announced when it appeared; Search again
  dropped focus; an unreadable fetch time showed "Invalid Date"; the stand-in read an empty coordinate as 0; an item's
  History showed a pick three times; results waited behind queued edits for the cache write; a backlog of waiting
  searches had no limit; rustls wasn't pinned exactly. A release build checked: no recorded answer in `dist/`.
- Round 2: no high, no medium. Lows fixed: the unpin rule lives in the model (`unpinnedBy`) for every later writer;
  re-spacing an address keeps its place; the refusal says "address or name".
- Low left: pressed twice quickly while a long edit is queued (a picture import), the second press can miss the cache
  and ask Nominatim again (still a second apart).

### Map: before building (a question for Kevin)

Kevin chose Leaflet with raster tiles, asking to hear first of a better small MIT or BSD option. Three things:
- No new dependency at all: a raster tile view drawn with react-konva, which is already in the build and which
  CLAUDE.md asks for on every canvas ("Every canvas: react-konva"): tiles, pan and zoom, a pin, the credit; about the
  size of the crop view. pigeon-maps (MIT, no dependencies, about 230 kB unpacked, last release Dec 2024) is the small
  library option; Leaflet (BSD-2, 1.9.4 from May 2023, 3.7 MB unpacked) the well-known one. react-leaflet's licence is
  Hippocratic 2.1, not OSI, so Leaflet would be used on its own.
- Where tiles come from: a map in the page loads tiles straight from the tile server, outside net.rs and its host
  list, and caches them only as the browser does. Through Rust instead (a scheme of its own, as the Player's copies
  are), every tile goes to a listed host with the app's User-Agent and is cached on disk, as the tile policy asks.
- The provider switch: a provider of the person's own means a host the code doesn't list. Either Settings adds that
  one host to the list (said so where it's set), or only providers listed in code can be picked.
- Recommendation: react-konva, tiles through Rust with a disk cache, and a provider of one's own added to the list
  from Settings. The map waits for Kevin's answer; nothing else depends on it.

### 3.11: review

- Decided by default, review (PLAN.md, "3.11 as built"): PDFs share `media_files` with pictures (no schema bump);
  the Assets tile only for now; Save a copy and Copy link stand in for opening (the opener plugin waits for Kevin);
  http and https links only; the Storage tab counts PDFs with pictures.
- Before review, the end-to-end test caught two of its own: the link form's browser check refused a bare address the
  app accepts (the app checks it now), and a rename read the field after React had let go of it (a crash: it reads
  the value first now).
- Round 1: one high, fixed before merge: restoring a PDF or link that was on a frame made it the frame's picture and
  sent the real picture to the Trash (the picture restore read every media record under a frame as a picture). An
  attachment comes back as itself now; tested with a frame that has a picture.
- Round 1 mediums, fixed: attaching a file to a frame marked the scene's approvals changed (the fingerprint reads a
  frame's picture and sketch, not its attachments; tested); a Trash row ran a name and its kind together ("Release.pdf
  (PDF)" now); a PDF renamed without ".pdf", or with a folder in it, couldn't be saved, silently (names are kept to
  ones Save a copy can use, and a failed save says why); focus fell to the page after adding a link, while choosing a
  PDF and after a delete (kept in the tile; tested). The over-50 MB refusal on the desktop comes from Rust in its own
  words (error.fileTooLarge, translated), not the tile's longer one.
- Lows fixed: "localhost:3000" and other bare addresses with a port read as addresses; Spanish "Eliminar"; frames in
  the picker named with their scene.
- Round 2: one medium, fixed: a PDF name starting with a dot passed the rename check but Save a copy refuses it (the
  check now matches Rust's, and also refuses Windows device names such as CON.pdf). Lows fixed: a refused rename puts
  the old name back and says why; "https//x.com" (a missed colon) is refused instead of becoming another address.
- Round 3: nothing high or medium. Lows fixed: a rename that comes to the same name ("Contract" for Contract.pdf, or
  trailing spaces) just shows the name again, with no notice; the notice names every reason; COM0, LPT0 and control
  characters refused; "htps//x.com" and "https:/x.com" refused. A PDF name is held to what Windows accepts even on a
  Mac (no * ? " < > |), so a project's PDFs save on either.
- Lows left: a 50 MB PDF is held in memory a few times while it's stored; attachments under a frame or a person in the
  Trash are hidden from Assets and not counted in Empty Trash's confirm (Empty Trash deletes them with their parent);
  an older build shows a location's PDF as an empty photo; the Storage tab counts PDFs with pictures.

### 3.10: review

- Decided by default, review: your own steps count as read, by the name signed (limits in PLAN.md); the reader is This
  is me, else `local`; opening a step picks its item; the status bar's count shows only while something is unread
  (which also keeps the screenshot baselines as Kevin approved them); This scene reads where records are now.
- The full end-to-end run caught one of its own: the screenshot tests saw the status bar's new "0 unread". Rather than
  regenerate the baselines unseen (Kevin asked to see them first), the count shows only when there's something unread.
- Round 1: one high, fixed before merge: the Mark all read cursor was a clock time, so a step from a computer whose
  clock ran behind could be hidden for good, and one stamped ahead could read every later step. It's a place in the
  log now (`read_through_seq`, schema 10 not yet released), and only moves forward; tested.
- Round 1 mediums, fixed: Mark all read through the wrong step (gone with the place-based cursor); state shown and
  written across a project switch (the store starts again for another project or reader, writes check it's the
  open project's, the tile is keyed by project); the count covering steps the list couldn't show (Show older steps);
  the whole log read after every edit (read once a project, then only new steps); a late load taking back a read
  (merged); opening your own or a read step writing anyway (nothing written). The own-steps rule's limits are written
  down (PLAN.md, SBD_FORMAT.md). Tested: the cursor by place and never back, the own-steps rule, the merge; the
  project-switch guard and Show older steps aren't tested on their own.
- Round 2: no high; one low-medium, fixed: a reader switched while a write waited set the wrong person's state in
  memory (the write lands for whoever it was made for, or the store isn't touched). Lows fixed: the tile keyed by the
  open file (a copy keeps the project's id); the merge tested; wording.
- Lows fixed: the status bar's button named "3 unread: open Notifications"; read state counting for backups noted.
- Lows left: This scene and opening a step read where records are now; no JSON round-trip test with read state rows
  (the export is generic over tables).

### 3.9b: review

- Decided by default, review: gear picked from the catalogue only; the check finds gear missing from a day, not a
  day short of how many its frames need together (with call sheets); `runChecks` reads and never changes anything;
  the edits for gear stay in src/features/gear for now (as 3.9a's do), to move to core before Phase 7's MCP needs them.
- Round 1: no high, two mediums, fixed. A frame already shot (Have, Source) was still flagged for missing gear: the
  check reads frames still to shoot, as the day's totals do, tested. The Inspector's warning was a live region present
  from the start (never announced): it's a plain line, read with the section, and its words sit beside the ⚠.
- Lows fixed: an item asked twice goes on once; History counts a list as the picker does; "Not on the list for Day 1 ·
  Mon, Nov 16"; the day's list of findings has a visible caption; the check is worked out once per set of records;
  tests for a scene in the Trash, a day in the Trash, axe on the Inspector's Gear.
- Lows left: no unit test for the day's rentals sum (end to end covers it); Spanish list() not tested on its own.

### 3.9a: review

- Decided by default, review: 3.9 split in two (the catalogue first, then a list per day, frames and the first
  check); an item's category is its department; a short list of currencies; English money as the computer's region
  writes it, as dates already were.
- Round 1: no high, five mediums, fixed. Leaving the quantity or rate field untouched wrote over a value this version
  reads differently (a quantity stored out of range, a negative rate): an untouched field now writes nothing, and one
  holding what this version can't read is read-only. Typing into a text field holding something else (a newer
  version's) was dropped silently: it's read-only, saying why. A source this version doesn't know showed as Owned:
  it shows neither. A money test assumed a US locale: it asks Intl the same way. A currency without cents (yen) could
  show a total that didn't add up: rates are kept to the currency's own unit.
- Lows fixed: 1.005 rounds to 1.01; two unnamed items sort steadily; a refused quantity or rate says why; the
  Spanish Delete reads "Borrar"; tests for the Trash's Empty Trash and History's words.
- Round 2: no high; one medium, fixed: text the rate field can't read as a number (it reads as empty) passed for an
  untouched field and was silently not saved; it's refused with a notice now, tested end to end. Lows fixed: rates
  round as written beyond 1.005 too (349.995, 0.285, tested); a name differing only by a trailing space isn't
  rewritten on a mere visit; a read-only field's reason is read after its name, not only in its title.
- Lows left: History's day rate is a bare number, without the currency; the prop names History reads for gear
  (quantity, source, owner…) are read for every record type (no other type has them today). A rate or quantity another
  version stored as something other than a number can't be changed here.

### 3.8: review

- Decided by default, review: a day's crew is everyone in Cast and crew until Phase 4; the week's first day by
  language (Sunday in English, Monday in Spanish: Kevin may prefer Sunday for Latin American crews); a day's
  locations are its frames'; availability waits for Phase 9; the Layout menu's Open tile list in two columns.
- The full end-to-end run caught one of its own: with the Calendar built, the Layout menu's Open tile list grew long
  enough to cover the Player's Maximize button (axe target-size, in every language and theme). The list is in two
  columns now, so it stays short as more tiles are built. Found with a probe (the git-excluded `e2e/zz-probe.spec.ts`,
  emptied again after).
- Round 1: no high, four mediums, fixed. Toggling crew rewrote a `crew` value it couldn't read (a newer version's):
  left alone now, tested. Hovering a date outside the month put muted text on oatmeal: ink on hover. A date's name
  lacked its week-view call time (WCAG 2.5.3): dates are named by what they show now, the full date read after. The
  crew toggle read "Confirmed" whatever its state: a shape says it (■, □).
- Lows fixed: a picked date kept across projects (the Calendar is keyed by project); Home, End, Page Up and Down;
  Spanish plurals for "confirmed"; the schedule heading said when it narrows; separators from the translations; the
  week's title across a year; month cells grow with their shoot days; six-row months tested.
- Round 2: no high; its one medium-low (a picked date isn't followed when its day moves) is as designed, a date
  picked, not a day, and noted in PLAN.md. Lows fixed: the Open tile list's divider in the border colour, no double
  rule under its last row, long Spanish names wrapping; the crew toggle's shapes are ● and ○, since ■ and □ mean
  Have and Need to shoot; the date names' tests allow either spacing, for WebKit.
- Lows left: a click on a date outside the month turns the grid to that month (the click still picks it); a `crew`
  value this version can't read makes the toggles do nothing, silently.

### 3.7: review

- Decided by default, review: a day's number from its date, never stored; a frame without a setup counts as a setup
  of its own until Phase 6; a day's frames in board order; a new day dated the day after the latest; two days may
  share a date; page eighths wait for Phase 4's scene list; a day keeps a date once it has one.
- The full end-to-end run caught one of its own: the docking test's "every built tile open" didn't count Shoot days.
- Round 1: no high, six mediums, fixed. Move to committed on every arrow key (the wrong frame moved): now pick, then
  Move. Two names didn't start with their visible text (WCAG 2.5.3). Frames marked Have since still counted in a
  day's totals. Several frames moved together read "Changed 3 items" in History; a frame's own history said "a shoot
  day → a shoot day". A half-typed date blanked the day's date. Each tested.
- Lows fixed: the minutes field's step; a date in History as a date; plural keys; focus after Add all.
- Round 2: no high. Its possible medium (WebKit may not report an unfinished date as bad input) is covered: an empty
  date is never taken as an edit. Lows fixed: Move started on Not scheduled (one click took a frame out); the select
  now starts on the frame's own day, Move off until another is picked. Frames taken out together are tested in History.
- Lows left: a mixed move (some in, some out) reads as items changed; Empty Trash leaves a purged day's id on its
  frames (read as unscheduled, as designed); a few long lines. For Kevin's checklist on the Mac: a half-cleared date
  in WebKit stays as it was.

### 3.6d: review

- Decided by default, review: names needn't be unique; a duplicate copies the layout as it is now, with the source's
  tile numbering; no Delete key on a sidebar entry (deleting asks, in the Layout menu or the window); at most 50,
  names cleaned and capped at 60 characters as a profile's name is.
- Round 1: no high, three mediums, fixed. Renaming the workspace on screen left its old name in the shell (region,
  status bar, the Layout menu's Delete question): the shell now reads the workspace through the store. Alt+number from
  one of your own in the sidebar left focus on it: focus now follows from any sidebar entry. Enter in a name field
  dropped focus to the page: it renames and stays. Each tested end to end.
- Lows fixed: each name field named by its workspace; a copy numbers its tiles as the original; names cleaned and
  capped; the window's section rules in ink; Open's focus falls back to the workspace.
- Round 2: no high, no medium. Lows fixed: a saved tile named like an object's own key ("constructor") passed the
  tile check and would have crashed the dock (own keys only now, tested); a long name's copy lost " copy" at the cap.
- Lows left: a layout store made in a test reads the custom workspaces from the real settings; module caches keep a
  deleted workspace's id (UUIDs, never reused); an entry the shell can't use, or past 50, is dropped on the next
  change; the Layout menu doesn't say why Save as new workspace is off at 50; a name typed and closed with a second
  Escape (the native close) is not checked.

### 3.6c: review

- Decided by default, review: whose view it is (This is me, else the role set on this computer); frame cards and the
  shot list narrow too, not only the Inspector; the Rest of crew fold kept open for the session, not saved; nothing to
  fold (no department of your own, or all of them) is the full view; focus stays on the fold's button.
- The full end-to-end run caught one of its own: 3.5c's test checked Camera's approval for the gaffer fallback, now
  folded under Rest of crew; it checks the gaffer's own row.
- Round 1: no high, two mediums, fixed. A focus changed while a frame stayed open (Settings → Project) kept the old
  rows in the grid: the grids' keys now carry their rows. "Rest of crew: N more" was muted on the selected shot-list
  row's oatmeal: ink there, tested.
- Lows fixed: one focus rule for the card, the Inspector and the shot list (`focusOf`), with the Full view note saying
  when there's nothing to fold; aria-controls only while open; the focus memoized by its ids; tests for the rule, the
  shot list's filter and History's words; imports; the Spanish.
- Round 2: no high; its medium (a hooks lint rule on the memo) doesn't apply, since the rule isn't loaded here and
  lint passes, but the memo now reads only its key. Lows fixed: the note for someone in every department, a stale
  comment, the Spanish again.
- Lows left: the stale-rows case is covered by the key, without a test of its own (server rendering can't change the
  focus under a mounted grid).

### 3.6b: review

Kevin's Nov 9 answers came with this milestone: approvals move from frames to scenes, with a migration he approved
(it alters existing data); the 3.6a defaults approved; CLAUDE.md kept in step with what's built without asking (a
rule change still asks); installers kept out by `.gitignore`. The reviews ran on the read-only agent, as before, with
`reviewer.md`'s instructions word for word.

- Decided by default, review: every department counts as touching every frame's fields (polish 6: every department
  is involved in every frame); the fingerprint leaves out Priority, Seen, other departments' ticks and the approvals;
  no approvals marker on the board's scene headings yet; the old Approved column left the frame's table, with a line
  pointing to the scene's approvals.
- Round 1: one high, fixed. ⌘Z after the upgrade could reach an edit from before it and write that step's whole record
  back: a scene without its carried approvals, or a frame with its own again (Restore to here had the same gap for a
  record untouched since). Migration 9 now writes its changes as one logged step (`loggedRewrite`), whose undo and
  redo stacks end there, as Empty Trash's do; History shows what moved and what came off. Tested: undo stops at the
  upgrade, an edit after it undoes and redoes, nothing from before redoes, Restore to before it is undone.
- Round 1 mediums: the fingerprint read a picture's `sha256`, which pictures don't have (it's `file`): fixed and tested
  with a real picture's props. Frame approvals this version can't read were dropped: they stay now. A suspected type
  error wasn't one (tsc passes).
- Lows fixed: the glyph hollow exactly when the box isn't ticked; the frame summaries' dead Approved entries and their
  keys gone; `updated_at` set on the upgraded records; approvals going by role pinned by a test.
- Round 2: no high, no medium; the two test gaps it named (an edit after the upgrade, redo from before it) are tests.
- Lows left: a value under a department id that isn't a list (no version writes one) is replaced when that
  department is approved; one person's two roles approved at different times on the frames carry as two approvals
  with one name. For Kevin's checklist: after the upgrade, ⌘Z doesn't reach edits made before it (History and Restore
  to here still do).

### 3.6a: review

As in 3.5c, the reviews ran on the read-only agent available here (Read, Grep and Glob), with `reviewer.md`'s
instructions word for word.

- Decided by default, review: 3.6 split into 3.6a (department workspaces) and 3.6b (custom workspaces and Manage
  workspaces…), to keep each PR small; the Department tile's contents; the sidebar's Departments list in the call
  sheet's order, kept in this computer's settings as the layouts are.
- The full end-to-end run caught two of its own: "Posproducción" spilled from the Inspector's narrow name cell once the
  name was a button (it now fills the cell and wraps as the text did), and the docking test's "every built tile open"
  didn't count the new Department tile.
- Round 1: no high, two mediums, fixed. Opening a department's workspace whose layout had no Department tile dropped
  focus to the page: it now lands on the workspace, tested. The tile's department picker (opened into another
  workspace from the Layout menu) had no test: it has one end to end.
- Lows fixed: taking off the workspace on screen moves focus to the Storyboard that replaces it (not to another
  department); Remove from sidebar uses the menu's own pattern and lands on the workspace with the sidebar hidden;
  department entries are the sections' height; two loose test assertions; the sidebar list's saving is tested; docs.
- Round 2: one high, fixed before anything was pushed: the Windows installers downloaded from the checkpoint run into
  the repo folder (`msi/`, `nsis/`) had been staged with everything else. They're out of the branch and in this
  computer's `.git/info/exclude`; the files themselves are Kevin's to keep or delete. Nothing new at medium.
- Lows left: the name button's spoken label and tooltip say the same; a ", " read before a frame's states and before
  "You" is written in the code, as in 3.5c's Cast and crew; CLAUDE.md's Navigation doesn't mention the Departments
  list (Kevin's file, raised with him).

### 3.5c: review

The `reviewer` agent type didn't load in this Windows session (it started before `v2` was checked out), so the
reviews ran on the only read-only agent available (Read, Grep and Glob), with `reviewer.md`'s instructions word for
word.

Round 1: no high, two mediums, fixed.
- An approval was signed with the profile's name, not the person picked (the end-to-end test used one name for both,
  so it couldn't tell): now the person's name, initials when the profile asks for them (decided by default, review);
  the test uses two names.
- Seen took the departments ticked in place of the role's, so a Director ticked only in Camera (the Director and DP)
  never marked Direction: Seen is now the role's departments together with the ones ticked (decided by default,
  review).
- Lows fixed: a person picked with no role says so in Settings → Project; setProjectSelf and the signature have unit
  tests (the write cap too); the end-to-end test restores the person and approves again; "You" is heard as its own word
  after the name; Spanish "los cuadros".
- Kevin approved Nov 8: Director and DP for a Director in Camera or a DP in Direction; the HDR copy test's limit at
  240 (a Windows GPU encoder measured 236); the Windows screenshot baselines (regenerated here, checked by him).
- Round 2: no high; one medium, fixed: with the profile set to initials only, an approval still took the profile's
  initials (my round-1 test expected that): it now takes the picked person's initials; an unnamed picked person signs
  with no name (the role alone), never the profile's. Low left: the Inspector itself doesn't say why a picked person
  with no role can't approve (its usual "Only the director or the DP can tick Approved." shows; Settings → Project says
  more).
- Round 3: nothing high or medium. Its two nits went into 3.6a: a picked person named exactly "local" (the edit log's
  word for no name) signs with no name, as an edit does (with initials on, "L", as an edit is signed too); a PLAN.md
  line rewrapped.
- Kevin, Nov 8: both defaults approved (signed with the picked person's name; Seen is the role's departments with the
  ticked ones). The lows below can wait. If `projects.spec`'s JSON export test fails again, fix its cause rather than
  rerun it.
- Lows left: a pick naming a person Empty Trash removed stays in the settings (it reads as no pick); a version copy or
  backup (same project id) shows the same "You", by design for now; no unit test of `useMarkSeen`'s timer (the end to
  end covers it); the one-off failure of `projects.spec`'s empty-project JSON export in a full Windows run (39 of 39 on
  its own, three times over).

### 3.5b: review

Round 1: no high, four mediums, fixed.
- The Team section showed the parts someone plays only under Cast: a cast member without the Cast department, or a
  DP with a cameo, lost them. Now shown under Cast, else where the person is listed first.
- No axe check covered the Plays toggles or a filled Team section: team.spec now runs axe on both, light and dark.
- Spanish "lo interpreta" was masculine: now "papel de {name}".
- Pressing a part someone else plays moved it silently, and the toggle's name changed with its state: the toggle is
  named by the character alone, "played by …" sits beside it as its description, and a move says whom it was taken
  from (a step notice an undo clears).
- Lows fixed: uncasting only while that person still plays the part; `cast_id` kept by Restore to here like a scene's
  location; docs (what Empty Trash leaves, the props table row, a wrong comment); the parts joined in each language's
  words; "intérprete" in History; the Team tile's sections labelled by their headings.
- Decided by default, review: "you in Cast and crew" (decision 4) moved out of 3.5b into its own milestone, 3.5c, to
  keep each PR small. Easy to fold back.
- Round 2: none at high or medium; the Team tile's heading ids are now its own (two open at once never share one).
- Lows left: no test reads `cast_id` names through a real file's History (`namedRecords`), nor a script re-import
  keeping a casting (the import never writes to a character it links, so it can't drop one); the tile titles are
  spans, so the h3s have no h2 above them (as in every tile).
- Checkpoint: `checkpoint/3.5b` failed 16 of the Mac's playback-copy tests from the known runner hang in VideoToolbox
  (`VTEncoderXPCServ` and ffmpeg stuck; the PR touched no Rust). The same commit re-run as `checkpoint/3.5b-r2` was
  all green.

### 3.5a: review

Round 1: no high, four mediums, fixed.
- A person's notes and own fields read word for word in History (an agent's phone, an allergy): they're now said
  only as set, changed or removed, as their phone and email are.
- Turning a department on or off dropped ids this version doesn't know; and a field holding something other than
  text was written over. Both are kept now.
- Decision 16 (3.4's HTTP client) was wrong on the facts: reqwest, tokio and hyper are already in the build through
  Tauri. Rewritten: reqwest with the OS's own TLS is the recommendation, and the schema 9 table is noted as allowed.
- Tests added: Empty Trash takes a person's phone out of History and the file; the JSON round trip carries a person;
  the step's own line hides a phone and notes; unknown departments kept.
- Lows fixed: the focus ring on a picked department (paper, inside, on the ink); the Delete notice names the person as
  the edit finds them; focus after Delete goes to the next person, and the editor follows; phone and email fields
  (people's and locations') turn the browser's autofill off; Spanish wording matched; "Their fields" has its own key;
  "Title" is reserved; stale comments.
- Round 2: none at high or medium. Decision 16 now says `default-features = false` (reqwest 0.13's default TLS is
  rustls). Lows left: `autoComplete="off"` may not stop WebView2's contact autofill on Windows (the reliable switch is
  WebView2's IsGeneralAutofillEnabled, set from Rust), and custom-field inputs don't carry it; a field holding a
  non-text value shows empty and quietly keeps what's stored when typed into; e2e covers focus after Delete only for
  the last person.
- Lows left from round 1: a person has no item history in the History tile yet (Notifications, 3.10, filters by item); the
  Locations tile's Delete notice reads the name from before the edit, as this one did.

### 3.3b: review

Round 1: no high, five mediums, fixed.
- History named a location's photos as "the picture of an item": it now says "Added 2 photos of Diner", and a photo
  restored with its location reads as the location coming back.
- A location's own fields used a frame's words and reserved names ("Remove Curfew from this frame"; "Lens" refused,
  "Parking" allowed twice): they now have a location's wording and reserve the location editor's own labels.
- Restoring a photo whose location is in the Trash skipped the one-name-per-place check: it now checks the location.
- A location only frames are shot at read as unused ("0 scenes"): the row and the editor now count and list them.
- A missing photo wasn't named: its placeholder now says which photo, in words and with a warning edge.
- Lows fixed: the Inspector's "This frame shot at" no longer offers the scene's own location again (it would pin the
  frame there silently), and shows a frame's own one that's unnamed or in the Trash so it can be taken off; an unnamed
  location's photo has a name in the Trash; a field left as its location goes to the Trash isn't written to it.
- Round 2: none at high or medium. Lows fixed: a frame pinned to its own scene's location isn't counted twice; an
  unnamed scene location reads as unnamed in the Inspector, not as none. Lows left: the delete notice doesn't count
  frames pinned to the location; `field.hidden` still says "frame" on a location (only for non-text custom values).
- Lows left from round 1: a location's own History filter leaves out its photos (steps.ts takes in children for frames only); a
  keyboard arrow on a closed select may make one edit per press on Windows, as the other selects do; the Inspector's
  Location row still shows the scene's location above the frame's own one.

### 3.3a: review

Round 1: one high and four mediums, fixed. History showed a location contact's phone and email (and its address) as
typed: those are now named, and said only as set, changed or removed, as the client's are (History feeds
notifications). Typing a trashed location's name on a scene (or importing it from a script) made a second, empty one,
so a restore left two and the scenes on the new one: that name now restores the trashed location, address and all; a
rename onto another live location's name is refused in words, so the "/" menu never lists two. The selected row's
focus ring was ink on ink: it's paper there. At its size in Production's layout the editor was crushed beside the
list: narrower than 520 px the list sits above the editor (the end-to-end tests now run at that size, not maximized).
History read location fields and statuses as raw codes: they have words in both languages. Lows fixed: New location
reads the records at its turn and focuses only what it made; Copy map link uses the address as typed, and works (says
the link) without a clipboard; after Delete focus goes to the list or New location, only when it was deleted, and its
notice clears on undo; scenes listed in number order; TextArea is a shared field; Empty Trash's dangling links are
documented (they read as no location). Low left: text typed in a field when the tile closes without a blur is lost.

Round 2: no high; three mediums fixed. Round 1's merged status labels were read once at load, so History said a
frame's or a location's status in the language the app opened in: each table is read as it is now (a test in
Spanish). A name kept with a stray space missed a typed one and made a second location: names are kept trimmed, and
matched trimmed. A rename onto a trashed location's name, then a restore, gave two of one name: a trashed location
holds its name ("Restore it from the Trash, or choose another"), and the Trash won't restore one beside a live
namesake (it says rename one first). Lows fixed: the tile is measured as it arrives (no narrow flash); TextArea keeps
its own id for its label. Lows left: the import preview counts a location it will restore from the Trash as new; only
address, phone and email are kept out of History (contact name, parking, power and notes show, as the client's name
does).

Round 3: no high, no medium; review done. Lows fixed: an end-to-end test of a trashed location holding its name (the
tile's refusal) and of a typed name bringing the trashed one back; a comment on TextArea's own id. Lows left: the name
checks run before the edit's turn, so an import queued at that instant could still make a namesake; a stray space
typed onto an unchanged name stays in the field until it's redrawn.

### 3.2: review

Round 1: one high and five mediums, fixed. History read an attach or detach with a logo as "Set the picture of an
item": it now says "Attached (Updated, Detached) the production company Zima Blue Pictures". Picking in the menu
attached at once, so the arrow keys attached a profile per press (and lost focus): the menu only picks; Attach (or
Replace company) copies, and controls are never disabled under focus. Logos could fill the browser store the app's
settings share, silently stopping the backups' numbers and the rest from saving: logos are smaller (320 px, at most
150k characters, stepped down to fit), and all logos together are capped (600k), refused in words past it. A replaced
logo in the Trash could be restored as a picture nothing shows: it's marked as the company's (`role: company_logo`),
left out of the Trash's list (undo brings it back with the company; Empty Trash clears it), and Update from profile
keeps the same logo rather than make another. A `logo_id` naming a frame, a scene or the project itself was trashed
on Detach: only a picture under the project is ever taken as the logo. The project's own logo now shows. Lows fixed:
Remove profile asks first (it can't be undone); text cut by characters, so a long name with an emoji reads back the
same; a too-heavy logo is made smaller rather than refused; a double click can't attach twice; no English word
stored as the logo's file name; the Settings store has a module of its own (no import circle); Open App settings
puts focus on the App tab; a copy whose profile id is empty can't read as None. Tests: the budget, the round trip of a
long name, logo kept when unchanged, a bad `logo_id`, History's three lines, the Trash's list; end to end, the arrow
keys attach nothing, the project's logo shown.

Round 2: no high; one medium fixed. Leaving old company logos out of the Trash's list left Empty Trash off while they
were all there was, so they could pile up with no way to clear them: Empty Trash now counts them (to be offered, in
the Trash tile and Settings → Storage) and its confirm names them ("1 item and 2 old company logos"). Lows fixed: only a
picture marked as the company's is ever taken as its logo (never the theme's image a `logo_id` names); focus goes back
to the menu once its button's work is done; an undo or redo of what's attached resets the menu; a copy with no logo in
the project keeps no logo mark, so it reads as differing from its profile and Update puts the logo back; History's
company lines keep the "picture removed" tag; the format doc names the `role` mark; tidier imports. Low left: a logo
saved before the new 150k cap (dev builds only, before 3.2 shipped) is dropped on load.

Round 3: no high, no medium; review done. Lows fixed: focus goes back to the menu after an action only if the person
hasn't moved on; with only old logos waiting, the Trash tile and Settings → Storage say so beside the Empty Trash they
turn on; a copy whose logo isn't in the project any more offers Update. Low left: after an Empty Trash of only old
logos, the notice counts "0 items" (the space freed is still said). The screenshot baselines for Settings (its App
tab now shows Company profiles) were regenerated on Linux and the Mac (`checkpoint/baselines-3.2-r1`) and committed;
the Windows ones are Kevin's to regenerate (checklist item 7).

### 3.1: review

Round 1: one high and three mediums, fixed. Every commit remounted the whole details block (keyed by the record's last
change), so Tab from one field to the next lost focus and text typed straight after was thrown away: each field is
now keyed by its own stored value, so an undo shows in the field it changed and focus stays where it is (the same fix
for the older title and notes fields). Edits were built from the props as last drawn, so a rename then a tick (or two
client fields) a moment apart could undo each other: each is now worked out from the project as it is at its turn
(`applyWith`). History showed the checklist as raw JSON with ids, and every client change as "changed": the checklist
reads by its items, a delivered one marked, and the client by field ("client company: — → Bey Foods"), its email and
phone said only as set ("not shown"), since History feeds notifications. Lows fixed: stages in History in words; the
box 24 px; each deliverable's field named by its place; a deliverable emptied keeps its text (Remove takes it off);
Remove leaves focus on the next box. Tests: two edits fired together both land; History's lines (no email or phone in
them); end to end, focus kept from field to field and after Enter and Remove, a rename and a remove each undone.

Round 2: no high; one medium fixed. History cut the whole checklist to one 40-character line, so a tick past the
first items read the same before and after: each deliverable added, removed or changed is now a line of its own,
matched by id ("deliverable: 3 × 9:16 cutdowns → 3 × 9:16 cutdowns (delivered)"). Lows fixed: an edit that changes
nothing (a second Remove of a row already gone) writes no step; only the client's name and company are ever shown in
History (an email, a phone or a field a later version adds is said as set, changed or removed); spaces added to a
deliverable go; a stale comment. Tests: the edits go through Settings → Project's own `detailsEdit`; undo and redo
with Settings open show in the field and keep focus where it was. Low left: a field typed in again within the moment
its own commit takes can lose what was typed (only that field, only then).

Round 3: no high, no medium; review done. Lows fixed: a checklist change no item shows (a reorder) reads as the list;
an entry in the list that isn't an item is kept by every edit; two comments. Low left: a step's line cuts a
deliverable's text at 40 characters, as every text, so a rename past that reads the same on both sides there.

### 2.9: decisions

- Decided by default, review: the JSON export carries the Trash and the History, though CLAUDE.md says exports skip
  the Trash. That rule is for
  views of the project (PDF, CSV, PNG); this export is the project itself, and "round-trip without data loss" can't
  leave the Trash out. Export says so beside the format ("All of it: … the Trash, the History …"). If Kevin wants a
  choice to leave them out, it's an option on the format, not a change to the file.
- One JSON file, a row to a line, pictures as base64, rather than a zip of JSON and image files: one file anyone can
  read, with no new dependency. The cost: base64 adds a third, and an import reads the file in one piece, so about
  300 MB of pictures is the most it takes (said if exceeded). Collect project (.sbdpack, later) is for moving big ones.
- Import makes a new project, never merges into the open one, and keeps everything, the title included; only the file's
  own id is new, so its backups on this computer are its own.
- Its columns and rows can only be checked once the new file has its schema, so a JSON that fails then (a table or
  column it doesn't have, or rows SQLite refuses at commit), or a quit during a long import, leaves the new file
  empty at the name chosen: it opens as an empty project, and a second try needs another name. A hidden draft renamed
  on success would need a new driver call; low, left.
- The copy keeps every id, the project's included: Phases 7 and 9 (change files, review copies) must tell two files
  apart by `meta.file_id`, not the project id.
- The JSON is plain text: contact details, and every old value History keeps, can be read in it. Export says so
  ("everyone's contact details … Share it as you would the project file").

### 2.9: review

Round 1: no high; two mediums fixed. The export read table after table, so a still or a picture landing meanwhile
could give a thumbnail without its picture (a JSON that never imports) or a step without its frame: it reads again if
the connection wrote anything in between, and after three tries says so. Nothing stopped an export too large to
import back: its size is worked out first (blobs as base64, text as it is) and refused past the import limit, and the
bytes are made a piece at a time. Lows fixed: a meta schema version that isn't the header's is refused; SQLite's own
refusal at commit is said in the app's words; the size is checked before the file is decoded, and text that isn't
UTF-8 is refused rather than read with replacement characters; the Rust cap is the page's limit (400 MB); Stop stops
the read; one import at a time; the parsed file is let go before the new project loads; the words say what's in it
(contact details, share it as the project file) and no longer promise "nothing lost" (videos stay outside); the Spanish
says "datos del proyecto" throughout. Tests: rows in any order (thumbnails before pictures, op groups reversed), the
deferred checks in Rust too; a commit-time refusal; the meta mismatch; an edit mid-read; the size estimate; an empty
project exports; a JSON that isn't project data is refused in words, end to end. Lows left: memory at the limit hasn't
been measured on a real webview (a Phase 2 gate check); an empty blob reads as null on the desktop (none exist today);
a failed import's empty file (above).

Round 2: no high; two mediums fixed, both in round 1's fixes. The size estimate counts characters, but the limit is
bytes (accents, quotes escaped in JSON text), so a project just under it could still write a JSON the import refuses:
the bytes themselves are checked before the file is written, the estimate kept as the early refusal. Every failed
import transaction was said as a bad file, a full disk or a sync included: only SQLite refusing the rows (a constraint,
a value of the wrong kind) is; anything else is said as it is. Lows fixed: the mid-read test counts its two passes and
finds the edit in the frame's own row; the reorder test says what it reorders (rows within a table); the too-large
words name the History as well as the pictures. Lows left: an import holds the parsed file and its statements at once
(the gate's memory check); in the browser build a file input that never says Cancel holds the import guard until a
reload; Compact during an export isn't seen by the change count (both open from different tiles; unlikely).

Round 3: no high, no medium; review done. Lows fixed: tests that the bytes refuse an export the import wouldn't take
(nothing written), that SQLite refusing a row (CHECK, NOT NULL, UNIQUE, a foreign key) is said as data that doesn't
fit and a full disk as it is; a failed ROLLBACK no longer hides the error that caused it (Node and sql.js drivers).
Low left: a sync replacing the new file mid-import says "the project file changed on disk", which could be read as
the open project's (nothing else happens).


### 2.8b: review

Round 1: one high, four mediums, all fixed. A clip could be saved over a camera original (the same file, or any
video at the chosen name): Rust refuses the source itself and any file there that probes as a video, and the export
writer never writes `.mp4`. Variable-frame-rate takes now come out at the clip's rate (an `fps` filter and constant
frame rate), so the frame count holds. Sound is cut from the same zero point as the picture and resampled to stay in
sync, and a take whose sound track can't be decoded saves without it. The file is written to a hidden partial
next to the destination and renamed only when it's whole; a timeout, a cancel or quitting the app leaves nothing. While
it saves, the button reads Cancel saving clip. Lows fixed: an anamorphic take is cropped first and scaled once; a LUT
that isn't stored has its own words; a frame with no number is named by its place in its scene, as that scene's
picture export names it; more tests. Lows left: a take whose sound is split over mono tracks (some MXF) keeps its first track only;
there's no progress readout, only the saving notice and Cancel.

Round 2: no high; four mediums fixed. Quitting while a clip saved left its ffmpeg running on a Mac and Linux, writing
a partial that was never removed: the app now waits, three seconds at most, for it to end and its file to go. On
Windows a cancelled or timed-out save couldn't delete the partial ffmpeg still had open: it's removed once ffmpeg has
ended. A second save while one ran said the folder was at fault, and its Cancel could stop the other: the save in
progress is kept outside the inspector (its Cancel is there whatever was shown since), a second is refused before its
Save dialog with words of its own, and a Cancel during the dialog or the LUT read stops it before Rust has it. A clip
was refused over only files that read as video, so a damaged original could be replaced, and saving again at the
slate name was always refused: every clip now carries a mark (its comment, `Saved by Storiiboard`), and a clip goes
only where nothing is or over a clip with that mark. Lows fixed: a panic can't leave saving stuck (a drop guard); a
stale Cancel can't stop the next save; a cancel is said as information, not as a fault; tests for a stopped render
leaving no file, one save at a time, the busy and cancel flow, and the button. Lows left: the clip's sound is the
first track only, where the copy mixes the live ones (2.3c); a variable-rate take with a gap at its in point can start
on the next real frame; a hung hardware encoder isn't retried in software (the timeout says the video was slow). The
export writer takes only csv, png, pdf and mp4 names, so it can't be pointed at a `.mov` or `.mxf`.

Round 3: no high; one medium fixed. A Cancel pressed while Rust was still checking the place (a probe of the clip
already at that name, on a slow share) was lost, and the clip was saved anyway: the save is busy from its first step,
a Cancel is looked at between each step before ffmpeg starts and again before the clip is put in place, and a refused
second save no longer clears the first's Cancel. Lows fixed: each partial has a name never used before in the run, so
a stopped ffmpeg still ending can't remove the next save's; a second save names the frame being saved, whose Cancel
it is; the stop test waits until ffmpeg is writing. Lows left: a saved clip that the project also uses as a video can
be saved over (the Save dialog asks first); a Save dialog cancelled from Cancel leaves its pick allowed for the session
(the export writer refuses mp4, so nothing can use it); quitting during the probes before ffmpeg starts waits at most
three seconds.

Round 4: no high, no medium; review done. Lows fixed: a Cancel that reaches Rust before the save does is asked
again until Rust has it; the busy notice names the clip as its file is named (and says no name for a frame in another
project). Lows left: the Cancel is on the saving frame's inspector only, so a frame trashed mid-save has none (the save
still ends by itself); the stops before each encoder and before the rename have no test of their own.

Checkpoint 2.8b-r4: everything green but the Mac's Rust tests, where the clip test's VideoToolbox session hung until
the clip's timeout (its encoder service and an ffmpeg still stuck at the end), the runner's virtual GPU again. The
clip tests now save with FFmpeg's own MPEG-4, as the copies' tests do (`save_clip_with`); what they test doesn't depend
on the encoder, and the app still uses the computer's. On a Mac, VideoToolbox is the only H.264 encoder in the LGPL
build, so a hung session there has no software one to fall back to (the low above).

### 2.8a: review

Round 1: no high; three mediums fixed. The preview seeked back to the in point while playing, so the frame after the
out point could show, and at the take's own end it stopped and played on from the take's first frame: it now pauses
on the out frame, goes back to the in point and carries on once it's there, and goes round again at the take's end.
A clip of one frame went on seeking without end: it has nothing to play (Play clip off). A copy that can't be read
showed a black box with a Play that did nothing: it's looked for and made again if it's gone, as the Player does, and
a made copy found missing is made again. Lows fixed: the end-to-end test samples the frames presented and holds them
to the out point exactly (and covers the last frame, and a clip of one frame); another frame, even of the same clip,
starts again; the button says its state in its words alone. Lows left: changing the in or out while it plays isn't
tested end to end (it stops on the new in point by its key).

Round 2: no high, no medium; review done. Lows fixed: Play from the out frame goes back to the in point (it could
play on into the frame after); a turn whose seek never ended can't hold the loop; a copy that's there but can't be
played says so (as the Player does) and Play is off; a missing original isn't remade from nothing. The clip test
passed 20 of 20 under load. Lows left: under heavy load a webview could present the frame after the out point once
before the pause lands (the test holds it to the out point; none seen).

Checkpoints 2.8a and 2.8a-r2: everything green but the Mac's Rust tests, which hung with VideoToolbox's encoder
service and sixteen ffmpegs stuck, the runner's virtual GPU again (2.3c, stop A). 2.8a changed no Rust; checkpoint
2.8b, built on 2.8a's head, passed every job, the Mac's Rust tests included, and stands for it. Merged Nov 7.

### 2.7: review

Round 1: no high; two mediums fixed. G while playing grabbed the frame from the last render and then paused, so the
still could be a frame off the one the Player settled on (and up to a few frames on a webview without frame callbacks,
which updates its readout about four times a second): it pauses first and grabs the frame it settles on. The end-to-end
test checks the still's timecode matches the readout after G while playing; in Chromium the two rarely differ, so it
can't force the old fault. A graded still of HDR footage kept its PQ or HLG tags in the PNG (probed: "bt2020,
smpte2084"), so it would be converted a second time when stored: tagged BT.709 now, as the copy is, tested by its
tags. Lows fixed: a relink during a grab no longer lands the old file's still under the new file's name and timecode;
Grab still stays focusable while it works (the Player's keys carry on) and says when it has landed; the grabbing
state is the frame's own; the browser build's still names no LUT (it grabs ungraded); a still without a timecode says
"Still from its video"; a long LUT name can be read whole; the clip prop is kept as stored. New Rust test: a graded
still is the frame asked for, in a file whose sound starts before its picture. Lows left: on Windows a grab that times
out can leave its LUT folder in the temp folder while ffmpeg is still being stopped; a tile remounted mid-grab (a
workspace switch) could start a second grab of the same frame.

Round 2: no high, no medium; review done. Lows fixed: "Still grabbed" is said only when the still became the frame's
picture (not when the frame changed under it), and is cleared on another frame; the relink check compares the file's
name and size too (the browser build's videos have no path); the tags test asks for BT.709, not only the absence of
PQ. Left as a low: the graded still's RGB frames are tagged with the BT.709 matrix as well (harmless: the PNG is RGB).

### 2.6: notes

- The titles end-to-end test (`e2e/titles.spec.ts`, F2) failed once in a full local run: after Escape in a title, focus
  comes back a frame or two later and settles on the frame card, and under load that late move pulled focus off the
  next frame the test went to. The test now waits for it to settle (40 of 40 under load). Left as a low: the title
  editor's own comment says Escape goes back to the pencil, but focus ends on the card; harmless (the keys carry on
  from the frame either way), but the two disagree.

### 2.6: review

Round 1: one high, two mediums, fixed. The picture's box was never measured (the Player measured it only when the
take's shape changed, and the box appears only once a copy is ready), so the window lay over the bars too: the box is
measured whenever it appears now, and the end-to-end test checks the window sits exactly on the picture as drawn.
Quick taps lost steps and the window jumped back until each edit landed: a move let go stays shown until its edit
lands, and the next builds on it (tested with taps and no waits between). The window's focus ring was ink on ink in
the light theme: paper now, drawn inside the edge. Lows fixed: ⌘, Ctrl or Alt with the window's keys are left to the
app and the system; a draft is dropped when the frame or video changes; a gesture the system takes over puts the
window back rather than saving; Shift let go before the arrow makes no extra step; a fast drag's last move is kept; a
move that changes nothing on screen makes no edit (a stored crop outside today's clamp stays as it was); "Framed at…"
is said once the edit has landed. Lows left: the Player tile scrolls inside its tile's own scroll area (harmless);
no end-to-end test of a non-16:9 project or a rotated take yet (the maths is unit-tested for 2.39 and 4:5).

Round 2: no high; one medium fixed: the paper focus ring (round 1's fix) sat inside the window on the footage itself,
so it vanished over a bright sky or wall; it's two-tone now (paper with ink round it), inside the edge (tested end to
end). Lows fixed: a draft is kept with its frame, so a move under way can't be saved onto another video after an undo
changes it; "Framed at…" only when the edit landed; a failed save can't leave the window stuck; a move smaller than
the stored rounding makes no edit; the zoom slider zooms from where its drag began, so out and back in keeps the
window's place; the slider ignores Shift let go; a move under way is dropped if the picture goes (a copy remade).
Lows left: for a moment on a new video the box may show the last one's size before it's measured (it measures in the
same frame in practice); the quick-taps test's tolerance is a twentieth of a percent.

Round 3: one medium fixed, then nothing high or medium; review done. A move held when the picture went (the copy
remade, a play error) came back with the frame and could be saved by passing through the slider: each reset is a
generation of its own now, so a held move never counts again (tested end to end; the test fails without the fix).
Lows fixed: the window's ink outline stays on its edge when focused; the ring is the window's own named group. Lows
left: if the picture returns within moments of an edit landing, a tap in between can build on the saved crop rather
than the one in flight (one tap lost).

### 2.5: review

Round 1: no high; three mediums fixed. A domain lut3d can't apply was kept and graded wrongly with no word (measured:
it ignores DOMAIN_MIN and never scales up): only 0 to 1 or more is kept now, Resolve's LUT_3D_INPUT_RANGE read as one.
Two loads of the same file at once could leave a video naming a row never written: loads take turns. The grade test
used grey, which every matrix keeps: a saturated patch, tagged BT.709 and untagged, through an identity LUT now.
Lows fixed: the copy's key is the hash of what ffmpeg reads, not of the file (a title no longer splits copies, and a
change to how files are read can't keep stale ones); the LUT's folder is a random name made new, its file made new (a
shared Linux /tmp can't be planted); HDR footage with a matrix FFmpeg's filters refuse keeps its re-tag ahead of the
LUT (tested, with HDR under a LUT skipping the tone-map); comments after a row, and a keyword after the last row, are
read as lut3d reads them; the end-to-end test now tells a copy found from one made again. Lows left:
- In WebView2 a closed `<select>` changes with the arrow keys, so arrowing through the list sets each LUT in turn
  (an undo step and a copy started each); a listbox that commits on Enter would avoid it.
- The words say 2 to 256 points, but the 16 MB read cap stops near 80 (a 65-point cube is 8 MB); bigger gets the
  general "too large" words.
- A refused write (the file changed on disk) still asks for a copy after `setLut`; harmless.
- A LUT folder left by a crash isn't cleaned up (temp folders are the OS's to clear); on Windows a stalled ffmpeg the
  app gave up on can hold its folder until it exits.
- No unit tests of `chooseLut` or of the picker's "Reading the LUT…" state.

Round 2: no high; the round-1 fixes held. One medium fixed: History showed a LUT change as "lut", untranslated, with
the row's id as its value; it reads "LUT" and "a LUT" now, in both languages, tested. Lows fixed: a video naming a LUT
that isn't stored says so in the list ("LUT not in the project") rather than "Reading the LUT…" for good; rows after a
keyword past the last row are left, as ffmpeg leaves them. Lows left: untagged HD footage is read as BT.601 by lut3d's
conversion and the graded copy is tagged BT.709, so a browser may show a slight hue shift between the graded copy and
the one as shot (camera files are tagged); in a browser that never fires a file input's `cancel`, a cancelled dialog
would hold later loads on that page (current Chromium, Firefox and WebKit fire it).

Round 3: no high, no medium; review done. Lows fixed: right after a new `.cube` was stored, the list said "LUT not in
the project" until it was read again (a LUT being stored now shows as being read; tested end to end, and the test fails
without the fix); a failed read of the list says so; a load that finishes after another project opened stops. Lows
left: changing one LUT to another reads "a LUT → a LUT" in History (the names live in `luts`, not in records); rows
straight after the last row are refused where lut3d would ignore them (the safer way).

### 2.4: review

Round 1 (Nov 7): four mediums, fixed with tests. The timecode read one frame early while playing in Chromium (media
time is kept in whole microseconds: a frame's start now rounds, the current time floors with a thousandth of a frame's
margin); Shift with comma or period didn't step ten on real keyboards (">" in English) and an AZERTY's period stepped
ten (now the characters step one and Shift on those keys ten; I and O also by their key); a copy the webview can't
play left the Player on "Opening…" for good, and a copy without sound could be remade over and over (now it says it
can't be played, with Try again, and is remade once at most); the timecode was a live region read out every frame.
Lows fixed: 2 MB slices (a seek answers sooner); the playhead resets per frame, not per video; a picture gone isn't
"playing"; holding I, O or Space makes no steps or toggles; an in or out point where it already is makes no edit;
copies are never served through a link. Left as lows: a request for a large copy without a range gets its first slice
as a 206 (no webview asks that way), HEAD gets a body, and the browser build's kept files aren't let go when a project
closes.

Round 2: no high; two mediums fixed: the Player's one automatic remake now resets once a copy plays (a copy evicted
again an hour later is remade, not called unplayable), and a pause settles the readout, the picture and the <video>'s
time on one frame (the readout could stay a frame behind). A copy that can't be played is now tested end to end (an
error on the <video>: said, Try again plays it, a second error never loops). Lows fixed: the "can't be played" mark is
the video's own; I and O by their key only on layouts that type no Latin letter there (a Dvorak's KeyI is "c");
`find` refuses links, as serving does. Left as a low: on a French AZERTY, Shift steps ten forward (Shift+":") but not
back (its comma is on KeyM, where Shift types "?").

Round 3: no high; two mediums fixed. Played to the end, a pause read the video's whole length as a frame past its last,
and O then saved an out point past the video: the frame is now kept inside the video, and I and O never set a point past
it. A copy without sound that loaded and then failed was made again without end (its retry for sound passed the
one-remake cap): after a <video> error the copy is now made again only if it's gone (`copyMayBeGone`). Tests: the end of
the video in e2e, the error path's remake rule in unit tests, `find` ignoring a link in Rust. Left as lows: the e2e
can't-play test can't see the remake cap (the stand-in's copies never go missing); a copy removed by the cap says "can't
be played" for a moment before it's queued again.

Round 4: no high; one medium fixed. A video whose length isn't known (ffprobe can't read it; durationFrames 0) was held
at frame 0 by round 3's clamp, so a pause jumped back to the start and I and O did nothing: the clamp now applies only
to a known length (`frameInVideo`, `inVideo`). Lows fixed: Space on the last frame replays from the in point (it played
half a frame), and the frame shown while playing never passes the last either. Left as a low: no test pins the Player's
own use of `copyMayBeGone` (a component test needs a DOM library, a new dependency: Kevin's call, as before).

Round 5: no high; one medium fixed, round 4's other half: a step (comma, period) on a video of unknown length still went
to frame 0; `stepFrame` now holds back only a known length, tested. Lows left: no test renders the Player with an unknown
length (the e2e fixture has one; a component test needs a DOM library); a relink to a shorter file can leave an in point past the end, so Space can't replay (the relink
warns about clips past the end); a copy a frame or two shorter than its record lets O set a point past the copy.

Round 6: no high; one borderline medium fixed: with round 5's fix, a video of unknown length could be stepped far past
its copy's end and O would save that point. Such a video now takes its length from its copy once the <video> knows it
(`framesOfLength`), which also gives its scrubber an end; before that it's unbounded above, as before. Only the lows
listed in round 5 remain.

Round 7: no high; one medium fixed, the reviewer's own fix: the copy's length rounded up, so a copy whose sound runs past
its picture (AAC padding, a camera's sound) had a 49th frame of 48; it now rounds down, since the picture is constant
rate and ends on a whole frame. Tested. Lows left: no component or e2e test of a video of unknown length (the DOM
library question); an in point past a copy's real length isn't clamped until the first step (shown only). This was the
last round: its one fix is the reviewer's, tested here, and the checkpoint of f131794 covers everything else.

Checkpoint stop-a (78ffa97): the Mac Rust tests failed in three tests of the queue, the stall watch and the Move,
with VideoToolbox wedged (its encoder service and three ffmpegs still hung at the end), the 2.3c story again; stop-a-r2
passed them on Mac with the same code. Those three tests aren't about the encoder, so they now use the light one, as the
sound tests do; the encoder's own tests still use VideoToolbox.

## Review stop A (after 2.4): Kevin's checklist, in this order

On Kevin's own computers, with the 2.4 installers (or a dev build):
1. Windows with a GPU: a copy of a real FX3 clip made by the hardware Media Foundation encoder. Task Manager's GPU
   "Video Encode" graph should rise while it's made.
2. A Mac: a long take on an external drive; unplug the drive halfway through its copy. The copy should fail, say so,
   and leave nothing in the copies' folder.
3. The Player on a Mac (WKWebView) and on Windows (WebView2), with real footage:
   - the copy plays, scrubs and steps without stalling (copies keep their index at the end, no `+faststart`; if the
     Mac stumbles on that, say so, and it comes back with a time allowance);
   - comma and period land on the frame the timecode says (compare with Resolve on the same clip);
   - I and O set the frame's in and out, and ⌘Z or Ctrl+Z takes each back.
4. A Sony FX6/FX9 or Canon MXF: separate mono tracks mixed, the empty inputs left out (the live pair at its own
   level); a clip with every input empty says it has no sound.
5. Settings → Storage: Clear while a copy plays (the Player offers Make playback copy); Move to another drive and back.
6. Relink a frame's video while its copy is being made, then undo: the copy shown is of the file the frame points at.
7. Windows: the screenshot baselines (`*-win32.png`) predate the Player's content in its tile, so the Windows run of
   `e2e/visual.spec.ts` will differ there; regenerate them on Windows (`npx playwright test e2e/visual.spec.ts
   --project=chromium --update-snapshots`) and commit them. The Linux and Mac ones came from `checkpoint/baselines-2.4`.
8. The Player's edges: play a take to the end (it stops on its last frame; O there sets the out point on it, never
   past); Space again replays from the in point. A take whose length the app couldn't read (rare: a damaged or
   streamed file) steps and pauses where it is, and stops at its copy's end.

## Phase 3 gate: Kevin's checklist (Nov 9; riskiest first)

Everything built overnight, Nov 9 (3.6b to 3.11, PRs #96 to #104), on the gate checkpoint's installers
(`checkpoint/phase3-gate`). Use a copy of a real project for items 1 and 2; the upgrade writes a backup first anyway.

**Format changes and migrations**

1. **The upgrade (migration 9: approvals move to scenes, which changes existing data; you approved it).** Open a
   Phase 2 project that has frame approvals in the new build.
   - A backup is written before the upgrade: Settings → Backups → Show backups.
   - A scene where every frame was approved for a department shows that department approved, by the same person.
     Where only some frames were, nothing is approved.
   - History shows the upgrade as one step, listing what moved and what came off the frames.
   - ⌘Z right after stops at the upgrade: it never reaches the edits from before it.
   - History's Restore to here still reaches before the upgrade, and ⌘Z undoes that restore.
2. **Schema 10: read state for Notifications.**
   - Mark all read, then quit and reopen: everything stays read.
   - Switch This is me to someone else: their read state is their own.
   - Steps you made yourself never count as unread.
3. **Additive props, with no migration:**
   - a person's Full view;
   - shoot days, with each frame's day, call and wrap, crew confirmed and a gear list;
   - the project's minutes per setup and currency;
   - gear items, and a frame's gear;
   - PDFs and links.

   Fill a project with all of these. Then Export → Project data (JSON), and on the Projects screen use Import project
   data…: everything should come back, PDFs included.
4. **Your workspaces (settings on this computer, never in a project).**
   - Save one from the Layout menu, then open another project: it's still there.
   - On the other computer, it isn't.

**Approvals**

5. **Approved per scene (3.6b).**
   - Only the director or the DP can approve a department for a scene: set This is me to someone else and try.
   - Change something on a frame that the department touches (lens, sketch, picture, notes): the scene shows
     "Changed since approval" for that department, and approving again clears it.
   - Attaching a PDF or link to a frame changes nothing.
   - Priority, Seen, Working on it and Done stay per frame.
6. **Approvals in the perspective views.** As a crew member without Full view, other departments' approvals sit under
   Rest of crew. As the director or DP, every department shows.

**The rest**

7. **Perspective views (3.6c).**
   - In Cast and crew, Full view is on for the director and the DP, and off for everyone else.
   - As a gaffer, say: grip and electric comes first on frame cards, the Inspector and the shot list, and the rest
     fold under Rest of crew.
   - This is a focus view, not access control.
8. **Manage workspaces (3.6d).**
   - Layout → Save as new workspace.
   - In Manage workspaces…, rename, duplicate and delete.
   - Names needn't be unique. The limit is 50 workspaces, and 60 characters a name.
9. **Shoot days (3.7).**
   - Make the days for a real shoot.
   - Move "Need to shoot" frames in a scene at a time, and one by one (pick, then Move). Each move is one ⌘Z.
   - Check the totals (frames, setups, hours) against your own estimate. Minutes per setup is in the Shoot days tile.
   - On the Mac: half-clear a day's date in WebKit; the day keeps its date.
10. **Calendar (3.8).**
    - Month and week; picking a day narrows the schedule list.
    - Each day shows its scenes, its location's status and "1 of 3 confirmed". Toggle Confirmed per person.
    - The week starts Sunday in English and Monday in Spanish. Say if Latin American crews want Sunday.
    - On the Mac: the date cells read correctly with VoiceOver.
11. **Gear catalogue (3.9a).** Enter your real kit:
    - quantities;
    - owned, or rented and from whom;
    - day rates, in the project's currency, written as your region writes money;
    - a currency without cents, such as yen.
12. **Gear per day (3.9b).**
    - Build each day's gear list from the catalogue, and give frames their gear.
    - A frame that needs gear its day lacks shows a warning in the Inspector, and the day lists it.
    - Frames already shot (Have, Source) are never flagged.
13. **Notifications (3.10).**
    - Make edits as someone else (switch This is me), then switch back: the status bar shows the unread count, and it
      opens the tile.
    - Try the filters (All, Unread, This scene), Mark all read and Show older steps.
14. **Assets (3.11).** Attach PDFs (a location contract, a release) and links to the project, a scene, a frame, a
    location and a person.
    - A non-PDF is refused, and so is one over 50 MB.
    - Save a copy… and Copy link work.
    - Rename one. A name with a folder, or one starting with a dot, is refused, and the old name comes back.
    - Delete a PDF on a frame that has a picture, then restore it: it comes back as itself, and the picture is
      untouched.
    - Empty Trash.
15. **The gate itself:** a real shoot's people, places and gear, entered. Addresses are typed by hand, since the
    address search (3.4) waits for you.

**Decided by default, for your review** (each milestone's "review" section above has the reasons)

- **3.6b:**
  - every department counts as touching every frame field;
  - the fingerprint leaves out Priority, Seen, other departments' ticks and attachments;
  - no approvals marker on the board's scene headings yet.
- **3.6c:**
  - whose view it is: This is me, else this computer's role;
  - cards and the shot list narrow too;
  - Rest of crew stays open for the session, never saved.
- **3.6d:**
  - names needn't be unique;
  - a duplicate copies the layout as it is now;
  - at most 50 workspaces, names capped at 60 characters;
  - no Delete key in the sidebar.
- **3.7:**
  - a day's number comes from its date;
  - a frame without a setup counts as a setup of its own until Phase 6;
  - a new day is dated the day after the latest;
  - two days may share a date;
  - page eighths wait for Phase 4.
- **3.8:**
  - a day's crew is everyone in Cast and crew until Phase 4;
  - the week's first day goes by language;
  - a day's locations are its frames';
  - availability waits for Phase 9;
  - the Layout menu's Open tile list is in two columns.
- **3.9a/b:**
  - 3.9 was split in two;
  - an item's category is its department;
  - a short list of currencies;
  - gear is picked from the catalogue only;
  - the check finds gear missing from a day, not a day short on quantity (that comes with call sheets).
- **3.10:**
  - your own steps count as read;
  - the reader is This is me, else `local`;
  - the count shows only while something is unread (this keeps your approved screenshots).
- **3.11:**
  - PDFs share `media_files` with pictures (no schema bump);
  - the Assets tile only, for now;
  - Save a copy and Copy link stand in for opening;
  - links are http and https only;
  - PDF names are held to what Windows accepts, even on a Mac.

**Waiting for you**

- **3.4, address search:** an HTTP client in Rust, a new dependency (docs/PHASE3_DECISIONS.md 16). Its `lookups`
  table will be schema 11, now that 9 and 10 are taken.
- **The opener plugin:** opening a PDF, a link or a map in the browser.
- **A map library**, for a map inside the app.
- **Scene character lists as ids:** this changes existing data.
- **The JSON export:** answered Nov 9: two choices, built in 3.14.
- **VideoToolbox:** the Mac's copy tests (from Phase 2).

## Phase 2 gate: Kevin's checklist (complete Nov 7; in this order, after review stop A's)

1. LUTs (2.5), on a Mac and on Windows with real log footage: load the camera maker's LUT (an S-Log3 or LogC to
   Rec.709 `.cube`) for a take; the Player shows the graded copy within a minute or so; compare a frame with Resolve
   under the same LUT (it should match closely; say if colours look shifted). Undo takes it off; pick None and back.
   Load one with a 1D shaper (a Resolve "Shaper + 3D" export) and see it refused with words that say why.
2. Framing (2.6): in the Player, zoom the frame's window and move it over a take, by hand and with the keys; it
   should feel like a frame-line overlay on a monitor. Each move is one ⌘Z. Try a 2.39 project over 16:9 footage and
   a 9:16 one over the same.
3. Still capture (2.7), the gate itself: on your own footage, frame a shot in the Player, step to the moment, press G
   (or Grab still). The frame's picture should be that frame, framed as the window was, graded with the take's LUT,
   within a second or two; the inspector says "Still at <timecode>" matching Resolve's for that frame. ⌘Z takes it
   back. Try a 6K or 8K original too.
4. Save clip as file (2.8b): set a frame's in and out and framing on real footage, Save clip as file…, and open the
   MP4 in Resolve or Premiere: its first and last frames are the in and out (match the timecode), framed as the
   window was, graded, with sound in sync. Try a long take on an external drive, and a 6K or 8K original.
5. HDR (HLG or PQ) footage under its own camera LUT: the grade looks right (the LUT replaces the tone-mapping; say if
   your LUTs expect Rec.709 in, and it changes).
6. Project data as JSON (2.9): export a real project (Export → Project data (JSON)), then Import project data… on the
   Projects screen: the new project has every frame, picture, note, the Trash and History, and undo still works in it.
   Try the largest board you have, on a Mac and on Windows, and say how long each takes and if the app strains. And
   say whether the JSON should carry the Trash and History (it does; "2.9: decisions").

## The rules for this run (Kevin's queued instructions)

**Overnight run (Kevin, Nov 9):** build 3.6b, 3.6c and 3.6d, then the rest of Phase 3 in PLAN.md order up to the
gate, without waiting for him. One milestone at a time; the reviewer until nothing high or medium is left; a merge
commit once the quick checks (the PR's CI) pass, with no checkpoint per milestone; a report after each; this file kept
current. Never rewrite commits while a test run is going. Take the recommendation on anything easy to undo ("Decided by
default, for your review"); additive format changes are approved (migration, backup first, tests). Anything that
changes or removes existing data beyond what he approved, adds a dependency, or uses the network beyond the approved
rules waits: write it down, move on to the next milestone that doesn't depend on it. At the gate, or when nothing is
left to do without him: one checkpoint for fresh installers, then one combined checklist for everything built that
night, riskiest first (format changes and migrations, then anything touching approvals, then the rest).

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
- **Reports (Kevin, Nov 6):** when a milestone is done (merged), the last message to Kevin is a report of the changes:
  what it does, what was fixed on the way, what was tested where, what was decided by default, and what's left.

## Decisions

- **Pending for Kevin:** none.
- **Decided by Kevin (Nov 7):** the defaults stand, with one change to the mix: silent tracks are left out (measured
  first; each live track at 1/N of the live ones; all silent, the copy has no sound and says so), done in 2.3c. Fix the
  relink-undo bug before 2.4 (done in 2.3c); the other two leftover 2.3b lows wait. Then 2.4, review stop A as a
  checkpoint with a checklist without waiting, the rest of Phase 2 to its gate, then Phase 3 under the rules below,
  stopping at its gate. A report after every milestone; this file kept current.
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
- **Decided by default in 2.3b, for Kevin's review** (each easy to change):
  - The queue lives on the page, one copy asked of Rust at a time, not in Rust.
  - A copy is made when a video is linked or relinked, from the inspector, and (2.4) by the Player; opening a project
    asks for none, so a big project never fills the cache unasked.
  - The copy's state shows in the inspector's Video section.
  - Settings → Storage holds the copies, the remembered videos and FFmpeg's licences (there's no About window yet);
    its sizes there are decimal (GB and MB), as the cap and the floor are, where the project's own sizes are binary.
  - The mix gives each of N mono tracks 1/N, so a take where only one of two mics was live plays 6 dB quieter than
    it was recorded, and an FX6 or FX9's four tracks with two empty play 6 dB under the two live ones' own mix (one live
    of four: 12 dB). The other way: sum them at full level with a limiter (FFmpeg's `alimiter`), louder and still never
    clipping, but it squashes loud peaks. Kept to Kevin's words ("gain kept low enough that it never clips").
  - The browser build's stand-in pretends 2.5 s and 2.4 MB a copy.
- **Known lows, deferred:** a Trash restore of a video still doesn't bring back its clip (undo of Remove does); after a
  project switch, a first missing-file check that times out leaves the flags off until the next focus; bit depth falls
  to 8 for a few packed pixel formats when the decoder doesn't say; the timecode track's own rate (59.94p with 29.97
  timecode) isn't read.

## Not in the repo

`REPORT.local.md` and the Phase 2 plan's working copy stay on Kevin's PC; everything a session needs from them is
above or in `docs/PLAN.md`. The permission rules file (`.claude/settings.local.json`) is local to that PC too.
