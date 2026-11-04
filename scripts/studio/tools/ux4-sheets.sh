#!/bin/bash
# Builds the ux4 contact sheets from a before and an after capture directory (see ux4dom.mjs and ux4-real.mjs).
#   bash scripts/studio/tools/ux4-sheets.sh <scratch-root> <out-dir>
# <scratch-root> holds before-real/ before-dom/ after-real/ after-dom/ (captures named
# <before|after>-<scene>-<w>x<h>.jpg). Output goes to <out-dir> (docs/studio/reports/ux4-screens).
set -e
ROOT="$1"
OUT="$2"
SHEET="$(dirname "$0")/ux4-sheet.py"
mkdir -p "$OUT"
sheet() { python3 -I "$SHEET" "$@"; }

# 1. The showroom, before and after, per discipline: every viewport (the car and the strip it must fit).
for d in circuit gp dirt festival; do
  sheet "$OUT/showroom-$d-before-after.jpg" --cols 2 --tile 960 \
    "$ROOT/before-real/before-menu-$d-1280x720.jpg" "$ROOT/after-real/after-menu-$d-1280x720.jpg" \
    "$ROOT/before-real/before-menu-$d-1280x800.jpg" "$ROOT/after-real/after-menu-$d-1280x800.jpg" \
    "$ROOT/before-real/before-menu-$d-1920x1080.jpg" "$ROOT/after-real/after-menu-$d-1920x1080.jpg" \
    "$ROOT/before-real/before-menu-$d-1024x600.jpg" "$ROOT/after-real/after-menu-$d-1024x600.jpg"
done

# 2. Changed screens at 1280x720, before beside after (DOM fixtures).
pair() {
  name="$1"; shift
  args=()
  for scene in "$@"; do
    args+=("$ROOT/before-dom/before-$scene-1280x720.jpg" "$ROOT/after-dom/after-$scene-1280x720.jpg")
  done
  sheet "$OUT/changed-$name.jpg" --cols 2 --tile 960 "${args[@]}"
}
pair loading loadingScreen loadingGp loadingMx loadingFestival
pair prerace briefing briefingMx gridPresentation academy
pair festival festival festivalMenu festivalCard festivalMap
pair lists events settings credits records
