# ffmpeg and ffprobe sidecars

Storiiboard reads, plays and grabs video through ffmpeg and ffprobe, running as separate programs (Tauri sidecars),
never linked into the app. `build.sh` builds them from one pinned FFmpeg release, **LGPL only**: no `--enable-gpl`, no
GPL or non-free libraries (so no x264 or x265), nothing picked up from the build machine (`--disable-autodetect`). H.264
comes from each computer's own encoder: VideoToolbox on a Mac, Media Foundation on Windows. The build checks itself:
it fails unless ffmpeg reports the LGPL, wasn't configured with `--enable-gpl`, and has the `lut3d` filter (LUTs).

The installers ship `ffmpeg-LICENSE.txt` (the LGPL 2.1) and `ffmpeg-SOURCE.txt` (the exact source, its checksum and
the configure line), as the licence asks.

## Getting them on a developer's computer

Tauri's build needs them in `src-tauri/binaries` (git ignores the folder), named with the target triple:
`ffmpeg-aarch64-apple-darwin`, `ffprobe-x86_64-pc-windows-msvc.exe` and so on. Either:

- **Download the CI's build** from the latest checkpoint run (kept 7 days):
  `gh run download <run id> -n ffmpeg-aarch64-apple-darwin -D src-tauri/binaries` (or `ffmpeg-x86_64-pc-windows-msvc`).
- **Build them:** on a Mac or Linux, `scripts/ffmpeg/build.sh aarch64-apple-darwin src-tauri/binaries` (Xcode's
  command-line tools are enough on Apple silicon; Linux needs `nasm`). On Windows, in MSYS2's MINGW64 shell with
  `make diffutils tar xz curl mingw-w64-x86_64-gcc mingw-w64-x86_64-nasm mingw-w64-x86_64-pkgconf mingw-w64-x86_64-zlib`.

To move to a newer FFmpeg: change `VERSION` and `SHA256` in `build.sh` (a release at least two weeks old); CI rebuilds
on the next run, since its cache is keyed by the script.
