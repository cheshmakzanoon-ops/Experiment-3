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
    before="$ROOT/before-dom/before-$scene-1280x720.jpg"
    # (A scene that failed to mount in the first baseline pass is shown from the 1280x800 pass.)
    [ -f "$before" ] || before="$ROOT/before-dom/before-$scene-1280x800.jpg"
    args+=("$before" "$ROOT/after-dom/after-$scene-1280x720.jpg")
  done
  sheet "$OUT/changed-$name.jpg" --cols 2 --tile 960 "${args[@]}"
}
pair loading loadingScreen loadingGp loadingMx loadingFestival
pair prerace briefing briefingMx gridPresentation academy
pair festival festival festivalMenu festivalCard festivalMap
pair lists events settings credits records

# 3. Every screen after the change at 1280x720 (all-1280x720-1..4), and the main ones at the other viewports.
ALL=(menu gp dirt festivalPlate wildcardBoard career careerPlayed career-events career-licences career-garage career-dealership firstRun \
  loadingScreen loadingGp loadingMx loadingSx loadingFestival briefing briefingGp briefingMx gridPresentation pause results resultsCareer \
  settings controls credits team teamEngineering teamPersonnel teamFinance photo academy championship events records recordsWildcard \
  hud hudGp hudMx replay festival festivalMenu festivalCard festivalMap telemetry errorScreen demoMenu demoWildcard)
n=0
batch=()
for scene in "${ALL[@]}"; do
  f="$ROOT/after-dom/after-$scene-1280x720.jpg"
  [ -f "$f" ] || continue
  batch+=("$f")
  if [ "${#batch[@]}" -eq 12 ]; then
    n=$((n + 1)); sheet "$OUT/all-1280x720-$n.jpg" --cols 4 --tile 480 "${batch[@]}"; batch=()
  fi
done
if [ "${#batch[@]}" -gt 0 ]; then n=$((n + 1)); sheet "$OUT/all-1280x720-$n.jpg" --cols 4 --tile 480 "${batch[@]}"; fi
MAIN=(menu gp dirt festivalPlate loadingScreen loadingGp briefing gridPresentation pause settings academy festivalMenu)
for vp in 1280x800 1920x1080 1024x600; do
  batch=()
  for scene in "${MAIN[@]}"; do
    f="$ROOT/after-dom/after-$scene-$vp.jpg"
    [ -f "$f" ] && batch+=("$f")
  done
  sheet "$OUT/main-$vp.jpg" --cols 4 --tile 480 "${batch[@]}"
done
