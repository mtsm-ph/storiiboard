#!/usr/bin/env bash
# The sources the ffmpeg sidecars are built from, each pinned with its checksum, and a way to fetch them. build.sh
# sources this file; run on its own, it fetches all three into a folder, which a build elsewhere then takes through
# SBD_FFMPEG_SOURCES (the checkpoint does this, so a runner that can't reach a download site still builds):
#
#   scripts/ffmpeg/sources.sh <dir>
#
# Move to a newer release by changing its version and checksum here (a release at least two weeks old).

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

# Puts <file> in <dir>, from SBD_FFMPEG_SOURCES or downloaded, and checks it against <sha256>.
fetch_source() {
  local url=$1 sum=$2 file=$3 dir=$4
  if [ -n "${SBD_FFMPEG_SOURCES:-}" ] && [ -f "$SBD_FFMPEG_SOURCES/$file" ]; then
    cp "$SBD_FFMPEG_SOURCES/$file" "$dir/$file"
  else
    # A reset connection is retried too (--retry alone skips it), for up to a quarter of an hour, as a download site
    # can stop answering for minutes at a time; the checksum below still decides.
    curl -fsSL --connect-timeout 30 --retry 12 --retry-all-errors --retry-delay 15 --retry-max-time 900 \
      -o "$dir/$file" "$url"
  fi
  local actual
  actual=$( (command -v sha256sum >/dev/null && sha256sum "$dir/$file" || shasum -a 256 "$dir/$file") | cut -d' ' -f1)
  if [ "$actual" != "$sum" ]; then
    echo "$file: checksum $actual, expected $sum" >&2
    exit 1
  fi
}

# All three, into <dir>.
fetch_sources() {
  fetch_source "$SOURCE_URL" "$SHA256" "ffmpeg-${VERSION}.tar.xz" "$1"
  fetch_source "$ZIMG_URL" "$ZIMG_SHA256" "zimg-${ZIMG_VERSION}.tar.gz" "$1"
  fetch_source "$DAV1D_URL" "$DAV1D_SHA256" "dav1d-${DAV1D_VERSION}.tar.xz" "$1"
}

# Run on its own (not sourced): fetch them into the folder given.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  dir=${1:?folder to fetch the sources into}
  mkdir -p "$dir"
  fetch_sources "$dir"
  echo "fetched ffmpeg ${VERSION}, zimg ${ZIMG_VERSION} and dav1d ${DAV1D_VERSION} into ${dir}"
fi
