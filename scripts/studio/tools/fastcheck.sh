#!/usr/bin/env bash
# Area-focused vitest subsets for the Apex studio (see docs/studio/TECH_TEST_MAP.md).
# Usage: bash fastcheck.sh <area> [<area>...]   (run from the repo/worktree root)
# Areas: render world car character ui assets sim all-visual list
set -uo pipefail
declare -A SET
SET[render]="dusk-readability sky-linear sky-order daylight-environment exposure-key broadcast-presentation \
lens-bloom motion-blur specular-aa far-shadow reference-rendering visual-coherence weather-reconciliation \
race-view-continuity startup presentation settings-transition reflections wet-reflection point-light-work \
render-census draw-ledger infrastructure-render-budget operations-render-budget phase27g-presentation \
phase27f-atmosphere-audio presentation-continuity secondary-stand-camera gpu-frame-gate gpu-timer \
spray-lighting wet-presentation"
SET[world]="rendering circuit-detail circuits aurel-environment aurel-vegetation aurel-quarry quarry-surface-uv \
foliage-crowns foliage-coverage landform-groves phase27g-venue venue-landmark event-hall event-hall-approach \
race-surface-atmosphere race-surface-finish road-macro wet-broadcast-fidelity trackside track-infrastructure \
start-finish start-finish-shadow-bounds start-gantry secondary-grandstands secondary-grandstand-assets \
presentation-closure scenery-shadow-camera scenery-cube-camera scenery-pass-detail static-instance-shadow-bounds \
static-transform-group graphics-continuity tyre-marks marbles broadcast-sightlines race-structures build-queue"
SET[car]="hero-shells hero-import phase27h-assembly phase27f-models phase27g-models phase27e wing-surface \
tire-carcass race-surface-finish supplied-player supplied-player-lods supplied-shader-work supplied-draw-ranges \
supplied-compaction supplied-skin-bounds decal-coverage imported-render-budget a61-rival mirror-detail mirrors \
shadow-proxies graphics-continuity cockpit-detail cockpit-framing visible-wheel-pivots wheel-pose menu-preview \
menu-presentation phase27g-presentation reflections steering-display instruments camera probe-detail"
SET[character]="character-quality driver driver-asset driver-controls elbow-sleeve people crew-performance \
grid-staff grid-presentation pit-role-performance phase27g-seams phase27g-media race-finish presentation-continuity \
weather-reconciliation cockpit-detail graphics-continuity pit-presentation pit-material-warmup"
SET[ui]="presentation settings-transition race-day gap-timer proximity engineering practice-programme team-career \
reference-depth tab-evidence review-tools photo-reference reference-evidence reference-implementation \
steering-display acceptance-matrix phase27g-events session-review championship"
SET[assets]="source-stability directive a32-pit-jacks a33-spare-wheel-set a61-rival aurel-quarry aurel-vegetation \
broadcast-cameras catch-fence character-quality concrete-barriers crew-performance driver-asset event-hall \
hero-garage impact-barriers marshal-posts overhead-garage-service-rig people pit-building-frontage \
pit-wall-station recovery-gates secondary-grandstand-assets start-finish start-gantry steel-guardrails \
supplied-player-lods supplied-player track-boards track-infrastructure track-signal-hardware tyre-blankets \
tyre-trolleys-racks wheel-gun workshop-equipment trackside-operations"
SET[sim]="physics core contact rotation safety traffic race-control marshal driver-brain clutch aero-surface \
road-contact skid-contact recording worker-pause pit-release pit-approach racing-line lap-reference endurance-mode \
qualifying ghost-lap wheel-alignment"
files() {
  local out=()
  for name in $1; do [ -f "tests/$name.test.ts" ] && out+=("tests/$name.test.ts"); done
  printf '%s\n' "${out[@]}" | sort -u
}
[ $# -eq 0 ] && set -- list
status=0
for area in "$@"; do
  case "$area" in
    list) for k in "${!SET[@]}"; do echo "$k: $(files "${SET[$k]}" | wc -l) files"; done; continue ;;
    all-visual) list="${SET[render]} ${SET[world]} ${SET[car]} ${SET[character]} ${SET[ui]}" ;;
    *) list="${SET[$area]:-}"; [ -z "$list" ] && { echo "unknown area $area"; exit 2; } ;;
  esac
  mapfile -t f < <(files "$list")
  echo "== fastcheck $area: ${#f[@]} files"
  start=$(date +%s)
  npx vitest run --reporter=dot "${f[@]}" || status=1
  echo "== fastcheck $area: $(( $(date +%s) - start ))s exit=$status"
done
exit $status
