# ffmpeg and ffprobe sidecars

Storiiboard reads, plays and grabs video through ffmpeg and ffprobe, running as separate programs (Tauri sidecars),
never linked into the app. `build.sh` builds them from one pinned FFmpeg release, **LGPL only**: no `--enable-gpl`, no
GPL or non-free libraries (so no x264 or x265), nothing picked up from the build machine (`--disable-autodetect`). H.264
comes from each computer's own encoder: VideoToolbox on a Mac, Media Foundation on Windows. The build checks itself:
it fails unless ffmpeg reports the LGPL version 2.1, wasn't configured with `--enable-gpl`, `--enable-nonfree` or
`--enable-version3`, and has the `lut3d` filter (LUTs).

The installers ship `ffmpeg-LICENSE.txt` (the LGPL 2.1), `ffmpeg-LICENSE.md` (FFmpeg's notes on its licences) and
`ffmpeg-SOURCE.txt` (the exact source and its checksum, the Storiiboard commit, the compiler and the configure line;
on Windows also the notices for the statically linked zlib and winpthreads), as the licence asks. The source tarball
itself, `ffmpeg-<version>.tar.xz`, sits beside the binaries in every CI artifact: whoever hands out an installer hands
out the source from the same place, and the Phase 8 release attaches it to each release.

The app starts the tools without a console window on Windows, with their input closed. A release build looks for
them only beside its own executable.

## Getting them on a developer's computer

Tauri's build needs them in `src-tauri/binaries` (git ignores the folder), named with the target triple:
`ffmpeg-aarch64-apple-darwin`, `ffprobe-x86_64-pc-windows-msvc.exe` and so on. Either:

- **Download the CI's build** from the latest checkpoint run (kept 7 days):
  `gh run download <run id> -n ffmpeg-aarch64-apple-darwin -D src-tauri/binaries` (or `ffmpeg-x86_64-pc-windows-msvc`).
  On a Mac, make them runnable again afterwards (artifacts don't keep the permission):
  `chmod +x src-tauri/binaries/ffmpeg-* src-tauri/binaries/ffprobe-*`.
- **Build them:** on a Mac or Linux, `scripts/ffmpeg/build.sh aarch64-apple-darwin src-tauri/binaries` (Xcode's
  command-line tools are enough on Apple silicon; Linux needs `nasm`). On Windows, in MSYS2's MINGW64 shell with
  `make diffutils tar xz curl mingw-w64-x86_64-gcc mingw-w64-x86_64-nasm mingw-w64-x86_64-pkgconf mingw-w64-x86_64-zlib`.

To move to a newer FFmpeg: change `VERSION` and `SHA256` in `build.sh` (a release at least two weeks old); CI rebuilds
on the next run, since its cache is keyed by the script and the action (`.github/actions/ffmpeg`). The cache is saved
as soon as a build succeeds, even if a later step fails. A cache is seen only by the branch that made it (and main), so
the Linux build CI makes on v2 serves every pull request into it, while each new `checkpoint/<name>` branch builds the Mac and
Windows sidecars once (about 10 and 25 minutes).
