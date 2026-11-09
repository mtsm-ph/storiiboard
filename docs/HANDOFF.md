# Handoff

Written Nov 5, 2026, at a pause, so the work can go on from a cloud session that has only GitHub; updated Nov 9 at the Phase 3 gate (first updated Nov 6 after
2.3a, D1, D2 and 2.3b, all merged). Read `CLAUDE.md` first (the working rules), then `docs/PLAN.md` (scope, phases, status), then this file.
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
- **The JSON export:** whether it carries the Trash and History.
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
