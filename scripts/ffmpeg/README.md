# ffmpeg and ffprobe sidecars

Storiiboard reads, plays and grabs video through ffmpeg and ffprobe, running as separate programs (Tauri sidecars),
never linked into the app. `build.sh` builds them from one pinned FFmpeg release, **LGPL only**: no `--enable-gpl`, no
GPL or non-free libraries (so no x264 or x265), nothing picked up from the build machine (`--disable-autodetect`). H.264
comes from each computer's own encoder: VideoToolbox on a Mac, Media Foundation on Windows. Two libraries are built in,
statically, each from a pinned release with its checksum (D1, approved by Kevin on Nov 5): **zimg** (WTFPL), whose
`zscale` filter takes HDR (PQ, HLG) to linear light for tone-mapping and back to BT.709, and **dav1d** (BSD-2-Clause),
which decodes AV1. The build checks itself: it fails unless ffmpeg reports the LGPL version 2.1, wasn't configured with
`--enable-gpl`, `--enable-nonfree` or `--enable-version3`, and has the `lut3d` filter (LUTs), `zscale` and the
`libdav1d` decoder.

The installers ship `ffmpeg-LICENSE.txt` (the LGPL 2.1), `ffmpeg-LICENSE.md` (FFmpeg's notes on its licences),
`zimg-LICENSE.txt`, `dav1d-LICENSE.txt` and `ffmpeg-SOURCE.txt` (the exact sources and their checksums, the Storiiboard
commit, the compiler and the configure line; on x86 also x86inc.asm's ISC notice, whose assembly is in both FFmpeg and
dav1d; on Windows also the MSYS2 packages linked in statically, for zlib, GCC's C++ runtime and MinGW-w64's runtime and
winpthreads, with the last two's notices), as the licences ask. The source tarballs themselves (`ffmpeg-<version>.tar.xz`,
`zimg-<version>.tar.gz`, `dav1d-<version>.tar.xz`) sit beside the binaries in every CI artifact: whoever hands out an
installer hands out the source from the same place, and the Phase 8 release attaches them to each release.

The app starts the tools without a console window on Windows, with their input closed. A release build looks for
them only beside its own executable.

## Getting them on a developer's computer

Tauri's build needs them in `src-tauri/binaries` (git ignores the folder), named with the target triple:
`ffmpeg-aarch64-apple-darwin`, `ffprobe-x86_64-pc-windows-msvc.exe` and so on. Either:

- **Download the CI's build** from the latest checkpoint run (kept 7 days):
  `gh run download <run id> -n ffmpeg-aarch64-apple-darwin -D src-tauri/binaries` (or `ffmpeg-x86_64-pc-windows-msvc`).
  On a Mac, make them runnable again afterwards (artifacts don't keep the permission):
  `chmod +x src-tauri/binaries/ffmpeg-* src-tauri/binaries/ffprobe-*`.
- **Build them:** on a Mac or Linux, `scripts/ffmpeg/build.sh aarch64-apple-darwin src-tauri/binaries`. A Mac needs
  Xcode's command-line tools and `brew install autoconf automake libtool meson ninja pkgconf`; Linux needs `nasm meson
  ninja-build autoconf automake libtool pkg-config` and a C++ compiler. On Windows, in MSYS2's MINGW64 shell with `make diffutils
  tar xz curl autoconf automake libtool mingw-w64-x86_64-gcc mingw-w64-x86_64-nasm mingw-w64-x86_64-pkgconf
  mingw-w64-x86_64-zlib mingw-w64-x86_64-meson mingw-w64-x86_64-ninja`. With no way to the download sites (a cloud
  session's network, say), put the three tarballs, named as `build.sh` names them, in a folder and set
  `SBD_FFMPEG_SOURCES` to it: each is still checked against its checksum. zimg's is GitHub's archive of its release tag,
  which `git archive --format=tar --prefix=zimg-release-3.0.6/ release-3.0.6 | gzip -n` reproduces from a clone.

To move to a newer FFmpeg (or zimg, or dav1d): change its version and checksum in `build.sh` (a release at least two
weeks old); CI rebuilds
on the next run, since its cache is keyed by the script and the action (`.github/actions/ffmpeg`). The cache is saved
as soon as a build succeeds, even if a later step fails. A cache is seen only by the branch that made it (and main), so
the Linux build CI makes on v2 serves every pull request into it, while each new `checkpoint/<name>` branch builds the Mac and
Windows sidecars once (about 10 and 25 minutes).
