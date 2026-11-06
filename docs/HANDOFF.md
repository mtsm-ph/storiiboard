# Handoff

Written Nov 5, 2026, at a pause, so the work can go on from a cloud session that has only GitHub. Read `CLAUDE.md`
first (the working rules), then `docs/PLAN.md` (scope, phases, status), then this file. It replaces nothing in
either; it says where the work stands and what comes next.

## What a cloud session can and can't do

- **Can:** read and change the code; run `npm run lint`, `npm test` (Vitest) and the Chromium end-to-end tests on
  Linux; open, review and merge pull requests; push checkpoint branches.
- **Can't:** run the desktop app; test the GPU encoders (Media Foundation on Windows, VideoToolbox on a Mac); build or
  try the installers; run anything on a Mac or on Windows. Those come from CI:
  - every pull request runs the quick checks on Linux (lint, types, unit tests, Rust tests with the ffmpeg sidecar);
  - a push to `checkpoint/<name>` runs the smoke and screenshot tests on Linux and on the Mac, builds both installers,
    and runs the Rust tests on the Mac and on Windows (so the real encoders run there);
  - a push to `checkpoint/baselines-<name>` regenerates the Linux and Mac screenshot baselines as artifacts.
- The Rust tests need the ffmpeg sidecars in `src-tauri/binaries` (git ignores them). In a Linux session, build them
  with `scripts/ffmpeg/build.sh x86_64-unknown-linux-gnu src-tauri/binaries` (needs `nasm`; about 10 minutes), or
  leave the Rust tests to CI. See `scripts/ffmpeg/README.md`.
- The reviewer agent is committed (`.claude/agents/reviewer.md`): read-only, it reads a diff file and reports findings
  by severity. Write the diff (`git diff origin/v2...HEAD`) to a file it can read and point it there.

## Merged (Phase 2, into `v2`)

| PR | Milestone |
|---|---|
| #71 | 2.1: LGPL ffmpeg and ffprobe sidecars, built in CI from one pinned release; Rust reads a video's facts |
| #72 | 2.2a: schema 8 (video records, `clip`, `from_video`, `luts`); timecode maths; Rust stills and file status; the browser stand-in |
| #73 | 2.2b: link a video to a frame by drop or browse; the inspector's Video section; the missing flag and Relink |

Phase 0 and Phase 1 (with its polish) are merged too; `docs/PLAN.md` has every milestone and its PR. Phase 1's gate
(a real scene boarded in one sitting) is Kevin's to run.

## Open branches and pull requests

- **PR #74, `phase2/2.3a-playback-engine` (draft): 2.3a, the playback-copy engine** (`src-tauri/src/playback.rs`).
  - Head `5e27ef8`. Quick checks green on it. The checkpoint `checkpoint/playback-2.3a` on the same commit was still
    running at handoff; an earlier commit's checkpoint was green on all three platforms (the Mac's VideoToolbox path
    included).
  - Review round 1 (one high, seven medium) is fixed in `5e27ef8`. **Round 2 found four new mediums, not fixed yet**;
    fixing them is the first task (below). Don't merge before they're fixed and a review comes back with nothing high
    or medium.
- **PR #1, `claude/add-core-features-qkifh` (draft):** from before the v2 rebuild. Leave it alone; it's Kevin's to
  close.
- Every other branch on the remote is merged work, or a `checkpoint/*` branch (CI runs only). Nothing else is open.

### 2.3a: what the second review found (to fix)

1. **N1. The stall timer can kill ffmpeg during the final faststart rewrite.** `+faststart` rewrites the whole file
   after the last frame, and ffmpeg prints no progress meanwhile. On a slow drive a long take's copy (several GB) takes
   longer than the 90 s timer, so the copy fails at 100%, then again on each fallback attempt. Fix: count growth of
   the `.partial` (or its modified time) as progress, or allow time in proportion to the copy's size once the last
   frame is reached; or drop `+faststart` (a local file plays fine with the index at the end).
2. **N2. Any failed attempt leads to a soundless copy that's kept for good.** The no-sound attempt runs after any
   failure, not only one caused by the sound; `complete()` then doesn't ask for sound, and the copy is saved under the
   normal name. On a Mac (one encoder) a passing VideoToolbox error goes straight there. Fix: drop the sound only when
   the sound is the cause (test-decode a second of `0:a:0`, or read ffmpeg's errors); add that attempt only when the
   original has sound; name soundless copies differently so they're made again later and the app can say so.
3. **N3. Two makes of the same path share one job entry.** `HashMap::insert` replaces the first make's entry; Cancel
   then flags one make and kills the other's ffmpeg, and the first make's guard removes the entry the second still
   needs. Happens with React StrictMode in dev, two frames linking one video, or the queue and the Player both asking.
   Fix: a list of jobs per path (Cancel flags them all), or a second make waits for and reuses the one running.
4. **N4. `complete()` rejects good copies when the original's length is unknown or only estimated.** Length 0 (some
   WebM and MKV) fails every copy; a length estimated from the bitrate, a wrong MXF header or a MOV edit list can be
   more than 0.2% off. Fix: skip the length check when the length is unknown; detect a cut directly (capture ffmpeg's
   errors and fail on "Error during demuxing" or I/O errors); keep the length check as a backstop with wider slack
   (1%, or 1 s).

Lows from round 2, worth doing with them: `playback_cancel` is now a sync command (sync commands run on the main
thread, so it can freeze the window while it waits on the child lock): make it `#[tauri::command(async)]` and poll
`try_wait` instead of a locked `wait()`; a kill that doesn't take (I/O stuck on a dead share) can hold the turn for
good, so stop waiting after a grace period; the start-up clean-up still calls `is_dir` on the chosen root before its
thread, and can race a make started just after launch (take the turn in the clean-up thread); the `move_to` comment
overclaims for a move between two chosen drives; the key re-check after the encode can fail on network shares whose
modified times wobble; the stall timer has no test (make its duration injectable).

Deferred from round 1 (noted, not planned yet): progress and Cancel for a long Move; key stability across path
spellings and FAT32 or SMB time stamps; playing a copy while the original's drive is unplugged (the record could keep
size and time, for 2.4); the Player's open copy evicted by the cap, Clear or a move (2.4); FAT32 roots and copies over
4 GB; a root inside a synced folder (warn, using `synced.rs`); Forget when the remembered list couldn't be read; audio
stored as separate mono streams (only the first is kept).

## Next steps, in order

1. **Finish 2.3a** (PR #74): fix N1 to N4 and the lows above, add tests, run the reviewer until nothing high or medium
   is left, push a checkpoint for the Mac and Windows encoders, merge with a merge commit once the quick checks pass.
2. **D1: zimg and dav1d** (approved by Kevin, Nov 5), one PR:
   - Pin zimg **3.0.6** (`https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz`, SHA-256
     `be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577`; its only submodule is the test framework,
     not needed) and dav1d **1.5.4** (`https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz`,
     SHA-256 `686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5`, which matches VideoLAN's own).
     Both are more than two weeks old.
   - Build both statically in `scripts/ffmpeg/build.sh` (zimg with autotools; dav1d with meson and ninja) and configure
     ffmpeg with `--enable-libzimg --enable-libdav1d`. Add the build tools to `.github/actions/ffmpeg/action.yml`
     (apt on Linux, Homebrew on the Mac, MSYS2 packages on Windows). The self-checks add: `zscale` among the filters,
     `libdav1d` among the decoders, and still LGPL 2.1 with no GPL, nonfree or version3 flag.
   - Ship their licences with the installers (zimg: WTFPL; dav1d: BSD-2-Clause) and record them in the source notice.
   - HDR: when a video is PQ or HLG, stills and playback copies go through `zscale` to linear light, `tonemap`, and
     back to BT.709, so they come out in normal range. FFmpeg's own `scale` filter doesn't do this (tested: it only
     re-tags the colours).
   - Tests: an HDR clip (make one with `setparams` tagging PQ and HLG) whose still and playback copy come out in normal
     range (a 203-nit reference white lands near SDR white, not mid-grey; the copy is tagged BT.709); an AV1 clip that
     makes a still and a playback copy. For AV1, check in the AOMedia conformance vector
     `av1-1-b8-01-size-226x226.ivf` (1 KB, BSD-2-Clause, from `https://storage.googleapis.com/aom-test-data/`), with a
     note on where it came from. Its `.md5` file lists the MD5 of each decoded frame, so the test can prove the decode
     is exact (frame 1: `68fd0575b5211242727c2bc77c27453d`); remux it to MP4 at test time.
   - Add a "Dependencies and licences" section to `docs/PLAN.md`: FFmpeg (LGPL 2.1, run as separate programs), zimg
     (WTFPL, **approved by Kevin as an exception to the licence list**), dav1d (BSD-2-Clause), windows-sys (MIT or
     Apache 2.0), plus the npm packages already approved (pdf-lib and @pdf-lib/fontkit, MIT).
3. **D2: windows-sys** (approved by Kevin, Nov 5): add `windows-sys` as a direct dependency, pinned to **0.61.2**, the
   version Tauri's own tree already uses (Windows only).
   - A free-space floor: playback copies never leave less than **10 GB** free on their drive; adjustable in
     Settings → Storage (2.3b shows it). Check before each copy and evict to keep it; refuse with a clear message when
     it can't be met. (On a Mac, `libc`'s `statvfs` is already available.)
   - On Windows, a Job Object with kill-on-close, so ffmpeg stops even when the app crashes (today copies stop when
     the app quits normally).
4. **2.3b**: playback copies, what you see: the queue (one `make` at a time from the page, or the queue moved into
   Rust, since each waiting `make` holds a blocking thread), the copy's state in the inspector, Settings → Storage
   (copies, size, cap, the free-space floor, Move, Clear, remembered videos and Forget), and ffmpeg's licence (with
   zimg's and dav1d's).
5. **2.4**: the Player tile plays real footage (frame stepping, timecode, in and out, scrubbing), through Tauri's asset
   protocol scoped to the copies' folder. **Review stop A** after it: run a checkpoint, write the checklist into the
   handoff, and keep going (Kevin tests in batches).
6. **2.5** LUTs (a `.cube` per video, applied to playback copies and stills, never the original; the LUT joins the
   copy's key); **2.6** crop over the Player; **2.7** still capture into a frame (from the original, LUT and crop
   applied, `from_video` recorded); **2.8** clip capture (in and out, plays in the inspector; Save clip as file);
   **2.9** JSON export and import, lossless.
7. **Phase 2 gate**: a checkpoint (smoke and screenshots on Linux and the Mac, both installers) and a checklist. The
   gate: a still from a reference clip lands in a frame in a few clicks, on Kevin's own footage. Don't wait; Phase 3
   follows.
8. **Phase 3** (production data), after the gate checkpoint passes: first write a Phase 3 plan and a one-page decision
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

- **Pending for Kevin:** none at handoff. zimg, dav1d and windows-sys were approved on Nov 5 (above).
- **Decided by default, for Kevin's review** (easy to undo):
  - 2.2 and 2.3 were each split in two PRs, to keep reviews short.
  - A video record sits under the project, not a frame, so two frames can play parts of one video; a frame's picture
    is the video's frame 0 (the in point); a still picture replacing it ends the frame's clip; a video this computer
    can't read counts as missing.
  - Videos linked before are remembered on each computer (Rust keeps the list); a project's own folder is trusted for
    videos inside it; anything else waits for Relink. Relink asks when the rate, length, name, size or start timecode
    differs.
  - The sidebar's phase labels changed in 2.2b instead of 2.4, so the screenshots regenerated once.
  - Playback copies: named by the original's path, size and modified time; a keyframe every 12 frames; AAC stereo at
    160 kb/s; 12 Mb/s H.264; the 50 GB cap removes the copies used longest ago.
- **Known lows, deferred:** a Trash restore of a video still doesn't bring back its clip (undo of Remove does); after a
  project switch, a first missing-file check that times out leaves the flags off until the next focus; bit depth falls
  to 8 for a few packed pixel formats when the decoder doesn't say; the timecode track's own rate (59.94p with 29.97
  timecode) isn't read.

## Not in the repo

`REPORT.local.md` and the Phase 2 plan's working copy stay on Kevin's PC; everything a session needs from them is
above or in `docs/PLAN.md`. The permission rules file (`.claude/settings.local.json`) is local to that PC too.
