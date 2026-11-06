#!/usr/bin/env bash
# Builds ffmpeg and ffprobe for Storiiboard's sidecars (Phase 2.1): one pinned FFmpeg release, LGPL only (no --enable-gpl,
# no GPL or non-free libraries), static, with nothing picked up from the build machine by chance (--disable-autodetect):
# what's in is named below. Two libraries are built in from pinned releases too (D1, approved Nov 5): zimg, for HDR
# tone-mapping (the zscale filter), and dav1d, for AV1. Runs on Linux, macOS and Windows (in MSYS2's MINGW64 shell).
#
#   scripts/ffmpeg/build.sh <target-triple> <out-dir>
#
# Writes <out-dir>/ffmpeg-<triple>[.exe] and ffprobe-<triple>[.exe], the names Tauri's externalBin expects, plus
# ffmpeg-LICENSE.txt and ffmpeg-SOURCE.txt (the licence, and the exact source and configure line, as the LGPL asks), and
# zimg's and dav1d's licences. Set SBD_FFMPEG_SOURCES to a folder that already holds the source tarballs (named as below)
# to build without downloading them; each is still checked against its checksum.
set -euo pipefail

VERSION=8.1.3
SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
SOURCE_URL="https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz"
# zimg (WTFPL; approved by Kevin as an exception to the licence list): its only submodule is its test framework, which
# the build doesn't need. The tarball is GitHub's archive of the release tag.
ZIMG_VERSION=3.0.6
ZIMG_SHA256=be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577
ZIMG_URL="https://github.com/sekrit-twc/zimg/archive/refs/tags/release-${ZIMG_VERSION}.tar.gz"
# dav1d (BSD-2-Clause): the checksum is VideoLAN's own.
DAV1D_VERSION=1.5.4
DAV1D_SHA256=686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5
DAV1D_URL="https://downloads.videolan.org/pub/videolan/dav1d/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.xz"

triple=${1:?target triple, e.g. aarch64-apple-darwin}
out=${2:?output folder}
mkdir -p "$out"
out=$(cd "$out" && pwd)
here=$(cd "$(dirname "$0")" && pwd)

# FFmpeg's configure finds zimg and dav1d only through pkg-config: said now, not after both are built.
command -v pkg-config >/dev/null || { echo 'pkg-config is needed (zimg and dav1d are found through it)' >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Puts a source tarball at $work/<file>, from SBD_FFMPEG_SOURCES or downloaded, and checks it.
fetch() {
  local url=$1 sum=$2 file=$3
  if [ -n "${SBD_FFMPEG_SOURCES:-}" ] && [ -f "$SBD_FFMPEG_SOURCES/$file" ]; then
    cp "$SBD_FFMPEG_SOURCES/$file" "$work/$file"
  else
    # A reset connection is retried too (--retry alone skips it); the checksum below still decides.
    curl -fsSL --retry 6 --retry-all-errors --retry-delay 10 -o "$work/$file" "$url"
  fi
  local actual
  actual=$( (command -v sha256sum >/dev/null && sha256sum "$work/$file" || shasum -a 256 "$work/$file") | cut -d' ' -f1)
  if [ "$actual" != "$sum" ]; then
    echo "$file: checksum $actual, expected $sum" >&2
    exit 1
  fi
}
fetch "$SOURCE_URL" "$SHA256" "ffmpeg-${VERSION}.tar.xz"
fetch "$ZIMG_URL" "$ZIMG_SHA256" "zimg-${ZIMG_VERSION}.tar.gz"
fetch "$DAV1D_URL" "$DAV1D_SHA256" "dav1d-${DAV1D_VERSION}.tar.xz"
tar -xJf "$work/ffmpeg-${VERSION}.tar.xz" -C "$work"
tar -xzf "$work/zimg-${ZIMG_VERSION}.tar.gz" -C "$work"
tar -xJf "$work/dav1d-${DAV1D_VERSION}.tar.xz" -C "$work"
jobs=$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu || echo 4)

# The two libraries, static, into a prefix of the build's own, which ffmpeg's configure finds through pkg-config.
prefix="$work/prefix"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
# zimg is C++: a static zimg asks the linker for the C++ runtime (libc++ on a Mac, GCC's libstdc++ elsewhere) and, on
# Linux, the maths library, which its pkg-config file leaves out unless told.
zimg_libs="-lstdc++ -lm"
case "$triple" in
  *apple-darwin)
    export MACOSX_DEPLOYMENT_TARGET=13.0
    zimg_libs="-lc++ -lm"
    # Homebrew names GNU libtool's tools with a g, beside Apple's own libtool.
    if ! command -v libtoolize >/dev/null && command -v glibtoolize >/dev/null; then
      export LIBTOOLIZE=glibtoolize
    fi
    ;;
esac
(
  cd "$work/zimg-release-${ZIMG_VERSION}"
  ./autogen.sh
  ./configure --prefix="$prefix" --libdir="$prefix/lib" --disable-shared --enable-static STL_LIBS="$zimg_libs"
  make -j"$jobs"
  make install
)
(
  cd "$work/dav1d-${DAV1D_VERSION}"
  # Only the library: no command-line tools, tests or examples.
  meson setup build --prefix="$prefix" --libdir=lib --buildtype=release --default-library=static \
    -Denable_tools=false -Denable_tests=false -Denable_examples=false -Denable_docs=false
  ninja -C build install
)

cd "$work/ffmpeg-${VERSION}"

# What every platform gets. Decoders, demuxers, parsers and filters stay as FFmpeg ships them (all LGPL without
# --enable-gpl), so a camera file reads whatever it is; lut3d (LUTs), scale, tonemap and the rest come with them. zimg
# brings zscale, which takes HDR (PQ, HLG) to linear light for tonemap and back to BT.709; dav1d decodes AV1.
flags=(
  --disable-autodetect
  --disable-debug
  --disable-doc
  --disable-ffplay
  --disable-network
  --disable-shared
  --enable-static
  --enable-zlib
  --enable-libzimg
  --enable-libdav1d
  --pkg-config-flags=--static
)
exe=""
case "$triple" in
  *apple-darwin)
    # VideoToolbox: the hardware H.264 encoder (and decoders) on every Mac; AudioToolbox for AAC.
    flags+=(--enable-pthreads --enable-videotoolbox --enable-audiotoolbox --extra-ldflags=-mmacosx-version-min=13.0
      --extra-cflags=-mmacosx-version-min=13.0)
    ;;
  *windows*)
    # Media Foundation: the hardware H.264 encoder on Windows, with Microsoft's own software encoder where there's no
    # GPU. FFmpeg 8's Media Foundation encoder takes D3D11 frames, so D3D11VA comes with it (Windows' own headers;
    # it also decodes on the GPU). Linked statically, so the .exe needs no MinGW DLLs beside it.
    flags+=(--enable-w32threads --enable-d3d11va --enable-mediafoundation --extra-ldflags=-static)
    exe=".exe"
    ;;
  *linux*)
    # Linux runs the CI's tests only (no installer): decoding and the filters, no hardware encoder.
    flags+=(--enable-pthreads)
    ;;
  *)
    echo "unknown target $triple" >&2
    exit 1
    ;;
esac

./configure "${flags[@]}"
# The make targets carry the extension: ffmpeg.exe on Windows.
make -j"$jobs" "ffmpeg${exe}" "ffprobe${exe}"

# Checked, not trusted: an LGPL build, with the LUT filter, zimg's zscale and dav1d's decoder. Each output is read whole
# first: grep -q stopping early would end ffmpeg with SIGPIPE, which pipefail counts as a failure.
licence=$(./ffmpeg -hide_banner -L)
buildconf=$(./ffmpeg -hide_banner -buildconf)
filters=$(./ffmpeg -hide_banner -filters)
decoders=$(./ffmpeg -hide_banner -decoders)
about=$(./ffmpeg -version)
# The licence text wraps ("...GNU Lesser General Public" / "License..."), so only the words on one line; "version 2.1"
# tells it from the LGPL 3 that --enable-version3 would bring, which the shipped COPYING.LGPLv2.1 wouldn't cover.
grep -q 'GNU Lesser General Public' <<<"$licence" || { echo 'not an LGPL build' >&2; exit 1; }
grep -q 'version 2.1' <<<"$licence" || { echo 'not LGPL version 2.1' >&2; exit 1; }
if grep -qE -- '--enable-(gpl|nonfree|version3)' <<<"$buildconf"; then echo 'built with a GPL, nonfree or version3 flag' >&2; exit 1; fi
grep -qE '[[:space:]]lut3d[[:space:]]' <<<"$filters" || { echo 'lut3d missing' >&2; exit 1; }
grep -qE '[[:space:]]zscale[[:space:]]' <<<"$filters" || { echo 'zscale (zimg) missing' >&2; exit 1; }
grep -qE '[[:space:]]libdav1d[[:space:]]' <<<"$decoders" || { echo 'libdav1d missing' >&2; exit 1; }

cp "ffmpeg${exe}" "$out/ffmpeg-${triple}${exe}"
cp "ffprobe${exe}" "$out/ffprobe-${triple}${exe}"
cp COPYING.LGPLv2.1 "$out/ffmpeg-LICENSE.txt"
# FFmpeg's own summary of its licences: a few files inside carry ISC, MIT or BSD notices too.
cp LICENSE.md "$out/ffmpeg-LICENSE.md"
cp "$work/zimg-release-${ZIMG_VERSION}/COPYING" "$out/zimg-LICENSE.txt"
cp "$work/dav1d-${DAV1D_VERSION}/COPYING" "$out/dav1d-LICENSE.txt"
# The exact sources, kept beside the binaries in every CI artifact, so whoever hands out an installer can hand out the
# source from the same place (the LGPL's section 4); the Phase 8 release attaches them to each release. zimg's and
# dav1d's licences don't ask for it, but they're built into ffmpeg, so they travel with it.
cp "$work/ffmpeg-${VERSION}.tar.xz" "$out/ffmpeg-${VERSION}.tar.xz"
cp "$work/zimg-${ZIMG_VERSION}.tar.gz" "$out/zimg-${ZIMG_VERSION}.tar.gz"
cp "$work/dav1d-${DAV1D_VERSION}.tar.xz" "$out/dav1d-${DAV1D_VERSION}.tar.xz"
commit=${GITHUB_SHA:-$(git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)}
# The compiler configure actually used, as ffmpeg reports it ("built with ..."), and the script's own hash, which stays
# findable if the commit isn't.
compiler=$(sed -n 's/^built with //p' <<<"$about")
script=$(git hash-object "$here/build.sh" 2>/dev/null || echo unknown)
{
  echo "Storiiboard includes ffmpeg and ffprobe from FFmpeg ${VERSION}, under the GNU Lesser General Public License"
  echo "version 2.1 or later (ffmpeg-LICENSE.txt; FFmpeg's notes on its licences: ffmpeg-LICENSE.md). They run as"
  echo "separate programs; Storiiboard doesn't link them."
  echo
  echo "Source: ffmpeg-${VERSION}.tar.xz, handed out beside these binaries, the same file as ${SOURCE_URL}"
  echo "(SHA-256 ${SHA256})."
  echo "Built by scripts/ffmpeg/build.sh (blob ${script}) at Storiiboard commit ${commit}, with ${compiler},"
  echo "configured with:"
  echo "  ${flags[*]}"
  echo
  # FFmpeg's LICENSE.md asks for this credit with any program handed out only as executables.
  echo "ffmpeg and ffprobe are based in part on the work of the Independent JPEG Group (FFmpeg's"
  echo "libavcodec/jfdctfst.c, jfdctint_template.c and jrevdct.c)."
  echo
  echo "Built into ffmpeg and ffprobe, statically:"
  echo "- zimg ${ZIMG_VERSION} (https://github.com/sekrit-twc/zimg), under the WTFPL version 2 (zimg-LICENSE.txt)."
  echo "  Source: zimg-${ZIMG_VERSION}.tar.gz, beside these binaries, the same file as ${ZIMG_URL}"
  echo "  (SHA-256 ${ZIMG_SHA256})."
  echo "- dav1d ${DAV1D_VERSION} (https://code.videolan.org/videolan/dav1d), under the BSD 2-Clause licence"
  echo "  (dav1d-LICENSE.txt). Source: dav1d-${DAV1D_VERSION}.tar.xz, beside these binaries, the same file as"
  echo "  ${DAV1D_URL} (SHA-256 ${DAV1D_SHA256})."
} > "$out/ffmpeg-SOURCE.txt"
case "$triple" in
  x86_64*)
    # On x86, FFmpeg's and dav1d's assembly are both written with x86inc.asm, whose ISC notice must come with the
    # binary (it's the same file, by the x264 project, in both).
    # Cut out by its words, not its line numbers, and checked: a later dav1d may move it.
    notice=$(sed -n '/Copyright (C) .*x264 project/,/PERFORMANCE OF THIS SOFTWARE/p' \
      "$work/dav1d-${DAV1D_VERSION}/src/ext/x86/x86inc.asm" | sed 's/^;\* \{0,1\}//')
    grep -q 'x264 project' <<<"$notice" && grep -q 'PERFORMANCE OF THIS SOFTWARE' <<<"$notice" ||
      { echo "x86inc.asm's notice not found" >&2; exit 1; }
    {
      echo
      echo "On x86, ffmpeg and ffprobe include code assembled from x86inc.asm, under this notice:"
      echo
      echo "$notice"
    } >> "$out/ffmpeg-SOURCE.txt"
    ;;
esac
case "$triple" in
  *windows*)
    # Linked statically from MSYS2: zlib (zlib licence), GCC's C++ runtime for zimg (GPL 3 with the GCC Runtime
    # Library Exception, which allows it in any program built with GCC), and MinGW-w64's runtime and winpthreads,
    # whose notices must travel with the binary. The packages are named by who owns the libraries actually linked, so
    # their exact sources can be found.
    linked=""
    for lib in libstdc++.a libgcc.a libz.a libwinpthread.a libmingwex.a libmingw32.a; do
      # MinGW's gcc answers with a Windows path; pacman knows the MSYS2 one.
      file=$(gcc -print-file-name="$lib" 2>/dev/null | tr -d '\r' || true)
      file=$(cygpath -u "$file" 2>/dev/null || echo "$file")
      if [ -f "$file" ]; then linked="$linked $file"; fi
    done
    # shellcheck disable=SC2086 # one path per word, on purpose
    packages=$( (pacman -Qqo $linked 2>/dev/null || true) | sort -u | (xargs -r pacman -Q 2>/dev/null || true) | sed 's/^/  /')
    # Failing that, the runtime packages by name.
    if [ -z "$packages" ]; then
      packages=$( (pacman -Q 2>/dev/null || true) |
        grep -E '^mingw-w64-x86_64-(gcc|gcc-libs|zlib|crt|crt-git|winpthreads|winpthreads-git|libwinpthread|libwinpthread-git) ' |
        sed 's/^/  /' || true)
    fi
    {
      echo
      echo "The Windows build also links zlib (https://zlib.net, zlib licence), GCC's C++ runtime for zimg (GPL 3 with"
      echo "the GCC Runtime Library Exception), and MinGW-w64's runtime and winpthreads, from these MSYS2 packages"
      echo "(sources at https://github.com/msys2/MINGW-packages):"
      if [ -n "$packages" ]; then echo "$packages"; else echo "  (MSYS2 couldn't say which packages; the build's own MINGW64 toolchain)"; fi
      for licence in pthread crt; do
        found=$(find /mingw64/share/licenses -ipath "*${licence}*" -type f 2>/dev/null | head -n 1 || true)
        echo
        if [ -n "$found" ]; then
          echo "The licence of MinGW-w64's ${licence} ($(basename "$(dirname "$found")")):"
          echo
          cat "$found"
        else
          echo "(MinGW-w64's ${licence}: see https://github.com/mingw-w64/mingw-w64, its COPYING files)"
        fi
      done
    } >> "$out/ffmpeg-SOURCE.txt"
    ;;
esac
echo "built ffmpeg ${VERSION} with zimg ${ZIMG_VERSION} and dav1d ${DAV1D_VERSION} for ${triple}"
