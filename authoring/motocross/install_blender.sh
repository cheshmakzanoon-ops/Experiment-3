#!/usr/bin/env bash
set -euo pipefail

# Native MX rebuilds compare exported bytes. Every mirror must supply this exact archive.
release=blender-5.2.2-linux-x64
sha256=84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168
destination=${1:?Supply an installation directory}
mkdir -p "$destination"
archive=$(mktemp "$destination/mx-blender.XXXXXX")
trap 'rm -f "$archive"' EXIT

for origin in https://download.blender.org/release \
              https://mirror.clarkson.edu/blender/release \
              https://mirrors.iu13.net/blender/release; do
  url="$origin/Blender5.2/$release.tar.xz"
  echo "Downloading $url"
  if curl --fail --location --silent --show-error --retry 1 --connect-timeout 12 \
          --max-time 180 --output "$archive" "$url"; then
    if printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check --status; then
      tar -xJf "$archive" -C "$destination"
      test -x "$destination/$release/blender"
      exit 0
    fi
    echo "Discarding archive with incorrect SHA-256 from $origin" >&2
  fi
done
echo "No mirror supplied the pinned Blender 5.2.2 archive" >&2
exit 1
