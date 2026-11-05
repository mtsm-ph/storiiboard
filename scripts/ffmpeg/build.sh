#!/usr/bin/env bash
# Builds ffmpeg and ffprobe for Storiiboard's sidecars (Phase 2.1): one pinned FFmpeg release, LGPL only (no --enable-gpl,
# no GPL or non-free libraries), static, with nothing picked up from the build machine by chance (--disable-autodetect):
# what's in is named below. Runs on Linux, macOS and Windows (in MSYS2's MINGW64 shell).
#
#   scripts/ffmpeg/build.sh <target-triple> <out-dir>
#
# Writes <out-dir>/ffmpeg-<triple>[.exe] and ffprobe-<triple>[.exe], the names Tauri's externalBin expects, plus
# ffmpeg-LICENSE.txt and ffmpeg-SOURCE.txt (the licence, and the exact source and configure line, as the LGPL asks).
set -euo pipefail

VERSION=8.1.3
SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
SOURCE_URL="https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz"

triple=${1:?target triple, e.g. aarch64-apple-darwin}
out=${2:?output folder}
mkdir -p "$out"
out=$(cd "$out" && pwd)
here=$(cd "$(dirname "$0")" && pwd)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# A reset connection is retried too (--retry alone skips it); the checksum below still decides.
curl -fsSL --retry 6 --retry-all-errors --retry-delay 10 -o "$work/ffmpeg.tar.xz" "$SOURCE_URL"
actual=$( (command -v sha256sum >/dev/null && sha256sum "$work/ffmpeg.tar.xz" || shasum -a 256 "$work/ffmpeg.tar.xz") | cut -d' ' -f1)
if [ "$actual" != "$SHA256" ]; then
  echo "ffmpeg-${VERSION}.tar.xz: checksum $actual, expected $SHA256" >&2
  exit 1
fi
tar -xJf "$work/ffmpeg.tar.xz" -C "$work"
cd "$work/ffmpeg-${VERSION}"

# What every platform gets. Decoders, demuxers, parsers and filters stay as FFmpeg ships them (all LGPL without
# --enable-gpl), so a camera file reads whatever it is; lut3d (LUTs), scale, tonemap and the rest come with them.
flags=(
  --disable-autodetect
  --disable-debug
  --disable-doc
  --disable-ffplay
  --disable-network
  --disable-shared
  --enable-static
  --enable-zlib
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
make -j"$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu || echo 4)" "ffmpeg${exe}" "ffprobe${exe}"

# Checked, not trusted: an LGPL build, with the LUT filter. Each output is read whole first: grep -q stopping early
# would end ffmpeg with SIGPIPE, which pipefail counts as a failure.
licence=$(./ffmpeg -hide_banner -L)
buildconf=$(./ffmpeg -hide_banner -buildconf)
filters=$(./ffmpeg -hide_banner -filters)
about=$(./ffmpeg -version)
# The licence text wraps ("...GNU Lesser General Public" / "License..."), so only the words on one line; "version 2.1"
# tells it from the LGPL 3 that --enable-version3 would bring, which the shipped COPYING.LGPLv2.1 wouldn't cover.
grep -q 'GNU Lesser General Public' <<<"$licence" || { echo 'not an LGPL build' >&2; exit 1; }
grep -q 'version 2.1' <<<"$licence" || { echo 'not LGPL version 2.1' >&2; exit 1; }
if grep -qE -- '--enable-(gpl|nonfree|version3)' <<<"$buildconf"; then echo 'built with a GPL, nonfree or version3 flag' >&2; exit 1; fi
grep -qE '[[:space:]]lut3d[[:space:]]' <<<"$filters" || { echo 'lut3d missing' >&2; exit 1; }

cp "ffmpeg${exe}" "$out/ffmpeg-${triple}${exe}"
cp "ffprobe${exe}" "$out/ffprobe-${triple}${exe}"
cp COPYING.LGPLv2.1 "$out/ffmpeg-LICENSE.txt"
# FFmpeg's own summary of its licences: a few files inside carry ISC, MIT or BSD notices too.
cp LICENSE.md "$out/ffmpeg-LICENSE.md"
# The exact source, kept beside the binaries in every CI artifact, so whoever hands out an installer can hand out the
# source from the same place (the LGPL's section 4); the Phase 8 release attaches it to each release.
cp "$work/ffmpeg.tar.xz" "$out/ffmpeg-${VERSION}.tar.xz"
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
} > "$out/ffmpeg-SOURCE.txt"
case "$triple" in
  *windows*)
    # Linked statically from MSYS2: zlib (zlib licence) and MinGW-w64's winpthreads (MIT-style), whose notice must
    # travel with the binary.
    {
      echo
      echo "The Windows build also links zlib (https://zlib.net, zlib licence) and MinGW-w64's winpthreads, whose"
      echo "licence follows."
      echo
      found=$(find /mingw64/share/licenses -ipath '*pthread*' -type f 2>/dev/null | head -n 1 || true)
      if [ -n "$found" ]; then cat "$found"; else echo "(winpthreads: see https://github.com/mingw-w64/mingw-w64, mingw-w64-libraries/winpthreads/COPYING)"; fi
    } >> "$out/ffmpeg-SOURCE.txt"
    ;;
esac
echo "built ffmpeg ${VERSION} for ${triple}"
