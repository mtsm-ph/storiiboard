# HEIC pictures on Windows: plan (for Kevin) and brief (for the builder), Nov 19

Status: approved by Kevin (Nov 19 and 20) and being built in parts; the briefs beside this file say what each part
builds (`heic-rust.md` first). Where a brief and this plan differ, the brief is the newer one. What was read from
Kevin's own photos is left out of this copy.

## What Kevin asked (Nov 19)

- Keep the photo's colour; no sRGB conversion. Decode, then mark the PNG Display P3 with a cICP chunk, and let the
  webview's colour management and the P3 canvas do the rest. Windows stores the same picture the Mac does.
- Prove it with a test picture whose colours lie outside sRGB: they come out unclipped.
- Scale in ffmpeg to 2560 on the long edge, so the page never gets a 48 MP PNG. Measure time and memory at 12 and
  48 MP before fixing the time limit.
- A HEIC that isn't P3: read what the file says and mark that. One that says nothing is sRGB.
- Say what happens with an HDR HEIF from a Sony or Canon camera.

## What was known before the plan

- The bundled ffmpeg 8.1.3 decodes a HEIC whole (it assembles the tile grid) and upright (it applies the recorded
  turn). The PNG it writes carries no EXIF or text, and is **untagged**, so a webview would show it as sRGB.
- ffprobe (bundled beside ffmpeg, `externalBin`) reads the file's colour tag.
- With a grid, ffmpeg builds its own filter graph: `-vf` is refused and zscale fails inside `-filter_complex
  [0:g:0]`. swscale's `scale` inside `-filter_complex` hasn't been tried yet (step 0 below).
- The page (src/core/media/image.ts) already draws every picture into a Display P3 canvas and stores it with the
  P3 profile, where the webview keeps P3. So a correctly tagged PNG needs nothing new in the page beyond the call.

## The plan

1. **Step 0, probes before any build** (the main session; yes/no and numbers only):
   - On real HEICs, read in place: does `-filter_complex "[0:g:0]scale=…:flags=lanczos"` (swscale, not zscale) give a
     picture of the right size and colour? If not, the fallback is two ffmpeg runs joined by a pipe (grid decode to
     raw RGB, then scale and write the PNG), so no full-size picture touches the disk.
   - Does the WebView2 engine honour a PNG's cICP chunk? Tested in Playwright Chromium with a script-made PNG: the
     same pixels tagged P3 and tagged sRGB must read differently in a P3 canvas. If cICP isn't honoured, the fallback
     is an iCCP chunk carrying a Display P3 profile our own script writes (as scripts/fixturePhotos.ts writes its
     sRGB one), never a profile copied from the file.
2. **Rust, src-tauri/src/heic.rs, one command `heic_picture`** (raw bytes in, PNG bytes out, like `photo_exif`):
   - Refuses anything over a size cap (proposed 64 MiB) and anything `exif.rs`'s `is_heif` doesn't call a HEIF
     (AVIF stays out).
   - Writes the bytes to a temp file under a random name of our own in the app's cache folder (the HEIF reader needs
     to seek). The file is deleted on every outcome, error and timeout included.
   - Runs ffprobe for size, tile grid, bit depth and colour tag (primaries, transfer, matrix, range); its output is
     read up to a cap. Then ffmpeg decodes, applying the turn, the file's own YUV matrix and range, with no
     colour-space conversion, and scales to fit 2560 on the long edge (never up).
   - Keeps only IHDR, IDAT and IEND from ffmpeg's PNG and puts one cICP chunk after IHDR. cICP is 4 bytes
     (primaries, transfer, matrix 0, full range 1) plus its CRC; the CRC-32 table is written by hand (about 15 lines,
     no new crate).
   - Which tag: the file's primaries and transfer as ffprobe reports them, for the SDR ones the webview honours
     (step 0 lists them). Display P3 is 12/13. A file that says nothing, or says "unspecified", is sRGB (1/13). PQ or
     HLG: see question 2.
   - A time limit (set from step 3's numbers) and a kill, as playback.rs does. Words for each refusal (too big, not a
     HEIC, an HDR photo if question 2 says so, took too long, couldn't be read), in en and es.
3. **Timing, on GitHub's machines, never this PC's heavy runs.** A step on the Mac runner makes 12 MP (4032 × 3024)
   and 48 MP (8064 × 6048) HEICs with `sips` from a script-drawn P3 picture (seeded, like fixturePhotos.ts). A step
   on the Windows runner times `heic_picture`'s two ffmpeg runs on them: 5 runs each, wall time and peak working
   set. The limit is proposed as the larger of 10 s
   and 4× the slowest 48 MP run, and set only after Kevin sees the numbers.
4. **The page**: in `prepareImage`, when the webview can't decode a file that looks like a HEIC (type, name, or the
   HEIF brand in its first bytes) and the app runs in Tauri, it calls `heic_picture`. It then decodes the PNG it
   gets back and goes on exactly as for any picture: the P3 canvas, cleaning in `canvasBlob`, the hash after the
   clean, the 640 px thumbnail. tauriContract.test covers the new command. The Mac changes nothing, because WebKit
   reads HEIC itself. The HEIC date-and-place line stays: that's the separate Phase 8 item.
5. **The proof** (Kevin: colours outside sRGB come out unclipped, and Windows stores what the Mac stores):
   - One seeded drawing with patches of P3 pure red, green and blue (outside sRGB), an sRGB-inside colour, a mid grey
     and a gradient. A small HEIC of it (1024 × 768, made by `sips` on the Mac runner) is committed to
     src-tauri/testdata with its README and hash, beside the PNG `heic_picture` makes from it.
   - Rust: `heic_picture` on it gives the fitted size, exactly the chunks IHDR, cICP, IDAT…, IEND, a cICP of
     12/13/0/1, and the patches' code values as in the drawing (within 3 levels).
   - Chromium (Playwright): that PNG imported as a frame's picture is stored tagged P3. Read back in a P3 canvas, the
     red patch is about (255, 0, 0). Clipped to sRGB it would read about (234, 51, 35). Control: the same pixels
     tagged sRGB read about (234, 51, 35), which proves the tag is what keeps the colour.
   - WebKit on the Mac: the HEIC itself imported directly reads the same patches within 3 levels of the Chromium
     path.
   - Every check prints numbers from our own drawing only. Kevin's photos never enter a test.
6. **Alpha test by hand** (docs/ALPHA_TEST.md): one of Kevin's iPhone HEICs imported on Windows and on the Mac looks
   the same side by side.

## Questions for Kevin

1. **A HEIC tagged with an ICC profile that isn't P3 or sRGB** (Adobe RGB from a camera, say). cICP can't name an
   arbitrary profile. Recommended: carry the file's profile as the PNG's iCCP chunk, at most 64 KiB, as the clean
   already allows one in a JPEG. The page's decoder converts it into the P3 canvas, as it does for an Adobe RGB JPEG
   today. The alternatives are reading it as sRGB (wrong colour) or refusing it. Step 0 also checks whether ffmpeg
   hands that profile over at all.
2. **HDR HEIF (PQ or HLG).** Recommended for the alpha: refuse on Windows with a line ("This is an HDR photo, which
   Storiiboard can't read on this computer yet. Export it as a JPEG first."), until one real file has been tried.
   The alternative is tone-mapping to SDR P3 in ffmpeg (zscale and tonemap). It would not match the Mac's own
   tone-mapping, which goes against "Windows stores what the Mac stores".
3. **The fixture and timing steps touch CI** (the Mac runner makes HEICs with `sips`; the Windows runner times
   them). They would go in checkpoint.yml's Mac and Windows jobs. A one-off workflow run by hand is the alternative.

## An HDR HEIF from a Sony or Canon: what happens (not tried: there is no such file here)

- **Today:** on Windows it's refused with the HEIC line. On the Mac, WebKit decodes it through the OS and draws it
  into the SDR P3 canvas, tone-mapped by the OS's curve. That's never been checked.
- **What the files say, from what I know, to confirm with a real file:** Canon's HIF is 10-bit 4:2:2 HEVC with
  BT.2020 primaries and the PQ transfer. Sony's HEIF is 10-bit, HLG with BT.2020 when HLG stills are on, otherwise
  SDR.
- **In this plan's path:** ffprobe reports PQ (`smpte2084`) or HLG (`arib-std-b67`). ffmpeg's HEVC decoder reads
  10-bit 4:2:2. A cICP-tagged 16-bit PNG would be an HDR picture, and what the webview's SDR P3 canvas does with it
  (tone-map or clip) isn't known and wouldn't match the Mac. Hence question 2.
- **A Sony 10-bit SDR HEIF** (BT.709) would work in this plan: a 16-bit PNG tagged 1/1 or 1/13 as the file says.
- To settle it: one HDR HEIF from a crew camera, read in place with yes/no and numbers only, like Kevin's samples.
- **iPhone HEICs' own HDR (the gain map):** ffmpeg decodes the main SDR picture. The Mac's canvas draws the SDR
  picture too, as far as I know. The by-hand alpha comparison (item 6) is what checks it.

## Brief for the builder (once Kevin approves; the questions' answers go in first)

Work in the repo folder, on the branch the main session names. Read CLAUDE.md first, then this plan, then
src/core/media/image.ts, src-tauri/src/exif.rs (`is_heif`), src-tauri/src/playback.rs (how the sidecar is run, timed
out and killed), src-tauri/src/command_tests.rs (`photo_exif`'s raw call) and src/app/tauriContract.test.ts. Never
commit, push or merge. Use Edit and Write for every change. Logs and probes go in test-results/.

- Build steps 2, 4 and 5 above, with step 0's results and the time limit the main session gives.
- No new dependency (CRC-32 by hand), no schema change, no screenshot change (stop and report if one would change),
  no CI change (the main session adds steps 3 and 5's runner steps), nothing in .claude, CLAUDE.md, PLAN.md or
  HANDOFF.md.
- Tests: Rust for every refusal (size, brand, timeout with a stand-in that sleeps, temp file gone after each), the
  chunk rewrite (only IHDR, cICP, IDAT, IEND; CRC right; a PNG with iCCP, tEXt or eXIf from ffmpeg comes out
  without them) and the fixture run. Vitest for the page's fallback (called only for a HEIC the webview refused, and
  never on the Mac's path) and the new words in en and es. Playwright Chromium for the P3 patch check and its sRGB
  control. WebKit for the HEIC import on the Mac (that spec runs on GitHub's Mac).
- Existing tests: never weaken, skip or delete one.
- Checks: `npm run lint`, `npx tsc --noEmit`, `npm run test:rust`, `npm run lint:rust`, Vitest on every touched
  file and its neighbours (from `C:\` upper case), the touched e2e specs in Chromium alone, then `npm run
  failed-tests`. Paste counts.

## Step 0 and the timing: results (Nov 19, evening; run 44666161464 on measure/heic)

- Probe A (swscale `scale` inside `-filter_complex "[0:g:0]…"`): **yes**, on all three sips HEICs (tile grids of
  512 × 512, and 896 × 1024 at 48 MP). The piped fallback isn't needed.
- Probe B (Chromium 156, display-p3 canvas, flat 255/0/0): cICP 12/13/0/1 reads (255, 0, 0); cICP 1/13/0/1 reads
  (234, 51, 35); our own P3 iCCP reads (255, 0, 0); untagged reads (234, 51, 35). **cICP honoured: yes. iCCP works:
  yes.**
- The proof picture through decode and scale on Windows: every patch within 2 code values of the drawing (P3 red
  254/0/0, green 1/253/1, blue 0/0/254; grey and gradient exact). Nothing clipped.
- **New: sips-made HEICs say their colour by an ICC profile only** (2636 bytes; `color_primaries` null, matrix
  smpte170m, full range), while the iPhone's says it by nclx (smpte432). So the tag rule is: an ICC profile in the
  file → carried as the PNG's iCCP (at most 64 KiB, else refused with words: Kevin's answer 1); else nclx → cICP;
  else sRGB. With both, the ICC (the fuller description). ffmpeg hands the profile over as frame side data.
- Timing, Windows runner (AMD EPYC 9V74, 2 cores / 4 threads, 16 GB), 5 runs each:
  - 12 MP: ffprobe 36 / 38 / 40 ms; decode and scale 1543 / 1549 / 1587 ms; peak 92 / 122 / 127 MB.
  - 48 MP: ffprobe 41 / 44 / 50 ms; decode and scale 1804 / 1817 / 2189 ms; peak 230 / 270 / 301 MB.
  - The limit by the plan's rule: the larger of 10 s and 4 × the slowest 48 MP run (8.8 s) → **10 s**.

## Nov 20: where the profile comes from (probed on the fixtures with the app's own ffmpeg)

- The tile grid's PNG, as the decode above makes it, carries **no** colour profile: its chunks are IHDR, pHYs, IDAT,
  IEND. The profile is side data of each tile, and the grid's filter graph doesn't pass it on.
- A PNG of the picture's first stream alone (`-map 0:v:0 -frames:v 1 -vf scale=16:16 -c:v png`) carries it whole, as
  an iCCP chunk (2,636 bytes once inflated, on both the proof and the 12 MP fixture).
- So a file with a profile takes a second, tiny ffmpeg run, and that run's iCCP chunk goes into the answer.
- Approved by Kevin on Nov 20: the numbers, the 10 s limit, and the tag rule (a profile is carried, at most 64 KiB,
  else the photo is refused; else the four-number tag becomes cICP; else sRGB). New that day: at most two photos
  decode at a time, the status line counts them ("Reading 3 of 30"), and an HDR HEIF is refused on Windows with a
  line.
