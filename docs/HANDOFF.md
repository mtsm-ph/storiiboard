# Handoff

Written Nov 5, 2026, at a pause, so the work can go on from a cloud session that has only GitHub; updated Nov 6 after
2.3a merged. Read `CLAUDE.md` first (the working rules), then `docs/PLAN.md` (scope, phases, status), then this file.
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

## Merged (Phase 2, into `v2`)

| PR | Milestone |
|---|---|
| #71 | 2.1: LGPL ffmpeg and ffprobe sidecars, built in CI from one pinned release; Rust reads a video's facts |
| #72 | 2.2a: schema 8 (video records, `clip`, `from_video`, `luts`); timecode maths; Rust stills and file status; the browser stand-in |
| #73 | 2.2b: link a video to a frame by drop or browse; the inspector's Video section; the missing flag and Relink |
| #74 | 2.3a: the playback-copy engine (`src-tauri/src/playback.rs`); see "2.3a as built" in `docs/PLAN.md` |

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

For Kevin, at review stop A (2.4) or sooner, on his own computers:
- Windows with a GPU: a copy made by the **hardware** Media Foundation encoder (NV12, High profile). CI has no GPU, so
  that path has never run; if it fails, the software encoder makes the copy anyway, more slowly.
- A Mac: a long take on an external drive; pull the drive midway (the copy should fail and leave nothing).

Lows deferred from the 2.3a reviews (noted, not planned yet):
- On a Mac or Linux, a crash or Force Quit leaves ffmpeg running to the end of its copy (writing into a deleted partial).
  D2's Job Object covers Windows only; for the Mac, record each ffmpeg's PID and have the start-up clean-up stop any
  still running (check it's still the sidecar first), with D2.
- A root shared by two computers (a NAS folder picked on both): each one's start-up clean-up and Move delete the other's
  half copies, and request ids start at 0 in every run, so partial names can collide. Fix: a per-machine token in partial
  names (`lock::Machine`'s id), and delete only this machine's partials, or others' only when old.
- A Clear (or the cap) running just as a make finishes can delete the copy that make returns; 2.4 must handle a copy
  going missing under the Player anyway (below).
- The "can't be set aside" branch of the settings load has no test (it needs a folder the test can't write; root ignores
  permissions, so skip when root).
- Audio stored as separate mono tracks keeps only the first (Canon and Sony MXF, recorders' MOVs): the copy has only
  CH1. Mix the mono tracks (`amerge`) or pick the first one that decodes: a product call for Kevin.

Deferred from round 1 (still open): progress and Cancel for a long Move; key stability across path spellings; playing a
copy while the original's drive is unplugged (the record could keep size and time, for 2.4); the Player's open copy
evicted by the cap, Clear or a move (2.4); FAT32 roots and copies over 4 GB; a root inside a synced folder (warn, using
`synced.rs`); Forget when the remembered list couldn't be read.

## Next steps, in order

1. **D1: zimg and dav1d** (approved by Kevin, Nov 5), one PR. Groundwork done in this session (in a scratch folder, not
   committed), so the PR is mostly writing it in:
   - Pin zimg **3.0.6** (`https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz`, SHA-256
     `be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577`; its only submodule is the test framework,
     not needed) and dav1d **1.5.4** (`https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz`,
     SHA-256 `686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5`, which matches VideoLAN's own).
     Both are more than two weeks old.
   - Build both statically in `scripts/ffmpeg/build.sh` (zimg with autotools; dav1d with meson and ninja) and configure
     ffmpeg with `--enable-libzimg --enable-libdav1d`. **Tested on Linux:** a static zimg needs
     `STL_LIBS="-lstdc++ -lm"` (`-lc++ -lm` on a Mac) at its configure, or FFmpeg's configure says "zimg not found"
     (the maths library is missing from its pkg-config file); dav1d with
     `meson setup build --default-library=static --buildtype=release -Denable_tools=false -Denable_tests=false
     -Denable_examples=false -Denable_docs=false`. An `SBD_FFMPEG_SOURCES` folder of pre-downloaded tarballs (still
     checksummed) let the build run here. With both in, `libdav1d` is listed before the native `av1` decoder, so it's
     used by default.
   - Add the build tools to `.github/actions/ffmpeg/action.yml` (apt `meson ninja-build autoconf automake libtool` on
     Linux, Homebrew on the Mac, MSYS2 `autoconf automake libtool mingw-w64-x86_64-meson mingw-w64-x86_64-ninja` on
     Windows). The self-checks add: `zscale` among the filters, `libdav1d` among the decoders, and still LGPL 2.1 with no
     GPL, nonfree or version3 flag.
   - Ship their licences with the installers (zimg: WTFPL, `COPYING`; dav1d: BSD-2-Clause, `COPYING`) through
     `tauri.conf.json`'s resources, record them in `ffmpeg-SOURCE.txt`, and keep their source tarballs beside
     FFmpeg's in the CI artifact. On Windows the notice also names GCC's C++ runtime (GPL 3 with the runtime library
     exception), linked statically for zimg.
   - HDR: when a video is PQ or HLG, stills and playback copies go through
     `zscale=tin=<t>:pin=<p>:min=<m>:rin=<r>:t=linear:npl=100:p=<p>:m=<m>,format=gbrpf32le,zscale=p=bt709,
     tonemap=tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv`, after the scale to 1920 px. The input tags come from
     ffprobe (extend `starts()` to read the stream's `color_transfer`, `color_primaries`, `color_space`, `color_range`,
     so a still needs no second ffprobe); a missing one is filled with BT.2020, bt2020nc and limited range (zscale
     fails with "no path between colorspaces" otherwise; tested). **Measured:** 203-nit reference white comes out at
     236/255 in a still (PQ and HLG alike) and Y 218 in a copy; untouched PQ is 146 (mid-grey). `hable` would give
     about 161, so it's `mobius`. Highlights roll off to white at 1000 nits (the peak assumed without metadata). Tag the
     copy BT.709 (`-color_primaries bt709 -color_trc bt709 -colorspace bt709`). Bump `RECIPE` in `playback.rs`.
   - Tests: PQ and HLG clips at reference white (ProRes 4:2:2 10-bit in MOV, `geq=lum=572` for PQ and 721 for HLG,
     tagged with `-color_trc smpte2084` / `arib-std-b67`, BT.2020) whose still and copy come out near SDR white, a
     PQ clip with only its transfer tagged, and the copy tagged BT.709; for AV1, check in
     `av1-1-b8-01-size-226x226.ivf` (1079 bytes, BSD-2-Clause, from `https://storage.googleapis.com/aom-test-data/`,
     with a note on where it came from) under a new `src-tauri/testdata/`, remux it to MP4 at test time, and check
     `ffmpeg -f framemd5` against its `.md5` file (frame 1 `68fd0575b5211242727c2bc77c27453d`, frame 2
     `448d6b4cb8379eaee950670af0f5ab41`; **both match** with dav1d 1.5.4), then make a still and a playback copy.
   - Add a "Dependencies and licences" section to `docs/PLAN.md`: FFmpeg (LGPL 2.1, run as separate programs), zimg
     (WTFPL, **approved by Kevin as an exception to the licence list**), dav1d (BSD-2-Clause), windows-sys (MIT or
     Apache 2.0), plus the npm packages already approved (pdf-lib and @pdf-lib/fontkit, MIT).
2. **D2: windows-sys** (approved by Kevin, Nov 5): add `windows-sys` as a direct dependency, pinned to **0.61.2**, the
   version Tauri's own tree already uses (Windows only).
   - A free-space floor: playback copies never leave less than **10 GB** free on their drive; adjustable in
     Settings → Storage (2.3b shows it). Check before each copy (estimate: about 1.5 MB a second at 12 Mb/s) and evict
     to keep it; refuse with a clear message when it can't be met; watch it during the copy on a thread of its own (a
     dead share must never hold up the encode's watch loop). On a Mac, `libc`'s `statvfs` (already a direct
     dependency there). On Linux (tests only, `libc` isn't a direct dependency there) make the free-space reading a
     field the tests can set, and let the Mac and Windows CI runs check the real calls.
   - On Windows, a Job Object with kill-on-close, so ffmpeg stops even when the app crashes (today copies stop when the
     app quits normally). Assign every sidecar (`video::run_heard` and the encode) right after it starts.
   - The Mac crash item above, if it fits.
3. **2.3b**: playback copies, what you see: the queue (one `make` at a time from the page, or the queue moved into
   Rust, since each waiting `make` holds a blocking thread), the copy's state in the inspector (soundless copies say so:
   `MadeCopy.silent`), Settings → Storage (copies, size, cap, the free-space floor, Move, Clear, remembered videos and
   Forget), and ffmpeg's licence (with zimg's and dav1d's). The commands: `playback_make` (progress on a channel;
   returns `{ path, silent }`), `playback_find`, `playback_cancel`, `playback_info`, `playback_clear`,
   `playback_set_cap`, `playback_move`, `playback_move_back`, `known_videos_count`, `known_videos_forget`.
4. **2.4**: the Player tile plays real footage (frame stepping, timecode, in and out, scrubbing), through Tauri's asset
   protocol scoped to the copies' folder. Copies have their index at the end (no `+faststart`); if the Mac's webview
   stumbles on that over the asset protocol, add the index pass back with a time allowance for it and bump `RECIPE`.
   Handle a copy going missing under the Player (the cap, Clear, a Move). **Review stop A** after it: run a checkpoint,
   write the checklist into the handoff, and keep going (Kevin tests in batches).
5. **2.5** LUTs (a `.cube` per video, applied to playback copies and stills, never the original; the LUT joins the
   copy's key); **2.6** crop over the Player; **2.7** still capture into a frame (from the original, LUT and crop
   applied, `from_video` recorded); **2.8** clip capture (in and out, plays in the inspector; Save clip as file);
   **2.9** JSON export and import, lossless.
6. **Phase 2 gate**: a checkpoint (smoke and screenshots on Linux and the Mac, both installers) and a checklist. The
   gate: a still from a reference clip lands in a frame in a few clicks, on Kevin's own footage. Don't wait; Phase 3
   follows.
7. **Phase 3** (production data), after the gate checkpoint passes: first write a Phase 3 plan and a one-page decision
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

- **Pending for Kevin:** none that blocks the next milestone. One product call, when convenient: should a copy mix
  separate mono audio tracks (Canon and Sony MXF keep each channel on its own track), or keep only the first? Today: the
  first.
- **Decided by default, for Kevin's review** (easy to undo):
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
- **Known lows, deferred:** a Trash restore of a video still doesn't bring back its clip (undo of Remove does); after a
  project switch, a first missing-file check that times out leaves the flags off until the next focus; bit depth falls
  to 8 for a few packed pixel formats when the decoder doesn't say; the timecode track's own rate (59.94p with 29.97
  timecode) isn't read.

## Not in the repo

`REPORT.local.md` and the Phase 2 plan's working copy stay on Kevin's PC; everything a session needs from them is
above or in `docs/PLAN.md`. The permission rules file (`.claude/settings.local.json`) is local to that PC too.
